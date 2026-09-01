import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import {
  mockLocationSurgery,
  mockLocationTriage,
  mockQueueEntries,
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

  it('excludes ended entries (isEnded: false) when no status filter is selected', async () => {
    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(mockUseQueueEntries).toHaveBeenLastCalledWith(expect.objectContaining({ isEnded: false }));
  });

  it('still excludes already-ended entries when a non-terminal status (e.g. "In Service") is selected', async () => {
    // Otherwise a superseded/finished entry that happens to match that status keeps showing as active.
    updateSelectedQueueStatus('some-in-service-status-uuid', 'In Service');

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(mockUseQueueEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ isEnded: false, status: 'some-in-service-status-uuid' }),
    );
  });

  it('relaxes the isEnded filter when the terminal "Finished Service" status is selected', async () => {
    // The backend only ever sets this status on entries it has already ended, so requiring
    // isEnded: false here would hide every match.
    const { defaultFinishedServiceStatus } = getDefaultsFromConfigSchema(configSchema).concepts;
    updateSelectedQueueStatus(defaultFinishedServiceStatus, 'Finished Service');

    rendeDefaultQueueTable();
    await screen.findByRole('table');

    expect(mockUseQueueEntries).toHaveBeenLastCalledWith(
      expect.objectContaining({ isEnded: undefined, status: defaultFinishedServiceStatus }),
    );
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
    const todaysQueueEntries = mockQueueEntries.map((entry) => ({ ...entry, startedAt: new Date().toISOString() }));
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
});

function rendeDefaultQueueTable() {
  renderWithSwr(<DefaultQueueTable />);
}
