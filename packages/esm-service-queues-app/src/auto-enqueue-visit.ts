import { getConfig, openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { type ConfigObject } from './config-schema';
import { postQueueEntry } from './create-queue-entry/queue-fields/queue-fields.resource';
import { DUPLICATE_QUEUE_ENTRY_ERROR_CODE } from './constants';
import { type Queue, type QueueEntry } from './types';

const moduleName = '@openmrs/esm-service-queues-app';

/**
 * Automatically adds a patient to the default queue when their visit starts, so that every
 * active visit shows up in "Patients currently in queue" without staff having to fill out the
 * (optional, often hidden) queue picker on the start-visit form.
 */
export async function autoEnqueuePatientForVisit(patientUuid: string, visitUuid: string): Promise<void> {
  try {
    if (!patientUuid || !visitUuid) {
      return;
    }

    const config = await getConfig<ConfigObject>(moduleName);
    const { defaultInitialServiceQueue, visitQueueNumberAttributeUuid, concepts } = config;

    if (!defaultInitialServiceQueue) {
      return;
    }

    const { data: existingEntries } = await openmrsFetch<{ results: Array<QueueEntry> }>(
      `${restBaseUrl}/queue-entry?patient=${patientUuid}&v=custom:(uuid)&isEnded=false`,
    );
    if (existingEntries?.results?.length > 0) {
      // Already queued, e.g. by the visible "add to queue" fields on the start-visit form. That
      // form's own submission already mutates the queue-entry cache on success, but this event
      // listener can run before or after that submission settles, so mutate defensively here too
      // rather than relying on ordering between two independent code paths.
      await mutate(
        (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
      );
      return;
    }

    const [{ data: queuesResponse }, { data: visitData }] = await Promise.all([
      openmrsFetch<{ results: Array<Queue> }>(`${restBaseUrl}/queue?v=custom:(uuid,name)`),
      openmrsFetch<{ location: { uuid: string } }>(`${restBaseUrl}/visit/${visitUuid}?v=custom:(location:(uuid))`),
    ]);

    const defaultQueue = queuesResponse?.results?.find(
      (queue) => queue.name?.toLowerCase() === defaultInitialServiceQueue.toLowerCase(),
    );
    if (!defaultQueue) {
      console.error(`Could not auto-queue patient: no queue named "${defaultInitialServiceQueue}" was found.`);
      return;
    }

    await postQueueEntry(
      visitUuid,
      defaultQueue.uuid,
      patientUuid,
      concepts.defaultPriorityConceptUuid,
      concepts.defaultTransitionStatus,
      0,
      visitData?.location?.uuid,
      visitQueueNumberAttributeUuid,
    );

    await mutate(
      (key) => typeof key === 'string' && (key.includes('/queue-entry') || key.includes('/visit-queue-entry')),
    );
  } catch (error) {
    if (error?.responseBody?.error?.message?.includes(DUPLICATE_QUEUE_ENTRY_ERROR_CODE)) {
      return;
    }
    console.error('Failed to automatically add patient to queue after visit started', error);
  }
}
