import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { mockSession, mockPatientAlice, mockPatientBrian } from '__mocks__';
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
const defaultConfig = getDefaultsFromConfigSchema(configSchema);
const { defaultTransitionStatus, defaultFinishedServiceStatus } = defaultConfig.concepts;
const inServiceStatus = { uuid: defaultTransitionStatus, display: 'In Service' };
const finishedServiceStatus = { uuid: defaultFinishedServiceStatus, display: 'Finished Service' };

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
    startedAt: new Date().toISOString(),
    status: inServiceStatus,
    visit: null,
    sortWeight: 0,
    queueComingFrom: null,
    previousQueueEntry: null,
    ...overrides,
  } as QueueEntry;
}

describe('service queues metrics cards', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue(defaultConfig as ConfigObject);
    mockUseSession.mockReturnValue(mockSession.data);
  });

  it('fetches both In Service and Finished Service in one request, with no isEnded filter, and the session location', () => {
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [],
      isLoading: false,
      isValidating: false,
      error: undefined,
      totalCount: 0,
      mutate: vi.fn(),
    });

    renderWithSwr(<CheckedInPatientsExtension />);

    const criteria = mockUseQueueEntries.mock.calls[0][0];
    expect(criteria).not.toHaveProperty('isEnded');
    expect(criteria).toEqual(
      expect.objectContaining({
        status: [defaultTransitionStatus, defaultFinishedServiceStatus],
        location: mockSession.data.sessionLocation.uuid,
      }),
    );
  });

  describe('CheckedInPatientsExtension', () => {
    it('shows the count of distinct patients with an "In Service" entry', async () => {
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

    it('excludes an overdue visit that is still open and In Service, since it belongs to "Overdue Visits" instead', async () => {
      // A visit that started days ago and was never moved/closed - still shows as "In Service"
      // in the DB, but must not count as one of today's checked-in patients.
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'overdue-still-in-service',
            patient: mockPatientAlice,
            visit: { startDatetime: '2020-01-01T00:00:00.000+0000' } as any,
          }),
          makeEntry({ uuid: 'genuinely-today', patient: mockPatientBrian }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('In Service')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('does not count a patient whose only entry today is Finished Service', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [makeEntry({ uuid: 'e1', patient: mockPatientAlice, status: finishedServiceStatus })],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 1,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('In Service')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('counts a patient under "In Service" once they start a new visit after an earlier one finished today', async () => {
      // The exact reported scenario: finish one visit, start a new one the same day - the
      // patient should now count as In Service, not still (or additionally) as Finished Service.
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'finished-earlier',
            patient: mockPatientAlice,
            status: finishedServiceStatus,
            startedAt: anHourAgo,
            endedAt: anHourAgo,
          }),
          makeEntry({ uuid: 'in-service-now', patient: mockPatientAlice, status: inServiceStatus }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('In Service')).toBeInTheDocument();
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  describe('CompletedVisitsExtension', () => {
    it('only counts entries whose visit started today', async () => {
      const today = new Date().toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'today',
            patient: mockPatientAlice,
            status: finishedServiceStatus,
            visit: { startDatetime: today } as any,
          }),
          makeEntry({
            uuid: 'yesterday',
            patient: mockPatientBrian,
            status: finishedServiceStatus,
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
            status: finishedServiceStatus,
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
          makeEntry({
            uuid: 'visit-1',
            patient: mockPatientAlice,
            status: finishedServiceStatus,
            visit: { startDatetime: today } as any,
          }),
          makeEntry({
            uuid: 'visit-2',
            patient: mockPatientAlice,
            status: finishedServiceStatus,
            visit: { startDatetime: today } as any,
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

    it('no longer counts a patient as completed once they start a new visit the same day', async () => {
      // The exact reported scenario: a patient who finished one visit and then started a new,
      // still-active one should disappear from "Finished Service" - they're In Service now.
      const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({
            uuid: 'finished-earlier',
            patient: mockPatientAlice,
            status: finishedServiceStatus,
            startedAt: anHourAgo,
            endedAt: anHourAgo,
            visit: { startDatetime: anHourAgo, stopDatetime: anHourAgo } as any,
          }),
          makeEntry({ uuid: 'in-service-now', patient: mockPatientAlice, status: inServiceStatus }),
        ],
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: 2,
        mutate: vi.fn(),
      });

      renderWithSwr(<CompletedVisitsExtension />);

      expect(await screen.findByText('Finished Service')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
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
            status: finishedServiceStatus,
            endedAt: nowIso,
            visit: { startDatetime: thirtyMinutesAgo, stopDatetime: nowIso } as any,
          }),
          makeEntry({
            uuid: 'e2',
            patient: mockPatientBrian,
            status: finishedServiceStatus,
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
            status: finishedServiceStatus,
            visit: { startDatetime: '2020-01-01T00:00:00.000+0000', stopDatetime: nowIso } as any,
          }),
          makeEntry({
            uuid: 'genuinely-today',
            patient: mockPatientBrian,
            status: finishedServiceStatus,
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
