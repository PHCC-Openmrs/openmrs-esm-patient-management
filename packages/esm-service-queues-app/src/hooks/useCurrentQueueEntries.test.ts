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

  it("asks the server for only each patient's latest entry", () => {
    // Most of a busy day's entries are superseded room steps the per-patient dedup discards;
    // fetching (and serializing) them was most of the table's load time.
    renderHook(() => useCurrentQueueEntries());

    const [searchCriteria] = mockUseQueueEntries.mock.calls[0];

    expect(searchCriteria.latestPerPatient).toBe(true);
  });

  describe('ended entries', () => {
    const { concepts } = getDefaultsFromConfigSchema<ConfigObject>(configSchema);
    const todayAt = (hour: number) => dayjs().startOf('day').add(hour, 'hour').toISOString();
    const entry = (uuid: string, overrides: Record<string, unknown> = {}) => ({
      uuid,
      patient: { uuid: `patient-${uuid}` },
      status: { uuid: concepts.defaultTransitionStatus, display: 'In Service' },
      startedAt: todayAt(8),
      endedAt: null,
      visit: { uuid: `visit-${uuid}`, startDatetime: todayAt(8), stopDatetime: null },
      ...overrides,
    });

    const currentEntryUuids = (queueEntries: Array<ReturnType<typeof entry>>) => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: queueEntries as any,
        isLoading: false,
        error: undefined,
        isValidating: false,
      } as any);
      const { result } = renderHook(() => useCurrentQueueEntries());
      return result.current.currentQueueEntries.map((queueEntry) => queueEntry.uuid);
    };

    it('drops In Service entries ended by the daily visit auto-close', () => {
      // Auto-closing a visit ends its queue entry but leaves the status In Service, so without
      // this every patient auto-closed at closing time went on being listed as In Service.
      const autoClosed = entry('auto-closed', {
        endedAt: todayAt(14),
        visit: { uuid: 'visit-auto-closed', startDatetime: todayAt(8), stopDatetime: todayAt(14) },
      });

      expect(currentEntryUuids([entry('open'), autoClosed])).toEqual(['open']);
    });

    it('drops an entry whose visit has ended even if the entry is not ended yet', () => {
      // The queue module ends entries of closed visits up to a minute later.
      const visitEnded = entry('visit-ended', {
        visit: { uuid: 'visit-visit-ended', startDatetime: todayAt(8), stopDatetime: todayAt(14) },
      });

      expect(currentEntryUuids([visitEnded])).toEqual([]);
    });

    it('keeps Finished Service entries, which are always ended', () => {
      const finished = entry('finished', {
        status: { uuid: concepts.defaultFinishedServiceStatus, display: 'Finished Service' },
        endedAt: todayAt(10),
        visit: { uuid: 'visit-finished', startDatetime: todayAt(8), stopDatetime: todayAt(10) },
      });

      expect(currentEntryUuids([finished])).toEqual(['finished']);
    });

    it("keeps a patient's open entry after they moved rooms", () => {
      const patient = { uuid: 'patient-moved' };
      const leftRoom = entry('left-room', { patient, endedAt: todayAt(9) });
      const newRoom = entry('new-room', { patient, startedAt: todayAt(9) });

      expect(currentEntryUuids([leftRoom, newRoom])).toEqual(['new-room']);
    });
  });
});
