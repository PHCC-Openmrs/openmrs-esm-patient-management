import { useMemo } from 'react';
import { useConfig, useSession, type Visit, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { type ConfigObject } from '../config-schema';
import { useQueueEntries } from '../hooks/useQueueEntries';
import { dedupeQueueEntriesByPatient, isQueueEntryFromToday } from '../service-queues.resource';

/**
 * Count of queue entries currently "In Service" (i.e. today's checked-in patients who are
 * actively being attended to right now) - the same population the "Patients Currently In
 * Queue" table shows when filtered to "In Service", not a separately-tallied /visit count that
 * can drift from what that table displays. An entry whose visit started on a previous day (an
 * overdue visit that's still open and In Service) is excluded here for the same reason the table
 * excludes it - it belongs to "Overdue Visits", not to today's queue activity.
 */
export function useCheckedInPatients() {
  const { concepts } = useConfig<ConfigObject>();
  const { sessionLocation } = useSession();

  const { queueEntries, isLoading, isValidating } = useQueueEntries({
    status: concepts.defaultTransitionStatus,
    isEnded: false,
    location: sessionLocation?.uuid,
  });

  const checkedInPatientsCount = useMemo(
    () => dedupeQueueEntriesByPatient((queueEntries ?? []).filter(isQueueEntryFromToday)).length,
    [queueEntries],
  );

  return {
    checkedInPatientsCount,
    isLoading,
    isValidating,
  };
}

/**
 * Count (and average duration) of visits whose queue entry moved to "Finished Service" today -
 * mirrors the queue table's own Finished Service view (same "today" definition and per-patient
 * dedup as default-queue-table.component.tsx, so this card's number always matches the table's
 * row count). isEnded is intentionally omitted: the backend only ever assigns this status to
 * entries it has already ended, so isEnded:false would hide every match.
 */
export function useCompletedVisits() {
  const { concepts } = useConfig<ConfigObject>();
  const { sessionLocation } = useSession();

  const { queueEntries, isLoading, isValidating } = useQueueEntries({
    status: concepts.defaultFinishedServiceStatus,
    location: sessionLocation?.uuid,
  });

  const completedToday = useMemo(
    () => dedupeQueueEntriesByPatient((queueEntries ?? []).filter(isQueueEntryFromToday)),
    [queueEntries],
  );

  const completedVisitsCount = completedToday.length;

  const averageVisitDurationInMinutes = useMemo(() => {
    const durations = completedToday
      .map((entry) => {
        const start = entry.visit?.startDatetime;
        const stop = entry.visit?.stopDatetime;
        return start && stop ? dayjs(stop).diff(dayjs(start), 'minute') : null;
      })
      .filter((duration): duration is number => duration != null);

    return durations.length ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length) : null;
  }, [completedToday]);

  return {
    completedVisitsCount,
    averageVisitDurationInMinutes,
    isLoading,
    isValidating,
  };
}

export function useOverdueVisits() {
  const currentUserSession = useSession();
  const sessionLocation = currentUserSession?.sessionLocation?.uuid;

  const customRepresentation =
    'custom:(uuid,patient:(uuid,identifiers:(identifier,uuid),person:(age,display,gender,uuid)),' +
    'visitType:(uuid,name,display),location:(uuid,name,display),startDatetime,stopDatetime)&location=' +
    sessionLocation;
  // No fromStartDate filter: we want every visit that is still open, regardless of when it started,
  // then keep only the ones that didn't start today (i.e. someone forgot to close them).
  const url = `${restBaseUrl}/visit?includeInactive=false&v=${customRepresentation}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ data: { results: Array<Visit> } }, Error>(
    sessionLocation ? url : null,
    openmrsFetch,
  );

  const overdueVisits = (data?.data?.results ?? [])
    .filter((visit) => !dayjs(visit.startDatetime).isToday())
    .sort((a, b) => dayjs(a.startDatetime).valueOf() - dayjs(b.startDatetime).valueOf());

  return {
    overdueVisits,
    isLoading,
    error,
    isValidating,
    mutate,
  };
}
