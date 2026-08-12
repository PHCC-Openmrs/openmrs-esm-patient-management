import { type QueueOccupancy } from '../../types';

export interface NextQueueSelection {
  queue: QueueOccupancy['queue'];
  isFallback: boolean;
}

/**
 * Picks which queue a patient should be sent to next, given the current occupancy of each
 * candidate destination queue (in configured order):
 *  - Prefers a free (non-busy) queue. Ties are broken by fewest total (waiting + in-service)
 *    entries, then by configured order.
 *  - If every candidate is busy, falls back to the least-busy one.
 *  - Returns `null` only if there are no candidate queues at all.
 *
 * Also used for the single-destination case (one queue in `occupancy`): that queue is simply
 * returned, busy or not, since there is no other choice.
 */
export function selectNextQueue(occupancy: Array<QueueOccupancy>): NextQueueSelection | null {
  if (occupancy.length === 0) {
    return null;
  }

  const byLoad = (a: QueueOccupancy, b: QueueOccupancy) => a.totalCount - b.totalCount;

  const freeQueues = occupancy.filter((entry) => !entry.isBusy).sort(byLoad);
  if (freeQueues.length > 0) {
    return { queue: freeQueues[0].queue, isFallback: false };
  }

  const leastBusy = [...occupancy].sort(byLoad)[0];
  return { queue: leastBusy.queue, isFallback: true };
}
