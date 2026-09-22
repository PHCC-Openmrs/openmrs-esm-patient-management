import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { mockSession, mockPatientAlice, mockPatientBrian } from '__mocks__';
import { renderWithSwr } from 'tools';
import { type ConfigObject, configSchema } from '../../config-schema';
import { useQueueEntries } from '../../hooks/useQueueEntries';
import {
  updateQueueTableSearchTerm,
  updateSelectedPriority,
  updateSelectedQueue,
  updateSelectedQueueLocationUuid,
  updateSelectedQueueStatus,
  updateSelectedService,
} from '../../store/store';
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
    // The store is global and persisted to sessionStorage - reset every filter so each test
    // starts unscoped.
    updateSelectedQueueLocationUuid(null);
    updateSelectedQueue(null, null);
    updateSelectedService(null, null);
    updateSelectedPriority(null, null);
    updateSelectedQueueStatus(null, null);
    updateQueueTableSearchTerm('');
  });

  it('fetches both In Service and Finished Service in one request, with no isEnded filter', () => {
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [],
      isLoading: false,
      isValidating: false,
      error: undefined,
      totalCount: 0,
      mutate: vi.fn(),
    });
    updateSelectedQueueLocationUuid(mockSession.data.sessionLocation.uuid);

    renderWithSwr(<CheckedInPatientsExtension />);

    const criteria = mockUseQueueEntries.mock.calls[0][0];
    expect(criteria).not.toHaveProperty('isEnded');
    // No `location` param: the endpoint filters that by the *queue's* location, while the queue
    // table scopes by the *visit's* location - so location is applied client-side instead, and
    // sending it here would count a different population than the table below these cards.
    expect(criteria).not.toHaveProperty('location');
    expect(criteria).toEqual(
      expect.objectContaining({
        status: [defaultTransitionStatus, defaultFinishedServiceStatus],
      }),
    );
  });

  it('counts only entries whose visit is at the selected queue location, matching the queue table', () => {
    // The reported bug: starting a visit at location A bumped the card at location B, because
    // the count followed the queue's location while the table followed the visit's location.
    const today = new Date().toISOString();
    updateSelectedQueueLocationUuid('location-a');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [
        makeEntry({
          uuid: 'visit-here',
          patient: mockPatientAlice,
          visit: { startDatetime: today, location: { uuid: 'location-a', display: 'Location A' } } as any,
        }),
        makeEntry({
          uuid: 'visit-elsewhere',
          patient: mockPatientBrian,
          visit: { startDatetime: today, location: { uuid: 'location-b', display: 'Location B' } } as any,
        }),
      ],
      isLoading: false,
      isValidating: false,
      error: undefined,
      totalCount: 2,
      mutate: vi.fn(),
    });

    renderWithSwr(<CheckedInPatientsExtension />);

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('counts only entries in the selected queue/room, matching the queue table below', () => {
    // The cards sit directly above the table and are read as its totals, so picking a room in
    // the table's "Show patients in queue" filter has to scope them too - otherwise the card
    // reports the whole location while the table lists one room.
    const today = new Date().toISOString();
    updateSelectedQueue('room-3', 'Doctor Room 3');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [
        makeEntry({
          uuid: 'in-room-3',
          patient: mockPatientAlice,
          queue: { uuid: 'room-3', display: 'Doctor Room 3' } as any,
          visit: { startDatetime: today } as any,
        }),
        makeEntry({
          uuid: 'in-room-1',
          patient: mockPatientBrian,
          queue: { uuid: 'room-1', display: 'Doctor Room 1' } as any,
          visit: { startDatetime: today } as any,
        }),
      ],
      isLoading: false,
      isValidating: false,
      error: undefined,
      totalCount: 2,
      mutate: vi.fn(),
    });

    renderWithSwr(<CheckedInPatientsExtension />);

    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('scopes the count to the selected service, the same way the queue table queries it', () => {
    updateSelectedService('service-uuid', 'Triage');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [],
      isLoading: false,
      isValidating: false,
      error: undefined,
      totalCount: 0,
      mutate: vi.fn(),
    });

    renderWithSwr(<CheckedInPatientsExtension />);

    expect(mockUseQueueEntries.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        service: 'service-uuid',
        status: [defaultTransitionStatus, defaultFinishedServiceStatus],
      }),
    );
  });

  describe('CheckedInPatientsExtension', () => {
    it('shows the count of distinct patients with an "In Service" entry', async () => {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: [
          makeEntry({ uuid: 'e1', patient: mockPatientAlice }),
          makeEntry({ uuid: 'e2', patient: mockPatientBrian }),
        ],
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
        queueEntries: [
          makeEntry({ uuid: 'e1', patient: mockPatientAlice }),
          makeEntry({ uuid: 'e2', patient: mockPatientAlice }),
        ],
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

  // Every filter the toolbar above the queue table offers has to narrow these cards too,
  // otherwise the totals describe a different population than the rows underneath them.
  describe('filters shared with the queue table', () => {
    const notUrgent = { uuid: 'f4620bfa-3625-4883-bd3f-84c2cce14470', display: 'Not Urgent' };
    const emergency = { uuid: '04f6f7e0-e3cb-4e13-a133-4479f759574e', display: 'Emergency' };

    function mockEntries(entries: Array<QueueEntry>) {
      mockUseQueueEntries.mockReturnValue({
        queueEntries: entries,
        isLoading: false,
        isValidating: false,
        error: undefined,
        totalCount: entries.length,
        mutate: vi.fn(),
      });
    }

    it('counts only the selected priority', async () => {
      mockEntries([
        makeEntry({ uuid: 'a', patient: mockPatientAlice, priority: emergency }),
        makeEntry({ uuid: 'b', patient: mockPatientBrian, priority: notUrgent }),
      ]);
      updateSelectedPriority(emergency.uuid, emergency.display);

      renderWithSwr(<CheckedInPatientsExtension />);

      // Alice only - Brian is Not Urgent.
      expect(await screen.findByText('1')).toBeInTheDocument();
    });

    it('counts every priority when the priority filter is cleared', async () => {
      mockEntries([
        makeEntry({ uuid: 'a', patient: mockPatientAlice, priority: emergency }),
        makeEntry({ uuid: 'b', patient: mockPatientBrian, priority: notUrgent }),
      ]);

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('2')).toBeInTheDocument();
    });

    it("narrows with the table's search box, so the total matches the rows left on screen", async () => {
      mockEntries([
        makeEntry({ uuid: 'a', patient: mockPatientAlice }),
        makeEntry({ uuid: 'b', patient: mockPatientBrian }),
      ]);
      updateQueueTableSearchTerm('alice');

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('1')).toBeInTheDocument();
    });

    it('zeroes a card whose status the user has explicitly filtered away', async () => {
      mockEntries([makeEntry({ uuid: 'a', patient: mockPatientAlice, status: inServiceStatus })]);
      updateSelectedQueueStatus(finishedServiceStatus.uuid, finishedServiceStatus.display);

      renderWithSwr(<CheckedInPatientsExtension />);

      expect(await screen.findByText('0')).toBeInTheDocument();
    });

    // Regression guard: the queue table falls back to "In Service" when no status has been
    // picked. Treating that fallback as a filter left these two cards reading 0 and "--" on
    // every fresh load, which is the one state the page is almost always in.
    it('still reports finished visits when no status has been explicitly picked', async () => {
      const startDatetime = new Date();
      const stopDatetime = new Date(startDatetime.getTime() + 30 * 60 * 1000);
      mockEntries([
        makeEntry({
          uuid: 'a',
          patient: mockPatientAlice,
          status: finishedServiceStatus,
          visit: {
            uuid: 'visit-a',
            startDatetime: startDatetime.toISOString(),
            stopDatetime: stopDatetime.toISOString(),
          },
        } as Partial<QueueEntry>),
      ]);

      renderWithSwr(<CompletedVisitsExtension />);

      expect(await screen.findByText('1')).toBeInTheDocument();
    });
  });
});
