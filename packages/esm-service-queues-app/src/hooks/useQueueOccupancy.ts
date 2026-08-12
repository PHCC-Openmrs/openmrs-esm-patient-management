import { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { openmrsFetch, restBaseUrl, useConfig } from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import { type Queue, type QueueEntry, type QueueOccupancy } from '../types';
import { useQueues } from './useQueues';

// Every existing call site in this app only ever filters `/queue-entry` by a single `queue` UUID
// (see queue-table-by-status.component.tsx, queue-tables-for-all-statuses.component.tsx), so rather
// than assume the backend honours a comma-joined multi-queue filter, we fetch each queue's entries
// with its own request and aggregate client-side.
const occupancyRepString = 'custom:(uuid,queue:(uuid),status:(uuid),endedAt)';

async function fetchActiveEntriesForQueue(queueUuid: string): Promise<Array<QueueEntry>> {
  const { data } = await openmrsFetch<{ results: Array<QueueEntry> }>(
    `${restBaseUrl}/queue-entry?queue=${queueUuid}&isEnded=false&v=${occupancyRepString}`,
  );
  return data?.results ?? [];
}

function computeOccupancy(
  entriesByQueue: Array<Array<QueueEntry>> | undefined,
  queueUuids: Array<string>,
  queues: Array<Queue>,
  occupiedStatusConceptUuid: string,
): Array<QueueOccupancy> {
  if (!entriesByQueue) {
    return [];
  }
  return queueUuids.map((queueUuid, index) => {
    const entries = entriesByQueue[index] ?? [];
    const queue = queues.find((q) => q.uuid === queueUuid);
    const busyCount = entries.filter((entry) => entry.status?.uuid === occupiedStatusConceptUuid).length;
    return {
      queue: queue ?? ({ uuid: queueUuid, display: queueUuid, name: queueUuid } as Queue),
      busyCount,
      totalCount: entries.length,
      isBusy: busyCount > 0,
    };
  });
}

/**
 * Computes, for each of the given queue UUIDs, whether the queue currently has an entry being
 * attended to (the "occupied" status) and how many active entries it has in total. Used by the
 * "auto-assign" queue entry action to pick the least-busy destination queue.
 *
 * The returned `mutate` forces a fresh fetch and resolves with the freshly-computed
 * `QueueOccupancy[]` (not the cached `occupancy` value) so callers can safely re-check occupancy
 * immediately before acting on it.
 */
export function useQueueOccupancy(queueUuids: Array<string>) {
  const config = useConfig<ConfigObject>();
  const { queues, isLoading: queuesLoading } = useQueues();
  const occupiedStatusConceptUuid = config.occupiedStatusConceptUuid ?? config.concepts.defaultTransitionStatus;

  const swrKey = queueUuids.length ? ['queue-occupancy', ...queueUuids] : null;
  const {
    data,
    error,
    isLoading: entriesLoading,
    mutate,
  } = useSWR<Array<Array<QueueEntry>>>(swrKey, () => Promise.all(queueUuids.map(fetchActiveEntriesForQueue)), {
    dedupingInterval: 0,
  });

  const occupancy = useMemo(
    () => computeOccupancy(data, queueUuids, queues, occupiedStatusConceptUuid),
    [data, queueUuids, queues, occupiedStatusConceptUuid],
  );

  const revalidate = useCallback(async () => {
    const freshData = await mutate();
    return computeOccupancy(freshData, queueUuids, queues, occupiedStatusConceptUuid);
  }, [mutate, queueUuids, queues, occupiedStatusConceptUuid]);

  return {
    occupancy,
    isLoading: queuesLoading || entriesLoading,
    error,
    mutate: revalidate,
  };
}
