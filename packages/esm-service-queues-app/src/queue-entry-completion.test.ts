import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getConfig, openmrsFetch } from '@openmrs/esm-framework';
import { mutate } from 'swr';
import { getDefaultsFromConfigSchema } from '@openmrs/esm-framework';
import { configSchema } from './config-schema';
import { updateQueueEntry } from './modals/queue-entry-actions.resource';
import { completeActiveQueueEntryForPatient } from './queue-entry-completion';

vi.mock('swr', () => ({
  mutate: vi.fn(),
}));

vi.mock('./modals/queue-entry-actions.resource', () => ({
  updateQueueEntry: vi.fn().mockResolvedValue({ status: 200 }),
}));

const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockGetConfig = vi.mocked(getConfig);
const mockMutate = vi.mocked(mutate);
const mockUpdateQueueEntry = vi.mocked(updateQueueEntry);

const { defaultTransitionStatus, defaultFinishedServiceStatus } = getDefaultsFromConfigSchema(configSchema).concepts;

describe('completeActiveQueueEntryForPatient', () => {
  beforeEach(() => {
    mockGetConfig.mockResolvedValue(getDefaultsFromConfigSchema(configSchema));
  });

  it('marks the last queue entry Finished Service and refreshes the cache when it was In Service', async () => {
    mockOpenmrsFetch.mockResolvedValue({
      data: {
        results: [{ uuid: 'entry-1', startedAt: '2026-01-01T09:00:00.000Z', status: { uuid: defaultTransitionStatus } }],
      },
    } as any);

    await completeActiveQueueEntryForPatient('visit-uuid');

    expect(mockUpdateQueueEntry).toHaveBeenCalledWith('entry-1', {
      status: { uuid: defaultFinishedServiceStatus },
    });
    expect(mockMutate).toHaveBeenCalled();
  });

  it('still refreshes the cache when the last entry was not In Service (e.g. never actually served)', async () => {
    // The backend closes (sets endedAt on) the queue entry as part of stopping the visit
    // regardless of status, so the cache is stale even when there's no status to update here.
    mockOpenmrsFetch.mockResolvedValue({
      data: {
        results: [{ uuid: 'entry-1', startedAt: '2026-01-01T09:00:00.000Z', status: { uuid: 'some-other-status' } }],
      },
    } as any);

    await completeActiveQueueEntryForPatient('visit-uuid');

    expect(mockUpdateQueueEntry).not.toHaveBeenCalled();
    expect(mockMutate).toHaveBeenCalled();
  });

  it('picks the most recently started entry when a visit has more than one', async () => {
    mockOpenmrsFetch.mockResolvedValue({
      data: {
        results: [
          { uuid: 'older-entry', startedAt: '2026-01-01T08:00:00.000Z', status: { uuid: defaultTransitionStatus } },
          { uuid: 'newer-entry', startedAt: '2026-01-01T09:00:00.000Z', status: { uuid: defaultTransitionStatus } },
        ],
      },
    } as any);

    await completeActiveQueueEntryForPatient('visit-uuid');

    expect(mockUpdateQueueEntry).toHaveBeenCalledWith('newer-entry', expect.anything());
  });

  it('does nothing when no visitUuid is provided', async () => {
    await completeActiveQueueEntryForPatient(undefined);

    expect(mockOpenmrsFetch).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('does nothing when the visit has no queue entries', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [] } } as any);

    await completeActiveQueueEntryForPatient('visit-uuid');

    expect(mockUpdateQueueEntry).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
