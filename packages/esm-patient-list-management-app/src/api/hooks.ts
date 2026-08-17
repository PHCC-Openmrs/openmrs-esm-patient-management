import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import { restBaseUrl, openmrsFetch, type FetchResponse, useConfig, useSession } from '@openmrs/esm-framework';
import {
  cohortUrl,
  getAllPatientLists,
  getPatientListIdsForPatient,
  getPatientListMembers,
} from './patient-list.resource';
import { type PatientListManagementConfig } from '../config-schema';
import {
  type CohortResponse,
  type CohortType,
  type OpenmrsCohort,
  type OpenmrsCohortMember,
  type PatientListFilter,
  PatientListType,
} from './types';

interface PatientListResponse {
  results: CohortResponse<OpenmrsCohort>;
  links: Array<{ rel: 'prev' | 'next' }>;
  totalCount: number;
}

export function useAllPatientLists({ isStarred, type }: PatientListFilter) {
  const custom = 'custom:(uuid,name,description,display,size,attributes,cohortType,location:(uuid,display))';
  const query: Array<[string, string]> = [
    ['v', custom],
    ['totalCount', 'true'],
  ];
  const config = useConfig<PatientListManagementConfig>();

  if (type === PatientListType.USER) {
    query.push(['cohortType', config.myListCohortTypeUUID]);
  } else if (type === PatientListType.SYSTEM) {
    query.push(['cohortType', config.systemListCohortTypeUUID]);
  }

  const params = query.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');

  const getUrl = (pageIndex, previousPageData: FetchResponse<PatientListResponse>) => {
    if (pageIndex && !previousPageData?.data?.links?.some((link) => link.rel === 'next')) {
      return null;
    }

    let url = `${cohortUrl}/cohort?${params}`;

    if (pageIndex) {
      url += `&startIndex=${pageIndex * 50}`;
    }

    return url;
  };

  const {
    data,
    error,
    mutate,
    isValidating,
    isLoading,
    size: pageNumber,
    setSize,
  } = useSWRInfinite<FetchResponse<PatientListResponse>, Error>(getUrl, openmrsFetch);

  useEffect(() => {
    if (data && data?.[pageNumber - 1]?.data?.links?.some((link) => link.rel === 'next')) {
      setSize((currentSize) => currentSize + 1);
    }
  }, [data, pageNumber, setSize]);

  const patientListsData = (data?.flatMap((res) => res?.data?.results ?? []) ?? []).map((cohort) => ({
    id: cohort.uuid,
    display: cohort.name,
    description: cohort.description,
    type: cohort.cohortType?.display,
    size: cohort.size,
    location: cohort.location,
  }));
  const { user } = useSession();

  return {
    patientLists: isStarred
      ? patientListsData.filter(({ id }) => user?.userProperties?.starredPatientLists?.includes(id))
      : patientListsData,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}

export function useAllPatientListMembers(patientListId: string) {
  return useSWR(['patientListMembers', patientListId], () => getPatientListMembers(patientListId));
}

/**
 * A hook for querying all local and remote patient lists that exist for a given user,
 * but without those patient lists where a specific patient has already been added as a member.
 *
 * This is intended for displaying all lists to which a given patient can still be added.
 */
export function useAllPatientListsWhichDoNotIncludeGivenPatient(patientUuid: string) {
  const config = useConfig<PatientListManagementConfig>();
  return useSWR(['patientListWithoutPatient', patientUuid], async () => {
    const [allLists, listsIdsOfThisPatient] = await Promise.all([
      getAllPatientLists({}, config?.myListCohortTypeUUID, config?.systemListCohortTypeUUID),
      getPatientListIdsForPatient(patientUuid),
    ]);

    const listsWithoutPatient = allLists.filter((list) => !listsIdsOfThisPatient.includes(list.id));
    return listsWithoutPatient;
  });
}

export function usePatientListDetails(patientListUuid: string) {
  const url = `${cohortUrl}/cohort/${patientListUuid}?v=custom:(uuid,name,description,display,size,attributes,startDate,endDate,cohortType)`;

  const { data, error, isLoading, mutate } = useSWR<FetchResponse<OpenmrsCohort>, Error>(
    patientListUuid ? url : null,
    openmrsFetch,
  );

  return {
    listDetails: data?.data,
    error,
    isLoading,
    mutateListDetails: mutate,
  };
}

export function usePatientListMembers(
  patientListUuid: string,
  searchQuery: string = '',
  startIndex: number = 0,
  pageSize: number = 10,
  v: string = 'full',
) {
  const { data, error, isLoading, mutate } = useSWR<FetchResponse<CohortResponse<OpenmrsCohortMember>>, Error>(
    `${cohortUrl}/cohortmember?cohort=${patientListUuid}&startIndex=${startIndex}&limit=${pageSize}&v=${v}&q=${searchQuery}`,
    openmrsFetch,
  );

  return {
    listMembers: data?.data?.results ?? [],
    isLoadingListMembers: isLoading,
    error: error,
    mutateListMembers: mutate,
  };
}

export interface SimplePatient {
  uuid: string;
  name: string;
  identifier: string;
  sex: string;
  birthDate: string;
  nationalId: string;
  phoneNumber: string;
  governorate: string;
}

interface PatientSearchResponse {
  results: Array<{
    uuid: string;
    identifiers: Array<{ identifier: string; preferred: boolean; identifierType?: { display: string } }>;
    person: {
      gender: string;
      birthdate: string;
      display: string;
      attributes: Array<{ value: string; attributeType?: { display: string } }>;
      addresses: Array<{ preferred: boolean; stateProvince: string }>;
    };
  }>;
  totalCount: number;
}

const allPatientsRepresentation =
  'custom:(uuid,identifiers:(identifier,preferred,identifierType:(display)),' +
  'person:(gender,birthdate,display,attributes:(value,attributeType:(display)),addresses:(preferred,stateProvince)))';

export function useAllPatients(startIndex: number = 0, pageSize: number = 10, searchTerm: string = '') {
  // The classic `q` search (rather than a FHIR `name` filter) is what the rest of this app's patient
  // search uses -- OpenMRS core matches `q` against both patient names and identifiers (including
  // National ID-type ones), so this covers more of the visible columns than a name-only filter would.
  const searchParam = searchTerm ? `&q=${encodeURIComponent(searchTerm)}` : '';
  const url =
    `${restBaseUrl}/patient?v=${allPatientsRepresentation}&limit=${pageSize}&startIndex=${startIndex}` +
    `&totalCount=true${searchParam}`;

  // keepPreviousData avoids clearing `data` to undefined between keystrokes -- each search term is a
  // distinct SWR cache key, so without it the table would flicker to empty rows on every change while
  // the new key's request is in flight (isLoading still flips true per-key regardless of this option;
  // the consuming component guards against that separately).
  const { data, error, isLoading, isValidating, mutate } = useSWR<FetchResponse<PatientSearchResponse>, Error>(
    url,
    openmrsFetch,
    { keepPreviousData: true },
  );

  const patients: Array<SimplePatient> = useMemo(
    () =>
      (data?.data?.results ?? []).map((patient) => {
        const preferredIdentifier = patient.identifiers?.find((identifier) => identifier.preferred);
        return {
          uuid: patient.uuid,
          name: patient.person?.display ?? '--',
          identifier: (preferredIdentifier ?? patient.identifiers?.[0])?.identifier ?? '--',
          sex: patient.person?.gender ?? '--',
          birthDate: patient.person?.birthdate ?? '--',
          nationalId:
            patient.identifiers?.find((identifier) => identifier.identifierType?.display === 'National ID')
              ?.identifier ?? '--',
          phoneNumber:
            patient.person?.attributes?.find((attribute) => attribute.attributeType?.display === 'Phone Number')
              ?.value ?? '--',
          // The preferred address is used when set; fall back to the first address otherwise.
          governorate:
            (patient.person?.addresses?.find((address) => address.preferred) ?? patient.person?.addresses?.[0])
              ?.stateProvince ?? '--',
        };
      }),
    [data],
  );

  return {
    patients,
    totalPatients: data?.data?.totalCount ?? 0,
    isLoading,
    isValidating,
    error,
    mutate,
  };
}

export function useCohortTypes() {
  const apiUrl = `${cohortUrl}/cohorttype`;
  const { data, error, isLoading, mutate } = useSWR<FetchResponse<CohortResponse<CohortType>>, Error>(
    apiUrl,
    openmrsFetch,
  );

  return {
    listCohortTypes: data?.data?.results ?? [],
    isLoading,
    error,
    mutate,
  };
}
