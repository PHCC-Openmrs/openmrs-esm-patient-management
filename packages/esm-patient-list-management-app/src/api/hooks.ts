import { useEffect, useMemo } from 'react';
import useSWR from 'swr';
import useSWRInfinite from 'swr/infinite';
import {
  fhirBaseUrl,
  restBaseUrl,
  openmrsFetch,
  type FetchResponse,
  useConfig,
  useSession,
} from '@openmrs/esm-framework';
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

interface PatientContactDetails {
  nationalId: string;
  phoneNumber: string;
}

const patientContactDetailsRepresentation =
  'custom:(identifiers:(identifier,identifierType:(display)),person:(attributes:(value,attributeType:(display))))';

async function fetchPatientContactDetails(patientUuids: Array<string>): Promise<Record<string, PatientContactDetails>> {
  const results = await Promise.all(
    patientUuids.map((uuid) =>
      openmrsFetch(`${restBaseUrl}/patient/${uuid}?v=${patientContactDetailsRepresentation}`).then((res) => ({
        uuid,
        data: res.data,
      })),
    ),
  );

  return Object.fromEntries(
    results.map(({ uuid, data }) => [
      uuid,
      {
        nationalId:
          data?.identifiers?.find((identifier) => identifier.identifierType?.display === 'National ID')?.identifier ??
          '--',
        phoneNumber:
          data?.person?.attributes?.find((attribute) => attribute.attributeType?.display === 'Phone Number')?.value ??
          '--',
      },
    ]),
  );
}

function usePatientContactDetails(patientUuids: Array<string>) {
  const swrKey = patientUuids.length ? ['patient-contact-details', ...patientUuids] : null;
  const { data, isLoading } = useSWR(swrKey, () => fetchPatientContactDetails(patientUuids));

  return {
    contactDetailsByUuid: data ?? {},
    isLoadingContactDetails: isLoading,
  };
}

export function useAllPatients(startIndex: number = 0, pageSize: number = 10, searchTerm: string = '') {
  const searchParam = searchTerm ? `&name=${encodeURIComponent(searchTerm)}` : '';
  const url = `${fhirBaseUrl}/Patient?_count=${pageSize}&_getpagesoffset=${startIndex}&_sort=name${searchParam}`;

  // keepPreviousData avoids clearing `data` to undefined between keystrokes -- each search term is a
  // distinct SWR cache key, so without it the table (and isLoading) would flicker to empty on every change.
  const { data, error, isLoading, isValidating, mutate } = useSWR<FetchResponse<fhir.Bundle>, Error>(
    url,
    openmrsFetch,
    { keepPreviousData: true },
  );

  const basePatients = useMemo(
    () =>
      (data?.data?.entry ?? [])
        .map((entry) => entry.resource as fhir.Patient)
        .filter(Boolean)
        .map((patient) => ({
          uuid: patient.id,
          name: patient.name?.[0]?.text ?? '--',
          identifier: patient.identifier?.[0]?.value ?? '--',
          sex: patient.gender ?? '--',
          birthDate: patient.birthDate ?? '--',
          // The preferred address is mapped to the "home" use; fall back to the first address
          // for patients whose preferred address wasn't marked as such.
          governorate:
            (patient.address?.find((address) => address.use === 'home') ?? patient.address?.[0])?.state ?? '--',
        })),
    [data],
  );

  const patientUuids = useMemo(() => basePatients.map((patient) => patient.uuid), [basePatients]);
  const { contactDetailsByUuid, isLoadingContactDetails } = usePatientContactDetails(patientUuids);

  const patients: Array<SimplePatient> = useMemo(
    () =>
      basePatients.map((patient) => ({
        ...patient,
        nationalId: contactDetailsByUuid[patient.uuid]?.nationalId ?? '--',
        phoneNumber: contactDetailsByUuid[patient.uuid]?.phoneNumber ?? '--',
      })),
    [basePatients, contactDetailsByUuid],
  );

  return {
    patients,
    totalPatients: data?.data?.total ?? 0,
    isLoading: isLoading || (basePatients.length > 0 && isLoadingContactDetails),
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
