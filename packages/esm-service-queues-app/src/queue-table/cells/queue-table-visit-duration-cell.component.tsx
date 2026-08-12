import React from 'react';
import dayjs from 'dayjs';
import { useConfig } from '@openmrs/esm-framework';
import QueueDuration from '../components/queue-duration.component';
import { type ConfigObject } from '../../config-schema';
import { type QueueTableColumnFunction, type QueueTableCellComponentProps } from '../../types';

// Unlike the "wait-time" column (time since the current queue entry started, resets on every
// transition), this shows time since the whole visit started, running until the visit ends -
// i.e. how long the patient has been in the building, not just in this particular queue.
export const QueueTableVisitDurationCell = ({ queueEntry }: QueueTableCellComponentProps) => {
  const { waitTimeThresholds } = useConfig<ConfigObject>();
  const startedAt = dayjs(queueEntry.visit?.startDatetime).toDate();
  const endedAt = queueEntry.visit?.stopDatetime ? dayjs(queueEntry.visit.stopDatetime).toDate() : null;
  return <QueueDuration startedAt={startedAt} endedAt={endedAt} thresholds={waitTimeThresholds} />;
};

export const queueTableVisitDurationColumn: QueueTableColumnFunction = (key, header) => ({
  key,
  header,
  CellComponent: QueueTableVisitDurationCell,
  getFilterableValue: null,
});
