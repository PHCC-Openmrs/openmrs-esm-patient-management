import React from 'react';
import { useVisitServicePrograms } from '../../hooks/usePatientPrograms';
import { type QueueTableColumnFunction, type QueueTableCellComponentProps } from '../../types';

export const QueueTableProgramsCell = ({ queueEntry }: QueueTableCellComponentProps) => {
  const { programs, isLoading } = useVisitServicePrograms(queueEntry.patient?.uuid, queueEntry.visit);

  if (isLoading) {
    return <>--</>;
  }

  if (!programs.length) {
    return <>--</>;
  }

  return <>{programs.map((program) => program.name).join(', ')}</>;
};

export const queueTableProgramsColumn: QueueTableColumnFunction = (key, header) => ({
  key,
  header,
  CellComponent: QueueTableProgramsCell,
  getFilterableValue: null,
});
