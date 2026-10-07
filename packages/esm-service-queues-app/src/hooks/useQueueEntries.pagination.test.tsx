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

// The page size this test's stub server serves at - the `limit` the query asks for, which a real
// server honours. The behaviour under test - revalidating pages past the first - only needs more
// than one page to exist.
const pageSize = 100;
const nextPageUri = 'http://localhost/openmrs/ws/rest/v1/queue-entry?startIndex=100';

function queueEntry(uuid: string, queueDisplay: string) {
  return { uuid, display: uuid, queue: { uuid: 'queue-uuid', display: queueDisplay } } as unknown as QueueEntry;
}

// Entries come back oldest-first, so when a query does overflow a single page, the newest
// entries - the ones the queue views actually display - are on the *last* page.
const firstPage = Array.from({ length: pageSize }, (_, i) => queueEntry(`historical-entry-${i}`, 'Front Desk'));

function pageResponse(results: QueueEntry[], hasNext: boolean) {
  return {
    data: {
      results,
      totalCount: pageSize + 1,
      links: hasNext ? [{ rel: 'next', uri: nextPageUri }] : [],
    },
  };
}

/** Serves page 0 unchanged and page 1 with whatever queue `lastPageQueue` currently names. */
function serveTwoPages(lastPageQueue: string) {
  mockOpenmrsFetch.mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('startIndex=100')
        ? pageResponse([queueEntry('moved-entry', lastPageQueue)], false)
        : pageResponse(firstPage, true),
    ),
  );
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
