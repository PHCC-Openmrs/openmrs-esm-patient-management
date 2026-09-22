import { useMemo } from 'react';
import type { Concept } from '../types';
import { useQueues } from './useQueues';

/**
 * The distinct priorities the queues in a location allow, for the priority filter above the
 * queue table. Mirrors useQueueStatuses, with one deliberate difference: the list is left in the
 * order the backend returns allowedPriorities (Not Urgent, Urgent, Emergency) rather than sorted
 * alphabetically, so the dropdown reads in order of severity and matches the order the same
 * priorities appear in on the Move/Transition modals.
 */
function usePriorities(locationUuid?: string) {
  const { queues, isLoading } = useQueues(locationUuid);

  return useMemo(() => {
    const seen = new Set<string>();
    const priorities: Array<Concept> = [];

    for (const queue of queues ?? []) {
      for (const priority of queue?.allowedPriorities ?? []) {
        if (priority?.uuid && !seen.has(priority.uuid)) {
          seen.add(priority.uuid);
          priorities.push(priority);
        }
      }
    }

    return { priorities, isLoadingPriorities: isLoading };
  }, [queues, isLoading]);
}

export default usePriorities;
