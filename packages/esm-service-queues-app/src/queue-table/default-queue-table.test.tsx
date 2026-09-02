import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import {
  mockLocationSurgery,
  mockLocationTriage,
  mockQueueEntries,
  mockQueueEntryAlice,
  mockQueueRooms,
  mockServices,
  mockSession,
} from '__mocks__';
import React from 'react';
import { renderWithSwr } from 'tools';
import { type ConfigObject, configSchema } from '../config-schema';
import { useQueueLocations } from '../create-queue-entry/hooks/useQueueLocations';
import { useQueueEntries } from '../hooks/useQueueEntries';
import { updateSelectedQueueStatus } from '../store/store';
import DefaultQueueTable from '../queue-table/default-queue-table.component';

const mockUseConfig = vi.mocked(useConfig<ConfigObject>);
const mockUseQueueEntries = vi.mocked(useQueueEntries);
const mockQueueLocations = vi.mocked(useQueueLocations);
const mockUseSession = vi.mocked(useSession);
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
    // Selected queue status is persisted in session storage via the global service-queues store,
    // so it must be reset explicitly to avoid leaking into other tests.
    updateSelectedQueueStatus(undefined, undefined);
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
});

function rendeDefaultQueueTable() {
  renderWithSwr(<DefaultQueueTable />);
}
