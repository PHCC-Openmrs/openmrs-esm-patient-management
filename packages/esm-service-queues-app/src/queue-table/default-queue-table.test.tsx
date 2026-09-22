import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  mockLocationSurgery,
  mockLocationTriage,
  mockPatientBrian,
  mockQueueEntries,
  mockQueueEntryAlice,
  mockQueueRooms,
  mockQueueSurgery,
  mockQueueTriage,
  mockServices,
  mockSession,
} from '__mocks__';
import React from 'react';
import { renderWithSwr } from 'tools';
import { type ConfigObject, configSchema } from '../config-schema';
import { useQueueLocations } from '../create-queue-entry/hooks/useQueueLocations';
import { useQueueEntries } from '../hooks/useQueueEntries';
import { useQueues } from '../hooks/useQueues';
import { ALL_QUEUE_STATUSES_UUID, updateSelectedQueue, updateSelectedQueueStatus } from '../store/store';
import DefaultQueueTable from '../queue-table/default-queue-table.component';

const mockUseConfig = vi.mocked(useConfig<ConfigObject>);
const mockUseQueueEntries = vi.mocked(useQueueEntries);
const mockQueueLocations = vi.mocked(useQueueLocations);
const mockUseSession = vi.mocked(useSession);
const mockUseQueues = vi.mocked(useQueues);
const { defaultTransitionStatus, defaultFinishedServiceStatus } = getDefaultsFromConfigSchema(configSchema).concepts;
const inServiceStatus = { uuid: defaultTransitionStatus, display: 'In Service' };
const finishedServiceStatus = { uuid: defaultFinishedServiceStatus, display: 'Finished Service' };

vi.mock('../hooks/useQueues', () => {
  return {
    useQueues: vi.fn().mockReturnValue({ queues: mockServices }),
  };
});

vi.mock('../create-queue-entry/hooks/useQueueLocations', async () => ({
  ...((await vi.importActual('../create-queue-entry/hooks/useQueueLocations')) as object),
  useQueueLocations: vi.fn(),
}));

vi.mock('../hooks/useQueueEntries', async () => ({
  ...((await vi.importActual('../hooks/useQueueEntries')) as object),
  useQueueEntries: vi.fn(),
}));

describe('DefaultQueueTable', () => {
  beforeEach(() => {
    mockUseConfig.mockReturnValue({
      ...getDefaultsFromConfigSchema(configSchema),
      customPatientChartUrl: 'someUrl',
      visitQueueNumberAttributeUuid: 'c61ce16f-272a-41e7-9924-4c555d0932c5',
    });
    mockUseSession.mockReturnValue(mockSession.data);
    // Restored explicitly because the status-filter test below swaps in queues that carry
    // allowedStatuses, which would otherwise leak into whichever test runs after it.
    mockUseQueues.mockReturnValue({ queues: mockServices } as ReturnType<typeof useQueues>);
    mockQueueLocations.mockReturnValue({ queueLocations: [], isLoading: false, error: null });
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [],
      isLoading: false,
      error: undefined,
      totalCount: 0,
      isValidating: false,
      mutate: vi.fn(),
    });
  });

  afterEach(() => {
    // Selected queue status and queue are persisted in session storage via the global
    // service-queues store, so they must be reset explicitly to avoid leaking into other tests.
    updateSelectedQueueStatus(undefined, undefined);
    updateSelectedQueue(undefined, undefined);
  });

  it('fetches both In Service and Finished Service in one request, with no isEnded filter, regardless of the selected status', async () => {
    // Fetching only the currently-selected status would prevent the per-patient dedup below from
    // ever seeing a patient's other, differently-statused entry - see the cross-status test below.
    updateSelectedQueueStatus(defaultFinishedServiceStatus, 'Finished Service');

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    const criteria = mockUseQueueEntries.mock.calls.at(-1)[0];
    expect(criteria).toEqual(
      expect.objectContaining({ status: [defaultTransitionStatus, defaultFinishedServiceStatus] }),
    );
    expect(criteria).not.toHaveProperty('isEnded');
  });

  it('does not scope the request to the selected queue', async () => {
    // Scoping the query to one queue hides the other half of a room-to-room move from the
    // per-patient dedup, which is what the next test exercises.
    updateSelectedQueue(mockQueueSurgery.uuid, mockQueueSurgery.display);

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(mockUseQueueEntries.mock.calls.at(-1)[0]).not.toHaveProperty('queue');
  });

  it('lists a patient moved between rooms only under the room they moved to, not the one they left', async () => {
    // Moving a patient ends their entry in the room they left and opens a new one in the
    // destination room. Both are "In Service" and both belong to today's visit, so only the
    // per-patient dedup distinguishes them - and it can only do so if entries from every queue
    // were fetched, not just the selected one.
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();
    const todaysVisit = { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: null };

    const entryInRoomSheLeft = {
      ...mockQueueEntryAlice,
      uuid: 'alice-room-left',
      queue: mockQueueTriage,
      status: inServiceStatus,
      startedAt: anHourAgo,
      endedAt: nowIso,
      visit: todaysVisit,
    };
    const entryInRoomSheMovedTo = {
      ...mockQueueEntryAlice,
      uuid: 'alice-room-moved-to',
      queue: mockQueueSurgery,
      status: inServiceStatus,
      startedAt: nowIso,
      endedAt: null,
      visit: todaysVisit,
    };
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [entryInRoomSheLeft, entryInRoomSheMovedTo],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    updateSelectedQueue(mockQueueTriage.uuid, mockQueueTriage.display);
    const { unmount } = rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(screen.getByText(/no patients to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice Johnson/i })).not.toBeInTheDocument();

    unmount();

    updateSelectedQueue(mockQueueSurgery.uuid, mockQueueSurgery.display);
    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(screen.getAllByRole('link', { name: /Alice Johnson/i })).toHaveLength(1);
  });

  it('renders an empty state view if data is unavailable', async () => {
    mockQueueLocations.mockReturnValue({ queueLocations: [], isLoading: false, error: null });
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [],
      isLoading: false,
      error: undefined,
      totalCount: 0,
      isValidating: false,
      mutate: vi.fn(),
    });

    rendeDefaultQueueTable();

    await screen.findByRole('table');

    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText(/patients currently in queue/i)).toBeInTheDocument();
    expect(screen.getByText(/no patients to display/i)).toBeInTheDocument();
  });

  it('renders a tabular overview of visit queue entry data when available', async () => {
    mockQueueLocations.mockReturnValue({
      queueLocations: [mockLocationSurgery, mockLocationTriage],
      isLoading: false,
      error: null,
    });
    const todaysQueueEntries = mockQueueEntries.map((entry) => ({
      ...entry,
      status: inServiceStatus,
      startedAt: new Date().toISOString(),
      visit: entry.visit ? { ...entry.visit, startDatetime: new Date().toISOString() } : entry.visit,
    }));
    mockUseQueueEntries.mockReturnValue({
      queueEntries: todaysQueueEntries,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    rendeDefaultQueueTable();

    await screen.findByRole('table');

    expect(screen.getByText(/patients currently in queue/i)).toBeInTheDocument();
    expect(screen.queryByText(/no patients to display/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Brian Johnson/i })).toBeInTheDocument();
    const john = screen.getByRole('link', { name: /Alice Johnson/i });
    expect(john).toBeInTheDocument();
    expect(john).toHaveAttribute('href', 'someUrl');

    const expectedColumnHeaders = [/name/i, /status/i, /location/i, /wait time/i, /service type/i];
    expectedColumnHeaders.forEach((header) => {
      expect(
        screen.getByRole('columnheader', {
          name: header,
        }),
      ).toBeInTheDocument();
    });
  });

  it('excludes an overdue visit even after it is finally closed today', async () => {
    // The visit itself started days ago (and would show in the separate "Overdue Visits"
    // widget) - closing it today must not resurrect it here, regardless of its startedAt/endedAt.
    const overdueVisitClosedToday = {
      ...mockQueueEntryAlice,
      status: finishedServiceStatus,
      startedAt: '2020-01-01T00:00:00.000+0000',
      endedAt: new Date().toISOString(),
      visit: {
        ...mockQueueEntryAlice.visit,
        startDatetime: '2020-01-01T00:00:00.000+0000',
        stopDatetime: new Date().toISOString(),
      },
    };
    updateSelectedQueueStatus(defaultFinishedServiceStatus, 'Finished Service');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [overdueVisitClosedToday],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 1,
    });

    rendeDefaultQueueTable();

    await screen.findByRole('table');

    expect(screen.getByText(/no patients to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice Johnson/i })).not.toBeInTheDocument();
  });

  it('excludes an overdue visit moved to a new room today, since the visit itself is still from a previous day', async () => {
    const movedOverdueVisit = {
      ...mockQueueEntryAlice,
      status: inServiceStatus,
      startedAt: new Date().toISOString(),
      endedAt: null,
      visit: {
        ...mockQueueEntryAlice.visit,
        startDatetime: '2020-01-01T00:00:00.000+0000',
        stopDatetime: null,
      },
    };
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [movedOverdueVisit],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 1,
    });

    rendeDefaultQueueTable();

    await screen.findByRole('table');

    expect(screen.getByText(/no patients to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice Johnson/i })).not.toBeInTheDocument();
  });

  it('shows only the most recent entry when a patient has more than one entry today with the same status', async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const earlierVisitToday = {
      ...mockQueueEntryAlice,
      uuid: 'alice-earlier-visit',
      status: inServiceStatus,
      startedAt: anHourAgo,
      endedAt: anHourAgo,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: anHourAgo, stopDatetime: anHourAgo },
    };
    const laterVisitToday = {
      ...mockQueueEntryAlice,
      uuid: 'alice-later-visit',
      status: inServiceStatus,
      startedAt: nowIso,
      endedAt: null,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: null },
    };
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [earlierVisitToday, laterVisitToday],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    rendeDefaultQueueTable();

    await screen.findByRole('table');

    expect(screen.getAllByRole('link', { name: /Alice Johnson/i })).toHaveLength(1);
  });

  it('shows a patient only under their current status, not their earlier, superseded one from a different status', async () => {
    // The patient finished an earlier visit today (Finished Service), then started a brand new
    // one later the same day (In Service). They must show only under "In Service" now - the
    // Finished Service view should no longer list them at all.
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const earlierFinishedVisit = {
      ...mockQueueEntryAlice,
      uuid: 'alice-finished-earlier',
      status: finishedServiceStatus,
      startedAt: anHourAgo,
      endedAt: anHourAgo,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: anHourAgo, stopDatetime: anHourAgo },
    };
    const laterInServiceVisit = {
      ...mockQueueEntryAlice,
      uuid: 'alice-in-service-later',
      status: inServiceStatus,
      startedAt: nowIso,
      endedAt: null,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: null },
    };
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [earlierFinishedVisit, laterInServiceVisit],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    // Default view (no explicit selection) is "In Service" - she should show here.
    rendeDefaultQueueTable();
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: /Alice Johnson/i })).toBeInTheDocument();
  });

  it('does not show a patient under "Finished Service" once they have a newer entry with a different status', async () => {
    const now = new Date();
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const earlierFinishedVisit = {
      ...mockQueueEntryAlice,
      uuid: 'alice-finished-earlier',
      status: finishedServiceStatus,
      startedAt: anHourAgo,
      endedAt: anHourAgo,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: anHourAgo, stopDatetime: anHourAgo },
    };
    const laterInServiceVisit = {
      ...mockQueueEntryAlice,
      uuid: 'alice-in-service-later',
      status: inServiceStatus,
      startedAt: nowIso,
      endedAt: null,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: null },
    };
    updateSelectedQueueStatus(defaultFinishedServiceStatus, 'Finished Service');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [earlierFinishedVisit, laterInServiceVisit],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(screen.getByText(/no patients to display/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Alice Johnson/i })).not.toBeInTheDocument();
  });

  it('lists every status side by side when "All" is selected', async () => {
    const nowIso = new Date().toISOString();
    const aliceInService = {
      ...mockQueueEntryAlice,
      uuid: 'alice-in-service',
      status: inServiceStatus,
      startedAt: nowIso,
      endedAt: null,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: null },
    };
    const brianFinished = {
      ...mockQueueEntryAlice,
      uuid: 'brian-finished',
      display: mockPatientBrian.display,
      patient: mockPatientBrian,
      status: finishedServiceStatus,
      startedAt: nowIso,
      endedAt: nowIso,
      visit: { ...mockQueueEntryAlice.visit, startDatetime: nowIso, stopDatetime: nowIso },
    };
    updateSelectedQueueStatus(ALL_QUEUE_STATUSES_UUID, 'All');
    mockUseQueueEntries.mockReturnValue({
      queueEntries: [aliceInService, brianFinished],
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
      totalCount: 2,
    });

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    // Neither status is filtered out -- the default view would have shown only Alice.
    expect(screen.getByRole('link', { name: /Alice Johnson/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Brian Johnson/i })).toBeInTheDocument();
  });

  it('offers All alongside each real status in the status filter, and defaults to In Service', async () => {
    const user = userEvent.setup();
    mockUseQueues.mockReturnValue({
      queues: [
        {
          ...mockQueueTriage,
          // "Waiting" (defaultStatusConceptUuid) is deliberately not offered: this table only ever
          // fetches the in-service and finished-service populations.
          allowedStatuses: [
            { uuid: getDefaultsFromConfigSchema(configSchema).concepts.defaultStatusConceptUuid, display: 'Waiting' },
            inServiceStatus,
            finishedServiceStatus,
          ],
        },
      ],
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    const statusFilter = screen.getByRole('combobox', { name: /show patients with status/i });
    expect(statusFilter).toHaveTextContent(/in service/i);

    await user.click(statusFilter);

    const options = within(screen.getByRole('listbox', { name: /show patients with status/i })).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['All', 'Finished Service', 'In Service']);
  });
});

function rendeDefaultQueueTable() {
  return renderWithSwr(<DefaultQueueTable />);
}
