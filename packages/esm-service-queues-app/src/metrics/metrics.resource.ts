import { useSession, type Visit, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import dayjs from 'dayjs';
import useSWR from 'swr';

export function useActiveVisits() {
  const currentUserSession = useSession();
  const startDate = dayjs().format('YYYY-MM-DD');
  const sessionLocation = currentUserSession?.sessionLocation?.uuid;

  const customRepresentation =
    'custom:(uuid,patient:(uuid,identifiers:(identifier,uuid),person:(age,display,gender,uuid)),' +
    'visitType:(uuid,name,display),location:(uuid,name,display),startDatetime,' +
    'stopDatetime)&fromStartDate=' +
    startDate +
    '&location=' +
    sessionLocation;
  const url = `${restBaseUrl}/visit?includeInactive=false&v=${customRepresentation}`;
  const { data, error, isLoading, isValidating } = useSWR<{ data: { results: Array<Visit> } }, Error>(
    sessionLocation ? url : null,
    openmrsFetch,
  );

  // Create a Set to store unique patient UUIDs
  const uniquePatientUUIDs = new Set();

  data?.data?.results.forEach((visit) => {
    const patientUUID = visit.patient?.uuid;
    const isToday = dayjs(visit.startDatetime).isToday();
    if (patientUUID && isToday) {
      uniquePatientUUIDs.add(patientUUID);
    }
  });

  return {
    activeVisitsCount: uniquePatientUUIDs.size,
    isLoading,
    error,
    isValidating,
  };
}

export function useCompletedVisits() {
  const currentUserSession = useSession();
  const startDate = dayjs().format('YYYY-MM-DD');
  const sessionLocation = currentUserSession?.sessionLocation?.uuid;

  const customRepresentation =
    'custom:(uuid,patient:(uuid,identifiers:(identifier,uuid),person:(age,display,gender,uuid)),' +
    'visitType:(uuid,name,display),location:(uuid,name,display),startDatetime,' +
    'stopDatetime)&fromStartDate=' +
    startDate +
    '&location=' +
    sessionLocation;
  // includeInactive=true is required here (unlike useActiveVisits) because ended (stopped) visits
  // are otherwise excluded entirely from the response - there'd be nothing to filter for completion.
  const url = `${restBaseUrl}/visit?includeInactive=true&v=${customRepresentation}`;
  const { data, error, isLoading, isValidating } = useSWR<{ data: { results: Array<Visit> } }, Error>(
    sessionLocation ? url : null,
    openmrsFetch,
  );

  const completedVisitsToday =
    data?.data?.results.filter((visit) => visit.stopDatetime && dayjs(visit.startDatetime).isToday()) ?? [];

  const completedVisitsCount = completedVisitsToday.length;

  const averageVisitDurationInMinutes = completedVisitsToday.length
    ? Math.round(
        completedVisitsToday.reduce(
          (totalMinutes, visit) => totalMinutes + dayjs(visit.stopDatetime).diff(dayjs(visit.startDatetime), 'minute'),
          0,
        ) / completedVisitsToday.length,
      )
    : null;

  return {
    completedVisitsCount,
    averageVisitDurationInMinutes,
    isLoading,
    error,
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
