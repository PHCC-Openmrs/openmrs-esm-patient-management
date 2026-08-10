import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { type ConfigObject } from './config-schema';
import { updateQueueEntry } from './modals/queue-entry-actions.resource';
import { type QueueEntry } from './types';

const moduleName = '@openmrs/esm-service-queues-app';

/**
 * Marks a patient's active queue entry (if any) as "Finished Service" when their visit ends.
 * The entry stays in the "Patients currently in queue" table (filterable by status) until
 * staff clears it via the "Clear queue entries" action.
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

    const { concepts } = await getConfig<ConfigObject>(moduleName);

    await updateQueueEntry(activeQueueEntry.uuid, {
      status: { uuid: concepts.defaultFinishedServiceStatus },
    });

    await mutate(
      (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
    );
  } catch (error) {
    console.error('Failed to remove queue entry after visit ended', error);
  }
}
