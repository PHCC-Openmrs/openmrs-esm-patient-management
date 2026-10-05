import { useCallback, useEffect, useMemo } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { openmrsFetch, restBaseUrl, useOpenmrsFetchAll } from '@openmrs/esm-framework';
import { type QueueEntry, type QueueEntrySearchCriteria } from '../types';

const queueEntryBaseUrl = `${restBaseUrl}/queue-entry`;

/**
 * Page size for queue-entry fetches. Left unset, the endpoint pages at the server's
 * `webservices.rest.maxResultsDefault` (50), and `useOpenmrsFetchAll` walks the pages
 * *sequentially* - each page's request URL is the previous page's `next` link - while rendering
 * nothing until the last one lands, so every extra page is a full round trip of dead time under
 * the loading skeleton. Raising the page size cuts those round trips; combined with a query
 * bounded to today (see `useCurrentQueueEntries`), a single request covers the day outright for
 * any realistic single-site caseload.
 *
 * Kept deliberately modest because asking for more than the server's
 * `webservices.rest.maxResultsAbsolute` is a hard error ("Administrator has set absolute limit
 * at N"), not a silent clamp - so this has to stay under the *lowest* value any deployment
 * might configure, not just the 1000 OpenMRS ships with. Anything beyond one page still pages
 * correctly, just over fewer, larger requests than before.
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

export function useMutateQueueEntries() {
  const { mutate, cache } = useSWRConfig();
  const mutateQueueEntries = useCallback(() => {
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

  const { data, ...rest } = useOpenmrsFetchAll<QueueEntry>(`${queueEntryBaseUrl}?${searchParam.toString()}`, {
    // This reads through useSWRInfinite, which by default only refetches the *first* page when
    // it revalidates (`revalidateFirstPage`); every later page keeps being served from cache
    // unless the whole hook is remounted. Entries come back oldest-first (the module orders by
    // startedAt ascending), so on the rare day that does overflow a single page, the newest
    // entries - the ones these views display - are the ones sitting on the later pages. Moving a
    // patient would then refresh a page of older, untouched entries and go on rendering the
    // moved patient's stale row until the browser was reloaded.
    swrInfiniteConfig: { revalidateAll: true },
  });

  const { mutate } = rest;
  useEffect(() => {
    const revalidate = () => mutate();
    window.addEventListener(queueEntryUpdatedEvent, revalidate);
    return () => window.removeEventListener(queueEntryUpdatedEvent, revalidate);
  }, [mutate]);

  return {
    queueEntries: data ?? [],
    ...rest,
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
