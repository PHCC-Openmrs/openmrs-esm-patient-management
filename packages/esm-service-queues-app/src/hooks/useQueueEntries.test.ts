import { vi, describe, it, expect } from 'vitest';
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
    useQueueEntries({ status: ['status-a', 'status-b'] });

    const [requestedUrl] = mockUseOpenmrsFetchAll.mock.calls[0];
    const params = new URLSearchParams(String(requestedUrl).split('?')[1]);

    expect(params.getAll('status')).toEqual(['status-a', 'status-b']);
  });

  it('still appends a plain string search criteria value as a single param', () => {
    useQueueEntries({ status: 'status-a' });

    const [requestedUrl] = mockUseOpenmrsFetchAll.mock.calls[0];
    const params = new URLSearchParams(String(requestedUrl).split('?')[1]);

    expect(params.getAll('status')).toEqual(['status-a']);
  });
});
