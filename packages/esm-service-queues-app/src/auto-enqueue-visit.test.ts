import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getConfig, openmrsFetch } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { getDefaultsFromConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { postQueueEntry } from './create-queue-entry/queue-fields/queue-fields.resource';
import { DUPLICATE_QUEUE_ENTRY_ERROR_CODE } from './constants';
import { autoEnqueuePatientForVisit } from './auto-enqueue-visit';

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('./create-queue-entry/queue-fields/queue-fields.resource', () => ({
  postQueueEntry: vi.fn().mockResolvedValue({ status: 201 }),
}));

const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockGetConfig = vi.mocked(getConfig);
const mockMutate = vi.mocked(mutate);
const mockPostQueueEntry = vi.mocked(postQueueEntry);

const defaultConfig = getDefaultsFromConfigSchema(configSchema);

describe('autoEnqueuePatientForVisit', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue({ ...defaultConfig, defaultInitialServiceQueue: 'Front Desk' });
  });

  it('creates a queue entry and refreshes the cache when the patient is not already queued', async () => {
    mockOpenmrsFetch
      .mockResolvedValueOnce({ data: { results: [] } } as any) // existing entries check
      .mockResolvedValueOnce({ data: { results: [{ uuid: 'queue-uuid', name: 'Front Desk' }] } } as any) // queues
      .mockResolvedValueOnce({ data: { location: { uuid: 'location-uuid' } } } as any); // visit

    await autoEnqueuePatientForVisit('patient-uuid', 'visit-uuid');

    expect(mockPostQueueEntry).toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalled();
  });

  it('still refreshes the cache (without creating a duplicate entry) when the patient is already queued', async () => {
    // e.g. the visible "add to queue" fields on the start-visit form already created it - that
    // form's own submission also mutates on success, but this listener may run before or after
    // it settles, so this path must not skip refreshing the cache.
    mockOpenmrsFetch.mockResolvedValueOnce({ data: { results: [{ uuid: 'existing-entry' }] } } as any);

    await autoEnqueuePatientForVisit('patient-uuid', 'visit-uuid');

    expect(mockPostQueueEntry).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalled();
  });

  it('does nothing when no default initial service queue is configured', async () => {
    mockGetConfig.mockResolvedValue({ ...defaultConfig, defaultInitialServiceQueue: undefined });

    await autoEnqueuePatientForVisit('patient-uuid', 'visit-uuid');

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    expect(mockPostQueueEntry).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('silently ignores a duplicate-queue-entry error from a concurrent creation, without refreshing again', async () => {
    mockOpenmrsFetch.mockResolvedValueOnce({ data: { results: [] } } as any).mockRejectedValueOnce({
      responseBody: { error: { message: `Some prefix ${DUPLICATE_QUEUE_ENTRY_ERROR_CODE} suffix` } },
    });

    await expect(autoEnqueuePatientForVisit('patient-uuid', 'visit-uuid')).resolves.toBeUndefined();
  });

  it('does nothing when patientUuid or visitUuid is missing', async () => {
    await autoEnqueuePatientForVisit(undefined, 'visit-uuid');
    await autoEnqueuePatientForVisit('patient-uuid', undefined);

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
