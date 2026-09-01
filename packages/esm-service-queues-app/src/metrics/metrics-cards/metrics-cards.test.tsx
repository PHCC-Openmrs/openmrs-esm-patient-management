import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { mockSession, mockStatusInService, mockPatientAlice, mockPatientBrian } from '__mocks__';
import { renderWithSwr } from 'tools';
import { type ConfigObject, configSchema } from '../../config-schema';
import { useQueueEntries } from '../../hooks/useQueueEntries';
import { type QueueEntry } from '../../types';
import CheckedInPatientsExtension from './checked-in-patients.extension';
import CompletedVisitsExtension from './completed-visits.extension';
import AverageVisitDurationExtension from './average-visit-duration.extension';

const mockUseConfig = vi.mocked(useConfig<ConfigObject>);
const mockUseSession = vi.mocked(useSession);
const mockUseQueueEntries = vi.mocked(useQueueEntries);

vi.mock('../../hooks/useQueueEntries', async () => ({
  ...((await vi.importActual('../../hooks/useQueueEntries')) as object),
  useQueueEntries: vi.fn(),
}));

function makeEntry(overrides: Partial<QueueEntry>): QueueEntry {
  return {
    uuid: 'entry-uuid',
    display: 'Some Patient',
    endedAt: null,
    locationWaitingFor: null,
    patient: mockPatientAlice,
    priority: null,
    priorityComment: null,
    providerWaitingFor: null,
    queue: null,
    startedAt: '2026-09-01T07:00:00.000+0000',
    status: mockStatusInService,
    visit: null,
    sortWeight: 0,
    queueComingFrom: null,
    previousQueueEntry: null,
    ...overrides,
  } as QueueEntry;
}

describe('service queues metrics cards', () => {
  const defaultConfig = getDefaultsFromConfigSchema(configSchema);

  beforeEach(() => {
    mockUseConfig.mockReturnValue(defaultConfig as ConfigObject);
    mockUseSession.mockReturnValue(mockSession.data);
  });

  describe('CheckedInPatientsExtension', () => {
    it('shows the count of distinct patients with an open "In Service" entry', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [makeEntry({ uuid: 'e1', patient: mockPatientAlice }), makeEntry({ uuid: 'e2', patient: mockPatientBrian })],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('In Service')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('does not double-count a patient with more than one open entry', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [makeEntry({ uuid: 'e1', patient: mockPatientAlice }), makeEntry({ uuid: 'e2', patient: mockPatientAlice })],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('1')).toBeInTheDocument();
    });

    it('queries with isEnded: false and the session location, scoped to the "In Service" status', () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 0,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(mockUseQueueEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          status: defaultConfig.concepts.defaultTransitionStatus,
          isEnded: false,
          location: mockSession.data.sessionLocation.uuid,
        }),
      );
    });
  });

  describe('CompletedVisitsExtension', () => {
    it('only counts entries that ended today', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({ uuid: 'today', endedAt: new Date().toISOString() }),
          makeEntry({ uuid: 'yesterday', endedAt: '2020-01-01T00:00:00.000+0000' }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CompletedVisitsExtension />);

      expect(await screen.findByText('Finished Service')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('does not send isEnded, since the backend only sets this status on already-ended entries', () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 0,
        mutate: vi.fn(),
      });

      renderWithSwr(<CompletedVisitsExtension />);

      const criteria = mockUseQueueEntries.mock.calls[0][0];
      expect(criteria).not.toHaveProperty('isEnded');
      expect(criteria).toEqual(
        expect.objectContaining({ status: defaultConfig.concepts.defaultFinishedServiceStatus }),
      );
    });
  });

  describe('AverageVisitDurationExtension', () => {
    it('averages visit duration (stopDatetime - startDatetime) across entries finished today', async () => {
      const today = new Date().toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'e1',
            endedAt: today,
            visit: { startDatetime: '2026-09-01T07:00:00.000+0000', stopDatetime: '2026-09-01T07:30:00.000+0000' } as any,
          }),
          makeEntry({
            uuid: 'e2',
            endedAt: today,
            visit: { startDatetime: '2026-09-01T08:00:00.000+0000', stopDatetime: '2026-09-01T09:00:00.000+0000' } as any,
          }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<AverageVisitDurationExtension />);

      // (30 + 60) / 2 = 45 minutes
      expect(await screen.findByText('45')).toBeInTheDocument();
    });

    it('shows a placeholder instead of a misleading average when there are no completions today', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 0,
        mutate: vi.fn(),
      });

      renderWithSwr(<AverageVisitDurationExtension />);

      expect(await screen.findByText('--')).toBeInTheDocument();
    });
  });
});
