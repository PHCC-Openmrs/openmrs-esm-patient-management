import React from 'react';
import { SWRConfig } from 'swr';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { openmrsFetch, useConfig } from '@openmrs/esm-framework';
import {
  forgetKnownQueueEntries,
  notifyQueueEntriesChanged,
  repString,
  signatureRepString,
  useQueueEntries,
} from './useQueueEntries';

const mockOpenmrsFetch = vi.mocked(openmrsFetch);
const mockUseConfig = vi.mocked(useConfig);

// A fresh SWR cache per render, as each OpenMRS extension (table, every metrics card) has its own.
const wrapper = ({ children }) =>
  React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

function entry(uuid: string) {
  return {
    uuid,
    display: `Patient ${uuid}`,
    queue: { uuid: 'queue-1', name: 'Front Desk' },
    status: { uuid: 'in-service', display: 'In Service' },
    priority: { uuid: 'not-urgent', display: 'Not Urgent' },
    startedAt: '2026-11-19T08:00:00.000+0200',
  };
}

function signatureOf(e: ReturnType<typeof entry>) {
  return {
    uuid: e.uuid,
    status: { uuid: e.status.uuid },
    priority: { uuid: e.priority.uuid },
    queue: { uuid: e.queue.uuid },
    startedAt: e.startedAt,
  };
}

const manyEntries = (count: number) => Array.from({ length: count }, (_, i) => entry(`e${i}`));

/**
 * Answers queue-entry searches from `entries`, paged by `limit`/`startIndex` in the representation
 * asked for. Each page request stays pending until `release()` lets it through (or resolves at once
 * when `autoRelease` is set), so a test can see how many are in flight together.
 */
function serve(entries: Array<ReturnType<typeof entry>>, { autoRelease = false } = {}) {
  const pending: Array<() => void> = [];
  const state = { inFlight: 0, maxInFlight: 0, pending };
  mockOpenmrsFetch.mockImplementation((url: string) => {
    const [path, query] = url.split('?');
    const params = new URLSearchParams(query);
    const single = path.match(/queue-entry\/([^/]+)$/);
    const respond = () => {
      if (single) {
        return { data: entries.find(({ uuid }) => uuid === single[1]) };
      }
      const startIndex = Number(params.get('startIndex') ?? 0);
      const limit = Number(params.get('limit') ?? 50);
      const shape = params.get('v') === signatureRepString ? signatureOf : (e) => e;
      return {
        data: { results: entries.slice(startIndex, startIndex + limit).map(shape), totalCount: entries.length },
      };
    };
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    return new Promise((resolve) => {
      const done = () => {
        state.inFlight--;
        resolve(respond() as any);
      };
      if (autoRelease) {
        setTimeout(done, 0);
      } else {
        pending.push(done);
      }
    });
  });
  return {
    state,
    /** Lets the oldest pending request through. */
    async release() {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      await act(async () => {
        pending.shift()();
      });
    },
  };
}

function fullPageRequests(sinceCall = 0) {
  return mockOpenmrsFetch.mock.calls
    .slice(sinceCall)
    .map(([url]) => new URLSearchParams(String(url).split('?')[1]))
    .filter((params) => params.get('v') === repString && params.get('limit') === '100');
}

function signatureRequests(sinceCall = 0) {
  return mockOpenmrsFetch.mock.calls
    .slice(sinceCall)
    .map(([url]) => new URLSearchParams(String(url).split('?')[1]))
    .filter((params) => params.get('v') === signatureRepString);
}

describe('useQueueEntries loading', () => {
  beforeEach(() => {
    notifyQueueEntriesChanged();
    forgetKnownQueueEntries();
    mockOpenmrsFetch.mockReset();
    mockUseConfig.mockReturnValue({} as any);
  });

  it('requests the pages of a full load one at a time by default', async () => {
    // Every page at once took 5+ server cores for a second or two on a 2,000-entry day.
    const server = serve(manyEntries(350), { autoRelease: true });
    const { result } = renderHook(() => useQueueEntries({ service: 'one-at-a-time' }), { wrapper });

    await waitFor(() => expect(result.current.queueEntries).toHaveLength(350));
    expect(fullPageRequests()).toHaveLength(4);
    expect(server.state.maxInFlight).toBe(1);
  });

  it('requests up to queueEntriesFetchConcurrency pages at a time when configured', async () => {
    mockUseConfig.mockReturnValue({ queueEntriesFetchConcurrency: 2 } as any);
    const server = serve(manyEntries(350), { autoRelease: true });
    const { result } = renderHook(() => useQueueEntries({ service: 'two-at-a-time' }), { wrapper });

    await waitFor(() => expect(result.current.queueEntries).toHaveLength(350));
    expect(server.state.maxInFlight).toBe(2);
  });

  it('shows the first page while the rest are still loading, flagged as partial', async () => {
    const server = serve(manyEntries(250));
    const { result } = renderHook(() => useQueueEntries({ service: 'progressive' }), { wrapper });

    await server.release(); // the count-only request
    await server.release(); // page 1
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(100));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPartial).toBe(true);

    await server.release(); // page 2
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(200));
    expect(result.current.isPartial).toBe(true);

    await server.release(); // page 3
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(250));
    expect(result.current.isPartial).toBe(false);
  });

  it('shows the cached list at once on reopening, and only checks signatures', async () => {
    serve(manyEntries(250), { autoRelease: true });
    const { result: firstResult, unmount } = renderHook(() => useQueueEntries({ service: 'reopened' }), { wrapper });
    await waitFor(() => expect(firstResult.current.queueEntries).toHaveLength(250));
    unmount();
    // Navigating back remounts the hook with a fresh SWR cache.
    notifyQueueEntriesChanged();
    const callsBefore = mockOpenmrsFetch.mock.calls.length;

    const { result: reopenedResult } = renderHook(() => useQueueEntries({ service: 'reopened' }), { wrapper });

    // Rendered from the cache straight away - no skeleton, no full reload.
    expect(reopenedResult.current.queueEntries).toHaveLength(250);
    expect(reopenedResult.current.isLoading).toBe(false);
    await waitFor(() => expect(signatureRequests(callsBefore).length).toBeGreaterThan(0));
    expect(fullPageRequests(callsBefore)).toHaveLength(0);
  });

  it('sends one signature check per tick for the table and every metrics card together', async () => {
    serve(manyEntries(120), { autoRelease: true });
    function Consumer({ id }: { id: string }) {
      const { queueEntries } = useQueueEntries({ service: 'shared' });
      return <div data-testid={id}>{queueEntries.length}</div>;
    }
    const views = ['table', 'checked-in', 'urgent', 'completed'];
    // Each extension renders in its own SWR cache, as on the queue screen.
    const rendered = views.map((id) =>
      render(
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
          <Consumer id={id} />
        </SWRConfig>,
      ),
    );
    for (const id of views) {
      await waitFor(() => expect(screen.getByTestId(id)).toHaveTextContent('120'));
    }
    expect(fullPageRequests()).toHaveLength(2);

    // The next tick: every view revalidates at about the same moment.
    notifyQueueEntriesChanged();
    const callsBefore = mockOpenmrsFetch.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new CustomEvent('queue-entry-updated'));
    });
    await waitFor(() => expect(signatureRequests(callsBefore).length).toBeGreaterThan(0));
    // 120 entries is one signature page: one request in all, not one per view.
    expect(signatureRequests(callsBefore)).toHaveLength(1);
    rendered.forEach(({ unmount }) => unmount());
  });
});
