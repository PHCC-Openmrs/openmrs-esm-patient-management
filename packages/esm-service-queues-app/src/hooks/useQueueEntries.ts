import { useCallback, useEffect, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { type QueueEntry, type QueueEntrySearchCriteria } from '../types';

const queueEntryBaseUrl = `${restBaseUrl}/queue-entry`;

/**
 * Page size for queue-entry fetches. Left unset, the endpoint pages at the server's
 * `webservices.rest.maxResultsDefault` (50). Kept deliberately modest because asking for more
 * than the server's `webservices.rest.maxResultsAbsolute` is a hard error ("Administrator has
 * set absolute limit at N"), not a silent clamp - so this has to stay under the *lowest* value
 * any deployment might configure, not just the 1000 OpenMRS ships with. Days that overflow one
 * page are covered by fetching every page in parallel (see `fetchAllQueueEntryPages`).
 */
const maxResultsPerPage = 100;

export const repString =
  'custom:(uuid,display,queue:(uuid,display,name),status:(uuid,display),patient:(uuid,display,person:(uuid,display,age,birthdate,gender),identifiers:(uuid,identifier,identifierType:(uuid,display))),visit:(uuid,startDatetime,stopDatetime,location:(uuid,display),attributes:(uuid,value,attributeType:(uuid))),priority:(uuid,display),priorityComment,sortWeight,startedAt,endedAt,queueComingFrom:(uuid,display),previousQueueEntry:(uuid,startedAt,status:(uuid,display)))';

/**
 * Window event that tells every mounted queue-entry list to refetch. Code that runs outside React
 * (the `visit-started` / `visit-ended` listeners in index.ts) can't revalidate SWR directly: SWR's
 * global `mutate` targets SWR's default cache, while every OpenMRS component reads through the
 * private cache that `openmrsComponentDecorator` provides - and filter-style `mutate(fn)` skips
 * `useSWRInfinite` (`$inf$`) keys anyway, which is what `useOpenmrsFetchAll` uses. So those code
 * paths dispatch this event instead, and `useQueueEntries` revalidates itself in response. The
 * name matches what esm-patient-chart already dispatches after ending or deleting a visit.
 */
export const queueEntryUpdatedEvent = 'queue-entry-updated';

export function notifyQueueEntriesChanged() {
  window.dispatchEvent(new CustomEvent(queueEntryUpdatedEvent));
}

/**
 * How long a finished queue-entry fetch may be handed to another caller asking for the same URL.
 * Kept well under the views' poll interval, so a poll always gets a fresh fetch of its own.
 */
const sharedFetchFreshnessMs = 2000;

/**
 * Queue-entry fetches shared across every component on the page, keyed by URL. The queue table
 * and each metrics card are separate extensions, each with its own private SWR cache, so SWR's
 * own de-duplication never sees them asking for the same URL - every page of every poll used to
 * go out once per extension. Sharing the in-flight (or just-finished) fetch here collapses those
 * into one.
 */
const sharedFetches = new Map<
  string,
  { promise: Promise<Array<QueueEntry>>; generation: number; settledAt?: number }
>();
let sharedFetchGeneration = 0;

/** Stops handing out fetches started before a queue-entry change, so the next revalidation refetches. */
function invalidateSharedQueueEntryFetches() {
  sharedFetchGeneration++;
  sharedFetches.clear();
}

// Registered once, at module load, so it runs before any per-component listener revalidates -
// several components refetching in response then still share a single post-change fetch.
if (typeof window !== 'undefined') {
  window.addEventListener(queueEntryUpdatedEvent, invalidateSharedQueueEntryFetches);
}

function fetchQueueEntriesShared(url: string): Promise<Array<QueueEntry>> {
  const existing = sharedFetches.get(url);
  if (
    existing &&
    existing.generation === sharedFetchGeneration &&
    (existing.settledAt == null || Date.now() - existing.settledAt < sharedFetchFreshnessMs)
  ) {
    return existing.promise;
  }

  const entry: { promise: Promise<Array<QueueEntry>>; generation: number; settledAt?: number } = {
    promise: fetchAllQueueEntryPages(url),
    generation: sharedFetchGeneration,
  };
  entry.promise.then(
    () => {
      entry.settledAt = Date.now();
    },
    () => {
      if (sharedFetches.get(url) === entry) {
        sharedFetches.delete(url);
      }
    },
  );
  sharedFetches.set(url, entry);
  return entry.promise;
}

export function useMutateQueueEntries() {
  const { mutate, cache } = useSWRConfig();
  const mutateQueueEntries = useCallback(() => {
    invalidateSharedQueueEntryFetches();
    const promises: Promise<unknown>[] = [];
    for (const key of cache.keys()) {
      if (key.includes(`${restBaseUrl}/queue-entry`) || key.includes(`${restBaseUrl}/visit-queue-entry`)) {
        promises.push(mutate(key));
      }
    }
    return Promise.all(promises);
  }, [mutate, cache]);

  return useMemo(
    () => ({
      mutateQueueEntries,
    }),
    [mutateQueueEntries],
  );
}

/**
 * Appends a search criteria value to the query string. Array values (e.g. `status: [a, b]`)
 * are appended as repeated params (`status=a&status=b`), matching how the servlet's
 * getParameterMap()/String[] - and this module's QueueEntrySearchCriteriaParser - expect
 * multi-value params; joining them into one comma-separated value would instead be parsed as
 * a single, unresolvable concept reference.
 */
function appendSearchParam(searchParam: URLSearchParams, key: string, value: unknown) {
  if (value == null) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v) => appendSearchParam(searchParam, key, v));
  } else {
    searchParam.append(key, value.toString());
  }
}

interface QueueEntryPage {
  results: Array<QueueEntry>;
  totalCount?: number;
  links?: Array<{ rel: string; uri: string }>;
}

/**
 * The last `totalCount` each query reported, keyed by URL, so a refetch can request every page at
 * once without first waiting to learn how many there are.
 */
const lastTotalCounts = new Map<string, number>();

/** Asks for the query's `totalCount` alone - a fraction of the cost of a page of full entries. */
async function fetchTotalCount(url: string): Promise<number> {
  const [path, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('v', 'custom:(uuid)');
  params.set('limit', '1');
  params.set('totalCount', 'true');
  const { data } = await openmrsFetch<QueueEntryPage>(`${path}?${params.toString()}`);
  return data?.totalCount ?? 0;
}

/**
 * Fetches every page of a queue-entry query at once, by `startIndex`, rather than following each
 * page's `next` link in turn (as `useOpenmrsFetchAll` does). A busy site's day runs to many hundreds
 * of entries - each patient leaves one behind per room they pass through - and walking those pages
 * one round trip at a time kept the table on its loading skeleton for well over ten seconds.
 *
 * How many pages to ask for comes from the count this query reported last time; on its first fetch
 * a count-only request supplies it. If the query has since grown past that, the missing pages are
 * fetched once the first batch reports the new `totalCount`.
 *
 * Entries created or ended between page requests can shift the page boundaries, so results are
 * de-duplicated by uuid; anything that slips between pages is picked up on the next revalidation.
 */
async function fetchAllQueueEntryPages(url: string): Promise<Array<QueueEntry>> {
  const pageSize = Number(new URLSearchParams(url.split('?')[1]).get('limit')) || maxResultsPerPage;
  const fetchPages = (fromIndex: number, toIndex: number) => {
    const startIndexes: Array<number> = [];
    for (let startIndex = fromIndex; startIndex === fromIndex || startIndex < toIndex; startIndex += pageSize) {
      startIndexes.push(startIndex);
    }
    return Promise.all(
      startIndexes.map((startIndex) =>
        openmrsFetch<QueueEntryPage>(startIndex ? `${url}&startIndex=${startIndex}` : url).then(({ data }) => data),
      ),
    );
  };

  const expectedTotal = lastTotalCounts.get(url) ?? (await fetchTotalCount(url));
  const pages = await fetchPages(0, expectedTotal);
  const fetchedUpTo = pages.length * pageSize;
  const totalCount = Math.max(0, ...pages.map((page) => page?.totalCount ?? 0));
  if (totalCount > fetchedUpTo) {
    pages.push(...(await fetchPages(fetchedUpTo, totalCount)));
  }
  lastTotalCounts.set(url, totalCount);

  const entriesByUuid = new Map<string, QueueEntry>();
  for (const entry of pages.flatMap((page) => page?.results ?? [])) {
    entriesByUuid.set(entry.uuid, entry);
  }
  return [...entriesByUuid.values()];
}

export function useQueueEntries(searchCriteria?: QueueEntrySearchCriteria, rep: string = repString) {
  const searchParam = new URLSearchParams();
  searchParam.append('v', rep);
  searchParam.append('totalCount', 'true');
  searchParam.append('limit', maxResultsPerPage.toString());

  if (searchCriteria) {
    for (let [key, value] of Object.entries(searchCriteria)) {
      appendSearchParam(searchParam, key, value);
    }
  }

  // A plain SWR key (rather than useSWRInfinite's `$inf$` one) also means a revalidation always
  // refetches every page together, so a moved patient's row on a later page can't go stale.
  const { data, error, isLoading, isValidating, mutate } = useSWR<Array<QueueEntry>, Error>(
    `${queueEntryBaseUrl}?${searchParam.toString()}`,
    fetchQueueEntriesShared,
  );

  useEffect(() => {
    const revalidate = () => mutate();
    window.addEventListener(queueEntryUpdatedEvent, revalidate);
    return () => window.removeEventListener(queueEntryUpdatedEvent, revalidate);
  }, [mutate]);

  return {
    queueEntries: data ?? [],
    error,
    isLoading,
    isValidating,
    mutate,
  };
}

export function useQueueEntriesMetrics(searchCriteria?: QueueEntrySearchCriteria) {
  const searchParam = new URLSearchParams();
  for (let [key, value] of Object.entries(searchCriteria)) {
    appendSearchParam(searchParam, key, value);
  }
  const apiUrl = `${restBaseUrl}/queue-entry-metrics?` + searchParam.toString();

  const { data } = useSWR<
    {
      data: {
        count: number;
        averageWaitTime: number;
      };
    },
    Error
  >(apiUrl, openmrsFetch);

  return {
    count: data ? data?.data?.count : 0,
    averageWaitTime: data?.data?.averageWaitTime,
  };
}
