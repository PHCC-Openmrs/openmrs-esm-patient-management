import React from 'react';
import { useActivePatientPrograms } from '../../hooks/usePatientPrograms';
import { type QueueTableColumnFunction, type QueueTableCellComponentProps } from '../../types';

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
