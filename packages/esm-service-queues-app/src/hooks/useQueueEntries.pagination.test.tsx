import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import { renderWithSwr } from 'tools';
import { type QueueEntry } from '../types';
import { useMutateQueueEntries, useQueueEntries } from './useQueueEntries';

// Some framework hooks fetch with the `openmrsFetch` they import from `@openmrs/esm-api`
// directly, which the `@openmrs/esm-framework` alias doesn't cover - point it at the same
// mock instance this test drives.
vi.mock('@openmrs/esm-api', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  openmrsFetch: (await import('@openmrs/esm-api/mock')).openmrsFetch,
}));

const mockOpenmrsFetch = vi.mocked(openmrsFetch);

// The page size the queue views fetch at. The behaviour under test - revalidating entries past the
// first page - only needs more than one page to exist.
const pageSize = 100;

function queueEntry(uuid: string, queueName: string) {
  // A move puts the patient in another queue - another uuid, not just another name.
  return { uuid, display: uuid, queue: { uuid: `${queueName}-uuid`, name: queueName } } as unknown as QueueEntry;
}

// Entries come back oldest-first, so when a query does overflow a single page, the newest
// entries - the ones the queue views actually display - are on the *last* page.
const firstPage = Array.from({ length: pageSize }, (_, i) => queueEntry(`historical-entry-${i}`, 'Front Desk'));

/**
 * Serves the first page unchanged and, after it, the moved patient's entry in whichever queue
 * `lastPageQueue` names - paged by the `limit` and `startIndex` each request asks for.
 */
function serveTwoPages(lastPageQueue: string) {
  const entries = [...firstPage, queueEntry('moved-entry', lastPageQueue)];
  mockOpenmrsFetch.mockImplementation((url: string) => {
    const params = new URLSearchParams(url.split('?')[1]);
    const startIndex = Number(params.get('startIndex') ?? 0);
    const limit = Number(params.get('limit') ?? 50);
    const single = url.split('?')[0].match(/queue-entry\/([^/]+)$/);
    if (single) {
      return Promise.resolve({ data: entries.find(({ uuid }) => uuid === single[1]) });
    }
    return Promise.resolve({
      data: { results: entries.slice(startIndex, startIndex + limit), totalCount: entries.length },
    });
  });
}

let mutateQueueEntries: () => Promise<unknown>;

function QueueEntriesConsumer() {
  const { queueEntries } = useQueueEntries();
  // Stands in for the action modals, which call this from their own React tree.
  mutateQueueEntries = useMutateQueueEntries().mutateQueueEntries;

  return <div data-testid="queues">{queueEntries.map((entry) => entry.queue.display).join(',')}</div>;
}

describe('useMutateQueueEntries', () => {
  beforeEach(() => {
    mockOpenmrsFetch.mockReset();
  });

  it('revalidates every fetched page, not just the first', async () => {
    // A moved patient's entry lives on the last page, so refreshing only page 0 leaves the
    // queue rendering pre-move data until the browser is reloaded.
    serveTwoPages('Doctor Room 2');
    renderWithSwr(<QueueEntriesConsumer />);

    await waitFor(() => {
      expect(screen.getByTestId('queues')).toHaveTextContent('Doctor Room 2');
    });

    // The patient is moved elsewhere, then the modal asks the queue views to refresh.
    serveTwoPages('Laboratory');
    await act(async () => {
      await mutateQueueEntries();
    });

    await waitFor(() => {
      expect(screen.getByTestId('queues')).toHaveTextContent('Laboratory');
    });
    expect(screen.getByTestId('queues')).not.toHaveTextContent('Doctor Room 2');
  });
});
