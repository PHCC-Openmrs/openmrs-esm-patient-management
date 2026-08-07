import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { endPatientStatus } from './service-queues.resource';
import { type QueueEntry } from './types';

/**
 * Ends a patient's active queue entry (if any), removing it from the "Patients currently in
 * queue" table. Called when a visit ends, so that same-day walk-in/walk-out patients don't
 * linger in the active queue after they've left.
 */
export async function completeActiveQueueEntryForPatient(patientUuid: string): Promise<void> {
  try {
    if (!patientUuid) {
      return;
    }

    const { data } = await openmrsFetch<{ results: Array<QueueEntry> }>(
      `${restBaseUrl}/queue-entry?patient=${patientUuid}&v=custom:(uuid,queue:(uuid))&isEnded=false`,
    );
    const activeQueueEntry = data?.results?.[0];

    if (!activeQueueEntry) {
      return;
    }

    await endPatientStatus(activeQueueEntry.queue.uuid, activeQueueEntry.uuid, new Date());

    await mutate(
      (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
    );
  } catch (error) {
    console.error('Failed to remove queue entry after visit ended', error);
  }
}
