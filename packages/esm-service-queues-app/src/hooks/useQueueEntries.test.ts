import { vi, describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useOpenmrsFetchAll } from '@openmrs/esm-framework';
import { useQueueEntries } from './useQueueEntries';

vi.mock('@openmrs/esm-framework', async () => ({
  ...((await vi.importActual('@openmrs/esm-framework')) as object),
  useOpenmrsFetchAll: vi.fn().mockReturnValue({ data: [] }),
}));

const mockUseOpenmrsFetchAll = vi.mocked(useOpenmrsFetchAll);

describe('useQueueEntries', () => {
  it('appends an array search criteria value as repeated query params, not one comma-joined value', () => {
    // The servlet's getParameterMap()/String[] (and this module's search criteria parser) treat
    // repeated params as multiple values; a single "a,b" value would instead be parsed as one
    // unresolvable concept reference, silently breaking multi-status queries.
    renderHook(() => useQueueEntries({ status: ['status-a', 'status-b'] }));

    const [requestedUrl] = mockUseOpenmrsFetchAll.mock.calls[0];
    const params = new URLSearchParams(String(requestedUrl).split('?')[1]);

    expect(params.getAll('status')).toEqual(['status-a', 'status-b']);
  });

  it('requests an explicit page size rather than falling back to the server default', () => {
    // Without a `limit` the endpoint pages at `webservices.rest.maxResultsDefault` (50) and
    // `useOpenmrsFetchAll` walks those pages one sequential round trip at a time, rendering
    // nothing until the last one lands.
    renderHook(() => useQueueEntries());

    const [requestedUrl] = mockUseOpenmrsFetchAll.mock.calls[0];
    const params = new URLSearchParams(String(requestedUrl).split('?')[1]);

    const limit = Number(params.get('limit'));
    expect(limit).toBeGreaterThan(50);
    // Asking for more than `webservices.rest.maxResultsAbsolute` is a hard error rather than a
    // silent clamp, so the page size has to stay under the lowest value a site might set.
    expect(limit).toBeLessThanOrEqual(100);
  });

  it('still appends a plain string search criteria value as a single param', () => {
    renderHook(() => useQueueEntries({ status: 'status-a' }));

    const [requestedUrl] = mockUseOpenmrsFetchAll.mock.calls[0];
    const params = new URLSearchParams(String(requestedUrl).split('?')[1]);

    expect(params.getAll('status')).toEqual(['status-a']);
  });
});
