import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { type ConfigObject } from './config-schema';
import { updateQueueEntry } from './modals/queue-entry-actions.resource';
import { type QueueEntry } from './types';

const moduleName = '@openmrs/esm-service-queues-app';

/**
 * Ends a patient's active queue entry when esm-dispensing-app signals that their pharmacy
 * dispensing is complete, so pharmacy staff don't have to separately click "remove" in the
 * queue app. Only acts if the patient's active queue entry is actually in the configured
 * pharmacy queue (`config.pharmacyQueueName`) — a patient in any other queue is left alone.
 * Idempotent: a repeat signal for an already-ended entry is a no-op.
 */
export async function completePharmacyQueueEntryForPatient(patientUuid: string): Promise<void> {
  try {
    if (!patientUuid) {
      return;
    }

    const { data } = await openmrsFetch<{ results: Array<QueueEntry> }>(
      `${restBaseUrl}/queue-entry?patient=${patientUuid}&v=custom:(uuid,queue:(uuid,name))&isEnded=false`,
    );
    const activeQueueEntry = data?.results?.[0];

    if (!activeQueueEntry) {
      return;
    }

    const { pharmacyQueueName } = await getConfig<ConfigObject>(moduleName);

    if (activeQueueEntry.queue?.name?.toLowerCase() !== pharmacyQueueName?.toLowerCase()) {
      return;
    }

    await updateQueueEntry(activeQueueEntry.uuid, {
      endedAt: new Date().toISOString(),
    });

    await mutate(
      (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
    );
  } catch (error) {
    console.error('Failed to end pharmacy queue entry after dispensing completed', error);
  }
}
