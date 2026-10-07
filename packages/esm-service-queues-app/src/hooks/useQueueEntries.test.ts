import React from 'react';
import { SWRConfig } from 'swr';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import { notifyQueueEntriesChanged, useQueueEntries } from './useQueueEntries';

const mockOpenmrsFetch = vi.mocked(openmrsFetch);

// A fresh SWR cache per hook, so a test can't be served another test's cached response.
const wrapper = ({ children }) =>
  React.createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children);

/** The query parameters of the last entry-fetching request, past any count-only one. */
async function requestedParams() {
  await waitFor(() => expect(mockOpenmrsFetch).toHaveBeenCalled());
  const [requestedUrl] = mockOpenmrsFetch.mock.calls.at(-1);
  return new URLSearchParams(String(requestedUrl).split('?')[1]);
}

describe('useQueueEntries', () => {
  beforeEach(() => {
    // Drops fetches shared from the previous test, which asked for some of the same URLs.
    notifyQueueEntriesChanged();
    mockOpenmrsFetch.mockReset();
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [] } } as any);
  });

  it('appends an array search criteria value as repeated query params, not one comma-joined value', async () => {
    // The servlet's getParameterMap()/String[] (and this module's search criteria parser) treat
    // repeated params as multiple values; a single "a,b" value would instead be parsed as one
    // unresolvable concept reference, silently breaking multi-status queries.
    renderHook(() => useQueueEntries({ status: ['status-a', 'status-b'] }), { wrapper });

    const params = await requestedParams();

    expect(params.getAll('status')).toEqual(['status-a', 'status-b']);
  });

  it('requests an explicit page size rather than falling back to the server default', async () => {
    // Without a `limit` the endpoint pages at `webservices.rest.maxResultsDefault` (50) and
    // every page beyond the first is another request.
    renderHook(() => useQueueEntries(), { wrapper });

    const params = await requestedParams();

    const limit = Number(params.get('limit'));
    expect(limit).toBeGreaterThan(50);
    // Asking for more than `webservices.rest.maxResultsAbsolute` is a hard error rather than a
    // silent clamp, so the page size has to stay under the lowest value a site might set.
    expect(limit).toBeLessThanOrEqual(100);
  });

  it('still appends a plain string search criteria value as a single param', async () => {
    renderHook(() => useQueueEntries({ status: 'status-a' }), { wrapper });

    const params = await requestedParams();

    expect(params.getAll('status')).toEqual(['status-a']);
  });

  it('fetches the pages after the first in parallel by startIndex', async () => {
    // A busy day overflows one page several times over; following each page's `next` link in
    // turn left the table on its loading skeleton for one full round trip per page.
    const entry = (uuid: string) => ({ uuid });
    mockOpenmrsFetch.mockImplementation((url: string) => {
      const startIndex = Number(new URLSearchParams(url.split('?')[1]).get('startIndex') ?? 0);
      const results = Array.from({ length: Math.min(100, 250 - startIndex) }, (_, i) => entry(`e${startIndex + i}`));
      return Promise.resolve({
        data: { results, totalCount: 250, links: startIndex + 100 < 250 ? [{ rel: 'next', uri: 'next' }] : [] },
      } as any);
    });

    const { result } = renderHook(() => useQueueEntries({ service: 'paged-service' }), { wrapper });

    await waitFor(() => expect(result.current.queueEntries).toHaveLength(250));
    const startIndexes = mockOpenmrsFetch.mock.calls.map(([url]) =>
      new URLSearchParams(String(url).split('?')[1]).get('startIndex'),
    );
    // A count-only request first, then every page together.
    expect(startIndexes).toEqual([null, null, '100', '200']);
    expect(new URLSearchParams(String(mockOpenmrsFetch.mock.calls[0][0]).split('?')[1]).get('limit')).toBe('1');
  });

  it('shares one fetch between components with separate SWR caches', async () => {
    // The queue table and each metrics card are separate extensions with private SWR caches,
    // so SWR's own de-duplication never sees them requesting the same URL.
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [{ uuid: 'e1' }] } } as any);

    const hooks = Array.from({ length: 4 }, () =>
      renderHook(() => useQueueEntries({ service: 'shared-service' }), { wrapper }),
    );

    await waitFor(() => hooks.forEach(({ result }) => expect(result.current.queueEntries).toHaveLength(1)));
    // One count-only request, then the single page - once, not once per component.
    expect(mockOpenmrsFetch).toHaveBeenCalledTimes(2);
  });

  it('refetches after a queue-entry change instead of reusing the shared fetch', async () => {
    mockOpenmrsFetch.mockResolvedValue({ data: { results: [{ uuid: 'e1' }] } } as any);
    const { result } = renderHook(() => useQueueEntries(), { wrapper });
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(1));

    mockOpenmrsFetch.mockResolvedValue({ data: { results: [{ uuid: 'e1' }, { uuid: 'e2' }] } } as any);
    notifyQueueEntriesChanged();

    await waitFor(() => expect(result.current.queueEntries).toHaveLength(2));
  });
});
