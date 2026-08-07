import React from 'react';
import useSWR from 'swr';
import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { type PatientProgram, type QueueTableColumnFunction, type QueueTableCellComponentProps } from '../../types';

function useActivePatientPrograms(patientUuid: string) {
  const url = `${restBaseUrl}/programenrollment?patient=${patientUuid}&v=custom:(uuid,display,program:(name),dateEnrolled,dateCompleted)`;
  const { data, isLoading } = useSWR<{ data: { results: Array<PatientProgram> } }, Error>(
    patientUuid ? url : null,
    openmrsFetch,
  );

  const activePrograms = data?.data?.results?.filter((enrollment) => !enrollment.dateCompleted) ?? [];

  return { activePrograms, isLoading };
}

export const QueueTableProgramsCell = ({ queueEntry }: QueueTableCellComponentProps) => {
  const { activePrograms, isLoading } = useActivePatientPrograms(queueEntry.patient?.uuid);

  if (isLoading) {
    return <>--</>;
  }

  if (!activePrograms.length) {
    return <>--</>;
  }

  return <>{activePrograms.map((enrollment) => enrollment.program?.name).join(', ')}</>;
};

export const queueTableProgramsColumn: QueueTableColumnFunction = (key, header) => ({
  key,
  header,
  CellComponent: QueueTableProgramsCell,
  getFilterableValue: null,
});
