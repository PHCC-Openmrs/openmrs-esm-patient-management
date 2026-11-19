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

/**
 * Only the fields the queue table's columns, its row actions/modals and the metrics cards read.
 *
 * Most of the server's cost for this list was building `display` strings, not the query: for
 * metadata (queue, location, identifier type) `display` is a message-source lookup for a
 * `ui.i18n.<Type>.name.<uuid>` translation that falls back to the plain `name`, and this
 * distribution defines no such translations, so `name` is requested instead and copied into `display` client-side (see
 * `withDisplayNames`), leaving every consumer reading `display` unchanged. The patient's name is the
 * entry's own `display` (the same `PersonName.getFullName()` as `person.display`), so it is sent
 * once rather than three times, and the patient's `display` ("<identifier> - <name>") nothing reads
 * is dropped. Concepts (status, priority) keep `display`: it is the name in the user's locale.
 */
export const repString =
  'custom:(uuid,display,queue:(uuid,name),status:(uuid,display),patient:(uuid,person:(age,birthdate,gender),identifiers:(uuid,identifier,identifierType:(uuid,name))),visit:(uuid,startDatetime,stopDatetime,location:(uuid,name),attributes:(uuid,value,attributeType:(uuid))),priority:(uuid,display),priorityComment,sortWeight,startedAt,endedAt,queueComingFrom:(uuid,name),previousQueueEntry:(uuid,startedAt,status:(uuid,display)))';

/**
 * Just enough of each entry to tell whether anything the queue views show for it has changed:
 * which entries there are, and every field of `repString` that changes while an entry is in the
 * list. Everything else - the patient's name, age and identifiers, where the entry came from, the
 * entry before it - is fixed when the entry is created or changes only outside the queue (patient
 * registration), and is picked up by the periodic full refetch. Costs a fraction of `repString`:
 * no display strings, no patient.
 */
export const signatureRepString =
  'custom:(uuid,status:(uuid),priority:(uuid),queue:(uuid),priorityComment,sortWeight,startedAt,endedAt,visit:(uuid,startDatetime,stopDatetime,location:(uuid),attributes:(uuid,value)))';

/**
 * Page size for signature fetches. Larger than `maxResultsPerPage` because each page request
 * repeats the query, its count and the latest-per-patient reduction, which is most of a page of
 * signatures' cost. Still under the 1000 `webservices.rest.maxResultsAbsolute` OpenMRS ships with;
 * a site that set it lower gets an error for the signature fetch, and falls back to full fetches.
 */
const signaturePageSize = 500;

/**
 * How long the entries of `repString` may be kept up to date from signatures alone, before being
 * refetched in full - which picks up what signatures don't cover (see `signatureRepString`).
 */
export const fullRefetchIntervalMs = 5 * 60 * 1000;

/**
 * Beyond this many new or changed entries, refetching the whole list (a few pages) is cheaper than
 * fetching each entry on its own.
 */
const maxEntriesRefetchedIndividually = 20;

type Named = { uuid?: string; name?: string; display?: string } | null | undefined;

function withNameAsDisplay<T extends Named>(resource: T): T {
  return resource && resource.display === undefined && resource.name !== undefined
    ? { ...resource, display: resource.name }
    : resource;
}

/**
 * Fills in the `display` strings `repString` leaves out, from the fields it requests instead (see
 * there), so the entries are shaped as they were when the server sent `display` itself. Fields that
 * are already present are left alone, so entries of any other representation pass through as is.
 */
export function withDisplayNames(entry: QueueEntry): QueueEntry {
  if (!entry) {
    return entry;
  }
  const { patient, visit } = entry;
  return {
    ...entry,
    queue: withNameAsDisplay(entry.queue),
    queueComingFrom: withNameAsDisplay(entry.queueComingFrom),
    ...(visit ? { visit: { ...visit, location: withNameAsDisplay(visit.location) } } : {}),
    ...(patient
      ? {
          patient: {
            ...patient,
            ...(patient.person ? { person: { uuid: patient.uuid, display: entry.display, ...patient.person } } : {}),
            ...(patient.identifiers
              ? {
                  identifiers: patient.identifiers.map((identifier) => ({
                    ...identifier,
                    identifierType: withNameAsDisplay(identifier.identifierType),
                  })),
                }
              : {}),
          },
        }
      : {}),
  };
}

/**
 * Everything `signatureRepString` carries about an entry, as one string - read the same way from an
 * entry of `repString`, which includes all of it, so the two compare equal while nothing has changed.
 */
export function queueEntrySignature(entry: QueueEntry): string {
  const visit = entry.visit;
  return JSON.stringify([
    entry.uuid,
    entry.status?.uuid ?? null,
    entry.priority?.uuid ?? null,
    entry.queue?.uuid ?? null,
    entry.priorityComment ?? null,
    entry.sortWeight ?? null,
    entry.startedAt ?? null,
    entry.endedAt ?? null,
    visit
      ? [
          visit.uuid ?? null,
          visit.startDatetime ?? null,
          visit.stopDatetime ?? null,
          visit.location?.uuid ?? null,
          (visit.attributes ?? [])
            .map((attribute) => [attribute?.uuid ?? null, attribute?.value ?? null])
            .sort(([a], [b]) => String(a).localeCompare(String(b))),
        ]
      : null,
  ]);
}

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
 * Kept well under the views' poll interval, so a poll always gets a fresh fetch of its own, but
 * long enough to cover the table and the metrics cards polling a few seconds apart: each is its
 * own extension with its own poll timer, started whenever that extension happened to mount.
 */
const sharedFetchFreshnessMs = 5000;

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
    promise: fetchQueueEntries(url),
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

/** The latest entries of each `repString` query, kept up to date from signatures. Keyed by URL. */
const knownEntries = new Map<string, { entries: Array<QueueEntry>; fullyFetchedAt: number }>();
/** Bounds `knownEntries`: a few views' worth of queries, not every one a long-lived tab ever made. */
const maxKnownQueries = 20;

/** Forgets every query's entries, so the next fetch of each is a full one. For tests. */
export function forgetKnownQueueEntries() {
  knownEntries.clear();
  lastTotalCounts.clear();
}

function rememberEntries(url: string, entries: Array<QueueEntry>, fullyFetchedAt: number) {
  knownEntries.delete(url);
  knownEntries.set(url, { entries, fullyFetchedAt });
  if (knownEntries.size > maxKnownQueries) {
    knownEntries.delete(knownEntries.keys().next().value);
  }
}

async function fetchAllQueueEntriesInFull(url: string): Promise<Array<QueueEntry>> {
  const startedAt = Date.now();
  const entries = (await fetchAllQueueEntryPages(url)).map(withDisplayNames);
  if (new URLSearchParams(url.split('?')[1]).get('v') === repString) {
    rememberEntries(url, entries, startedAt);
  }
  return entries;
}

async function fetchSingleQueueEntry(uuid: string): Promise<QueueEntry> {
  const { data } = await openmrsFetch<QueueEntry>(`${queueEntryBaseUrl}/${uuid}?v=${encodeURIComponent(repString)}`);
  return withDisplayNames(data);
}

/**
 * Brings the entries last fetched for a `repString` query up to date. The query is re-run with
 * `signatureRepString`, and only the entries that are new, or whose signature no longer matches
 * the one last fetched, are fetched again in full - so a poll in which nothing changed costs one
 * request for signatures, rather than every page of every entry with all its display strings.
 * Entries the query no longer returns are dropped; the order is the query's.
 *
 * Returns null when there is nothing to start from, or so much has changed that refetching the
 * whole list is cheaper.
 */
async function refreshKnownEntries(url: string): Promise<Array<QueueEntry> | null> {
  const known = knownEntries.get(url);
  if (!known || Date.now() - known.fullyFetchedAt >= fullRefetchIntervalMs) {
    return null;
  }

  const [path, query] = url.split('?');
  const params = new URLSearchParams(query);
  params.set('v', signatureRepString);
  params.set('limit', signaturePageSize.toString());
  const signatureUrl = `${path}?${params.toString()}`;
  if (!lastTotalCounts.has(signatureUrl) && lastTotalCounts.has(url)) {
    // Spares the count-only request: it is the same query.
    lastTotalCounts.set(signatureUrl, lastTotalCounts.get(url));
  }
  const signatures = await fetchAllQueueEntryPages(signatureUrl);

  const knownByUuid = new Map(known.entries.map((entry) => [entry.uuid, entry]));
  const changedUuids = signatures
    .filter((signature) => {
      const knownEntry = knownByUuid.get(signature.uuid);
      return !knownEntry || queueEntrySignature(knownEntry) !== queueEntrySignature(signature);
    })
    .map((signature) => signature.uuid);

  if (
    changedUuids.length === 0 &&
    signatures.length === known.entries.length &&
    signatures.every((signature, index) => signature.uuid === known.entries[index].uuid)
  ) {
    return known.entries;
  }
  if (changedUuids.length > maxEntriesRefetchedIndividually) {
    return null;
  }

  const refetched = new Map(
    (await Promise.all(changedUuids.map(fetchSingleQueueEntry)))
      .filter((entry) => entry?.uuid)
      .map((entry) => [entry.uuid, entry]),
  );
  const entries = signatures
    .map((signature) => refetched.get(signature.uuid) ?? knownByUuid.get(signature.uuid))
    .filter(Boolean);
  // A newer refresh (or a full refetch) may have finished meanwhile; don't roll its entries back.
  if (knownEntries.get(url) === known) {
    rememberEntries(url, entries, known.fullyFetchedAt);
  }
  return entries;
}

/**
 * Fetches a queue-entry query's entries: in full the first time and every `fullRefetchIntervalMs`,
 * and in between - for the views' own `repString` - by refreshing only what changed (see
 * `refreshKnownEntries`). This is what keeps every open queue screen's 15-second poll cheap: most
 * polls find nothing changed, and the list stays the size of the whole day's queue.
 */
async function fetchQueueEntries(url: string): Promise<Array<QueueEntry>> {
  try {
    const refreshed = await refreshKnownEntries(url);
    if (refreshed) {
      return refreshed;
    }
  } catch (error) {
    // Fall back to fetching the list in full, which reports its own errors.
  }
  return fetchAllQueueEntriesInFull(url);
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
