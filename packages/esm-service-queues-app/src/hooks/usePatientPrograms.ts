import { getLocale, openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { useMemo } from 'react';
import useSWR from 'swr';
import useSWRImmutable from 'swr/immutable';
import { type PatientProgram } from '../types';

// Shared with useActivePatientProgramsForPatients below so both hit the same SWR cache key per
// patient, instead of double-fetching when a row's cell and the table's program filter both want
// the same patient's enrollments.
const activeProgramsRepString = 'custom:(uuid,display,program:(uuid,name),dateEnrolled,dateCompleted)';

function activeProgramsUrl(patientUuid: string) {
  return `${restBaseUrl}/programenrollment?patient=${patientUuid}&v=${activeProgramsRepString}`;
}

async function fetchActivePatientPrograms(patientUuid: string): Promise<Array<PatientProgram>> {
  const { data } = await openmrsFetch<{ results: Array<PatientProgram> }>(activeProgramsUrl(patientUuid));
  return (data?.results ?? []).filter((enrollment) => !enrollment.dateCompleted);
}

/**
 * A patient's program enrollments that haven't been completed yet, i.e. the programs shown in the
 * queue table's "Service type" column for that patient.
 */
export function useActivePatientPrograms(patientUuid: string) {
  const { data, isLoading } = useSWR<{ data: { results: Array<PatientProgram> } }, Error>(
    patientUuid ? activeProgramsUrl(patientUuid) : null,
    openmrsFetch,
  );

  const activePrograms = useMemo(
    () => data?.data?.results?.filter((enrollment) => !enrollment.dateCompleted) ?? [],
    [data?.data?.results],
  );

  return { activePrograms, isLoading };
}

/**
 * Every defined program in the system (not just ones with active enrollments), for populating a
 * "Service type" filter's options -- minus any program listed in this app's own
 * `hiddenServicePrograms` config, so a program hidden from the other Care Services pickers (the
 * start-visit form's Service field, the "Add service" enrollment form) is hidden from this filter
 * too. That config is duplicated (kept in sync manually) rather than read from
 * esm-patient-programs-app as an external module, because esm-patient-programs-app is never
 * loaded on this app's routes -- reading its config here left the "Service type" filter's
 * `useConfig` suspended forever, since the promise it throws while waiting for that module's
 * schema to register never resolves. The Program itself is untouched, so anything else that
 * reads it directly is unaffected.
 */
export function usePrograms() {
  const url = `${restBaseUrl}/program?v=custom:(uuid,name)`;
  const { data, ...rest } = useSWRImmutable<{ data: { results: Array<{ uuid: string; name: string }> } }, Error>(
    url,
    openmrsFetch,
  );

  const { hiddenServicePrograms } = useConfig<{ hiddenServicePrograms: Array<string> }>();

  const programs = useMemo(
    () =>
      data?.data?.results
        ?.filter((program) => !hiddenServicePrograms?.includes(program.uuid))
        .sort((a, b) => a.name.localeCompare(b.name, getLocale())) ?? [],
    [data?.data?.results, hiddenServicePrograms],
  );

  return { programs, ...rest };
}

/**
 * Active program enrollments for a batch of patients, keyed by patient UUID. Used to filter the
 * queue table by "Service type" (program) -- fetches each patient's enrollments individually,
 * the same way useActivePatientPrograms does for a single patient, since the /programenrollment
 * REST resource only supports filtering by `patient`, not by `program`.
 */
export function useActiveProgramsForPatients(patientUuids: Array<string>) {
  const swrKey = patientUuids.length ? ['queue-entry-active-programs', ...patientUuids] : null;
  const { data, isLoading } = useSWR<Array<Array<PatientProgram>>>(swrKey, () =>
    Promise.all(patientUuids.map(fetchActivePatientPrograms)),
  );

  const programsByPatientUuid = useMemo(() => {
    const map: Record<string, Array<PatientProgram>> = {};
    patientUuids.forEach((patientUuid, index) => {
      map[patientUuid] = data?.[index] ?? [];
    });
    return map;
  }, [data, patientUuids]);

  return { programsByPatientUuid, isLoading };
}
