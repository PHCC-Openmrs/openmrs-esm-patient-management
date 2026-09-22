import { getDefaultsFromConfigSchema, useConfig } from '@openmrs/esm-framework';
import { renderHook } from '@testing-library/react';
import dayjs from 'dayjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ConfigObject, configSchema } from '../config-schema';
import { useCurrentQueueEntries } from './useCurrentQueueEntries';
import { useQueueEntries } from './useQueueEntries';

vi.mock('./useQueueEntries', () => ({
  useQueueEntries: vi.fn().mockReturnValue({
    queueEntries: [],
    isLoading: false,
    error: undefined,
    isValidating: false,
  }),
}));

vi.mock('./usePatientPrograms', () => ({
  useActiveProgramsForPatients: vi.fn().mockReturnValue({ programsByPatientUuid: {}, isLoading: false }),
}));

const mockUseConfig = vi.mocked(useConfig<ConfigObject>);
const mockUseQueueEntries = vi.mocked(useQueueEntries);

describe('useCurrentQueueEntries', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(getDefaultsFromConfigSchema(configSchema));
  });

  it('bounds the fetch to today server-side', () => {
    // Unbounded, the endpoint returns the site's entire queue-entry history oldest-first, which
    // this hook then discards down to today: load time grew with every entry the site had ever
    // recorded, and today's rows landed on the last page of a sequential page-by-page fetch that
    // renders nothing until it finishes.
    renderHook(() => useCurrentQueueEntries());

    const [searchCriteria] = mockUseQueueEntries.mock.calls[0];

    expect(dayjs(searchCriteria.startedOnOrAfter).isSame(dayjs().startOf('day'))).toBe(true);
  });

  it('bounds no tighter than the start of the day', () => {
    // A queue entry cannot start before the visit it belongs to, so start-of-day keeps every
    // entry that the isQueueEntryFromToday filter would have kept. Bounding any later (e.g. to
    // "now minus an hour") would drop entries the table is meant to show.
    renderHook(() => useCurrentQueueEntries());

    const [searchCriteria] = mockUseQueueEntries.mock.calls[0];

    expect(dayjs(searchCriteria.startedOnOrAfter).isAfter(dayjs().startOf('day'))).toBe(false);
  });
});
