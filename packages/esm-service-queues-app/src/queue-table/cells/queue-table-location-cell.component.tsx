import React from 'react';
import { type QueueTableColumnFunction, type QueueTableCellComponentProps } from '../../types';

export const QueueTableLocationCell = ({ queueEntry }: QueueTableCellComponentProps) => {
  return <>{queueEntry.visit?.location?.display ?? '--'}</>;
};

export const queueTableLocationColumn: QueueTableColumnFunction = (key, header) => ({
  key,
  header,
  CellComponent: QueueTableLocationCell,
  getFilterableValue: (queueEntry) => queueEntry.visit?.location?.display,
});
