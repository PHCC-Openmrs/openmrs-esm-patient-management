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
    it('only counts entries whose visit started today', async () => {
      const today = new Date().toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({ uuid: 'today', patient: mockPatientAlice, visit: { startDatetime: today } as any }),
          makeEntry({
            uuid: 'yesterday',
            patient: mockPatientBrian,
            visit: { startDatetime: '2020-01-01T00:00:00.000+0000' } as any,
          }),
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

    it('excludes an overdue visit even after it is finally closed today', async () => {
      // The visit started days ago (tracked separately by the "Overdue Visits" widget) -
      // closing it today must not resurrect it as one of today's completions.
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'overdue-closed-today',
            startedAt: '2020-01-01T00:00:00.000+0000',
            endedAt: new Date().toISOString(),
            visit: { startDatetime: '2020-01-01T00:00:00.000+0000', stopDatetime: new Date().toISOString() } as any,
          }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 1,
        mutate: vi.fn(),
      });

      renderWithSwr(<CompletedVisitsExtension />);

      expect(await screen.findByText('Finished Service')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('counts a patient with two completed visits today as one completion', async () => {
      const today = new Date().toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({ uuid: 'visit-1', patient: mockPatientAlice, visit: { startDatetime: today } as any }),
          makeEntry({ uuid: 'visit-2', patient: mockPatientAlice, visit: { startDatetime: today } as any }),
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
    it('averages visit duration (stopDatetime - startDatetime) across distinct patients finished today', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
      const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'e1',
            patient: mockPatientAlice,
            endedAt: nowIso,
            visit: { startDatetime: thirtyMinutesAgo, stopDatetime: nowIso } as any,
          }),
          makeEntry({
            uuid: 'e2',
            patient: mockPatientBrian,
            endedAt: nowIso,
            visit: { startDatetime: sixtyMinutesAgo, stopDatetime: nowIso } as any,
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

    it('excludes an overdue visit closed today from the average, guarding against a multi-day duration skewing it', async () => {
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'overdue-closed-today',
            patient: mockPatientAlice,
            visit: { startDatetime: '2020-01-01T00:00:00.000+0000', stopDatetime: nowIso } as any,
          }),
          makeEntry({
            uuid: 'genuinely-today',
            patient: mockPatientBrian,
            visit: { startDatetime: thirtyMinutesAgo, stopDatetime: nowIso } as any,
          }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<AverageVisitDurationExtension />);

      // Only the genuinely-today 30-minute visit should count - not the multi-year overdue one.
      expect(await screen.findByText('30')).toBeInTheDocument();
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
