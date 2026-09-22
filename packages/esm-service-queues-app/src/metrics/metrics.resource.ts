import { useMemo } from 'react';
import { useConfig, useSession, type Visit, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { type ConfigObject } from '../config-schema';
import { useCurrentQueueEntries } from '../hooks/useCurrentQueueEntries';

/**
 * Count of queue entries currently "In Service" (i.e. today's checked-in patients who are
 * actively being attended to right now) - the same population the "Patients Currently In
 * Queue" table shows when filtered to "In Service", not a separately-tallied /visit count that
 * can drift from what that table displays. Every filter the user has picked (service, queue
 * room, location, program) is already applied by useCurrentQueueEntries, so the card always
 * counts exactly the patients listed below it.
 */
export function useCheckedInPatients() {
  const { concepts } = useConfig<ConfigObject>();
  const { currentQueueEntries, isLoading, isValidating } = useCurrentQueueEntries();

  const checkedInPatientsCount = useMemo(
    () => currentQueueEntries.filter((entry) => entry.status?.uuid === concepts.defaultTransitionStatus).length,
    [currentQueueEntries, concepts.defaultTransitionStatus],
  );

  return {
    checkedInPatientsCount,
    isLoading,
    isValidating,
  };
}

/**
 * Count (and average duration) of visits whose queue entry moved to "Finished Service" today,
 * within whatever the user has filtered to - mirrors the queue table's own Finished Service view.
 */
export function useCompletedVisits() {
  const { concepts } = useConfig<ConfigObject>();
  const { currentQueueEntries, isLoading, isValidating } = useCurrentQueueEntries();

  const completedToday = useMemo(
    () => currentQueueEntries.filter((entry) => entry.status?.uuid === concepts.defaultFinishedServiceStatus),
    [currentQueueEntries, concepts.defaultFinishedServiceStatus],
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

    return durations.length
      ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
      : null;
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
