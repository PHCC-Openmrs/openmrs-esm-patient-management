import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { type ConfigObject } from './config-schema';
import { updateQueueEntry } from './modals/queue-entry-actions.resource';
import { type QueueEntry } from './types';

const moduleName = '@openmrs/esm-service-queues-app';

/**
 * Marks the last queue entry of a visit as "Finished Service" when that visit ends - but only if
 * the patient was actually being attended to (status = `defaultTransitionStatus`, e.g. "In
 * Service") at that point. A visit ended while its queue entry was still just "Waiting" (e.g.
 * from the Overdue visits list, where the patient was never actually seen) is left with its
 * existing status instead of being misrepresented as finished service.
 *
 * Looked up by `visit`, not by `patient` + `isEnded=false`: the `queue` backend module's own
 * VisitWithQueueEntriesSaveHandler closes any still-open queue entry for a visit synchronously,
 * as part of the same request that stops the visit - before this `visit-ended` event listener
 * ever runs. So by the time we'd query `isEnded=false`, the entry is already ended and that
 * query finds nothing. Fetching by `visit` instead returns the whole chain of entries
 * (ended or not) for that visit; the most recently started one is the one to consider - the
 * REST API allows updating status on an already-ended entry.
 */
export async function completeActiveQueueEntryForPatient(visitUuid: string): Promise<void> {
  try {
    if (!visitUuid) {
      return;
    }

    const { data } = await openmrsFetch<{ results: Array<QueueEntry> }>(
      `${restBaseUrl}/queue-entry?visit=${visitUuid}&v=custom:(uuid,startedAt,status:(uuid))`,
    );
    const entries = data?.results ?? [];
    const lastQueueEntry = [...entries].sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
    )[0];

    if (!lastQueueEntry) {
      return;
    }

    const { concepts } = await getConfig<ConfigObject>(moduleName);

    if (lastQueueEntry.status?.uuid === concepts.defaultTransitionStatus) {
      await updateQueueEntry(lastQueueEntry.uuid, {
        status: { uuid: concepts.defaultFinishedServiceStatus },
      });
    }

    // Stopping the visit always closes its queue entries server-side (VisitWithQueueEntriesSaveHandler
    // sets endedAt), even on the branch above where this handler itself has nothing further to update -
    // so the queue-entry cache is stale regardless of which branch ran, not just when we changed status.
    await mutate(
      (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
    );
  } catch (error) {
    console.error('Failed to mark queue entry as finished after visit ended', error);
  }
}
