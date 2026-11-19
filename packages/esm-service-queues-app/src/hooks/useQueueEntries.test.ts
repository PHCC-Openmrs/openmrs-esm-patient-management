import React from 'react';
import { SWRConfig } from 'swr';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { openmrsFetch } from '@openmrs/esm-framework';
import {
  forgetKnownQueueEntries,
  fullRefetchIntervalMs,
  notifyQueueEntriesChanged,
  repString,
  signatureRepString,
  useQueueEntries,
  withDisplayNames,
} from './useQueueEntries';

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
    forgetKnownQueueEntries();
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
    const server = serveQueueEntries([entry('e1')]);
    const { result } = renderHook(() => useQueueEntries(), { wrapper });
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(1));

    server.entries.push(entry('e2'));
    notifyQueueEntriesChanged();

    await waitFor(() => expect(result.current.queueEntries).toHaveLength(2));
  });
});

/** A queue entry as the server returns it for `repString`. */
function entry(uuid: string, overrides: Record<string, unknown> = {}) {
  return {
    uuid,
    display: `Patient ${uuid}`,
    queue: { uuid: 'queue-a', name: 'Room A' },
    status: { uuid: 'in-service', display: 'In Service' },
    priority: { uuid: 'not-urgent', display: 'Not Urgent' },
    priorityComment: null,
    sortWeight: 0,
    startedAt: '2026-11-19T08:00:00.000+0200',
    endedAt: null,
    patient: { uuid: `patient-${uuid}`, person: { age: 30, birthdate: '1996-01-01', gender: 'F' }, identifiers: [] },
    visit: {
      uuid: `visit-${uuid}`,
      startDatetime: '2026-11-19T08:00:00.000+0200',
      stopDatetime: null,
      location: { uuid: 'location-a', name: 'Clinic A' },
      attributes: [{ uuid: `attribute-${uuid}`, value: '1', attributeType: { uuid: 'attribute-type' } }],
    },
    queueComingFrom: null,
    previousQueueEntry: null,
    ...overrides,
  } as any;
}

/** Only what the server sends for `signatureRepString`. */
function signatureOf({ uuid, status, priority, queue, priorityComment, sortWeight, startedAt, endedAt, visit }) {
  return {
    uuid,
    status: { uuid: status.uuid },
    priority: { uuid: priority.uuid },
    queue: { uuid: queue.uuid },
    priorityComment,
    sortWeight,
    startedAt,
    endedAt,
    visit: visit && {
      uuid: visit.uuid,
      startDatetime: visit.startDatetime,
      stopDatetime: visit.stopDatetime,
      location: { uuid: visit.location.uuid },
      attributes: visit.attributes.map(({ uuid, value }) => ({ uuid, value })),
    },
  };
}

/**
 * Answers queue-entry requests from `entries` the way the server would: searches paged by
 * `limit`/`startIndex` in the representation asked for, and single entries by uuid.
 */
function serveQueueEntries(entries: Array<any>) {
  const server = { entries };
  mockOpenmrsFetch.mockImplementation((url: string) => {
    const [path, query] = url.split('?');
    const params = new URLSearchParams(query);
    const single = path.match(/queue-entry\/([^/]+)$/);
    if (single) {
      const found = server.entries.find(({ uuid }) => uuid === single[1]);
      return found ? Promise.resolve({ data: found } as any) : Promise.reject(new Error('Not found'));
    }
    const shape = params.get('v') === signatureRepString ? signatureOf : (e) => e;
    const startIndex = Number(params.get('startIndex') ?? 0);
    const limit = Number(params.get('limit') ?? 50);
    return Promise.resolve({
      data: {
        results: server.entries.slice(startIndex, startIndex + limit).map(shape),
        totalCount: server.entries.length,
      },
    } as any);
  });
  return server;
}

function requestsSince(callIndex: number) {
  return mockOpenmrsFetch.mock.calls.slice(callIndex).map(([url]) => {
    const [path, query] = String(url).split('?');
    const v = new URLSearchParams(query).get('v');
    return {
      single: /queue-entry\/[^/]+$/.test(path) ? path.split('/').pop() : null,
      rep: v === repString ? 'full' : v === signatureRepString ? 'signature' : v,
    };
  });
}

describe('useQueueEntries polling', () => {
  beforeEach(() => {
    notifyQueueEntriesChanged();
    forgetKnownQueueEntries();
    mockOpenmrsFetch.mockReset();
  });

  async function renderLoaded(entries: Array<any>) {
    const server = serveQueueEntries(entries);
    const hook = renderHook(() => useQueueEntries({ service: 'polled-service' }), { wrapper });
    await waitFor(() => expect(hook.result.current.queueEntries).toHaveLength(entries.length));
    return { server, ...hook };
  }

  async function poll(result: { current: ReturnType<typeof useQueueEntries> }) {
    // Rules out being handed the just-finished fetch, as the next poll 15 seconds on wouldn't be.
    notifyQueueEntriesChanged();
    await act(async () => {
      await result.current.mutate();
    });
  }

  it('fetches only signatures when nothing changed', async () => {
    const { result } = await renderLoaded([entry('e1'), entry('e2')]);
    const loaded = result.current.queueEntries;
    const before = mockOpenmrsFetch.mock.calls.length;

    await poll(result);

    expect(requestsSince(before)).toEqual([{ single: null, rep: 'signature' }]);
    expect(result.current.queueEntries).toBe(loaded);
  });

  it('refetches just the entries that changed or are new, and drops the ones that are gone', async () => {
    const { server, result } = await renderLoaded([entry('e1'), entry('e2'), entry('e3')]);
    const before = mockOpenmrsFetch.mock.calls.length;

    server.entries = [
      entry('e1'),
      entry('e2', {
        status: { uuid: 'finished', display: 'Finished Service' },
        endedAt: '2026-11-19T09:00:00.000+0200',
      }),
      entry('e4'),
    ];
    await poll(result);

    expect(requestsSince(before)).toEqual([
      { single: null, rep: 'signature' },
      { single: 'e2', rep: 'full' },
      { single: 'e4', rep: 'full' },
    ]);
    expect(result.current.queueEntries.map(({ uuid, status }) => `${uuid}:${status.display}`)).toEqual([
      'e1:In Service',
      'e2:Finished Service',
      'e4:In Service',
    ]);
  });

  it('notices a change to any field the views show that the server can change while the entry is listed', async () => {
    const changes = [
      { priority: { uuid: 'urgent', display: 'Urgent' } },
      { queue: { uuid: 'queue-b', name: 'Room B' } },
      { priorityComment: 'Needs a wheelchair' },
      { sortWeight: 1 },
      { startedAt: '2026-11-19T07:30:00.000+0200' },
      { endedAt: '2026-11-19T09:00:00.000+0200' },
      { visit: { ...entry('e1').visit, stopDatetime: '2026-11-19T10:00:00.000+0200' } },
      { visit: { ...entry('e1').visit, location: { uuid: 'location-b', name: 'Clinic B' } } },
      { visit: { ...entry('e1').visit, attributes: [{ uuid: 'attribute-e1', value: '2' }] } },
    ];
    const { server, result } = await renderLoaded([entry('e1')]);

    for (const change of changes) {
      // Back to the unchanged entry first, so each change is noticed on its own.
      server.entries = [entry('e1')];
      await poll(result);
      server.entries = [entry('e1', change)];
      const before = mockOpenmrsFetch.mock.calls.length;
      await poll(result);
      expect(requestsSince(before)).toEqual([
        { single: null, rep: 'signature' },
        { single: 'e1', rep: 'full' },
      ]);
    }
  });

  it('refetches everything when too many entries changed at once', async () => {
    const entries = Array.from({ length: 30 }, (_, i) => entry(`e${i}`));
    const { server, result } = await renderLoaded(entries);
    const before = mockOpenmrsFetch.mock.calls.length;

    server.entries = entries.map((e) => entry(e.uuid, { priority: { uuid: 'urgent', display: 'Urgent' } }));
    await poll(result);

    expect(requestsSince(before)).toEqual([
      { single: null, rep: 'signature' },
      { single: null, rep: 'full' },
    ]);
    expect(result.current.queueEntries.every(({ priority }) => priority.display === 'Urgent')).toBe(true);
  });

  it('refetches everything once the entries were last fetched in full too long ago', async () => {
    const { server, result } = await renderLoaded([entry('e1')]);
    // A renamed patient: nothing a signature carries.
    server.entries = [entry('e1', { display: 'Renamed Patient' })];

    const before = mockOpenmrsFetch.mock.calls.length;
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + fullRefetchIntervalMs + 1000);
    try {
      await act(async () => {
        await result.current.mutate();
      });
    } finally {
      now.mockRestore();
    }

    expect(requestsSince(before)).toEqual([{ single: null, rep: 'full' }]);
    expect(result.current.queueEntries[0].patient.person.display).toBe('Renamed Patient');
  });

  it('falls back to a full refetch when the signatures cannot be fetched', async () => {
    const { server, result } = await renderLoaded([entry('e1')]);
    const serve = mockOpenmrsFetch.getMockImplementation();
    mockOpenmrsFetch.mockImplementation((url: string) =>
      new URLSearchParams(String(url).split('?')[1]).get('v') === signatureRepString
        ? Promise.reject(new Error('Administrator has set absolute limit at 100'))
        : serve(url),
    );
    server.entries.push(entry('e2'));
    const before = mockOpenmrsFetch.mock.calls.length;

    await poll(result);

    expect(requestsSince(before).map(({ rep }) => rep)).toEqual(['signature', 'full']);
    expect(result.current.queueEntries).toHaveLength(2);
  });

  it('never uses signatures for a representation other than its own', async () => {
    serveQueueEntries([entry('e1')]);
    const rep = 'custom:(uuid,display,queue)';
    const { result } = renderHook(() => useQueueEntries({ service: 'other-rep' }, rep), { wrapper });
    await waitFor(() => expect(result.current.queueEntries).toHaveLength(1));
    const before = mockOpenmrsFetch.mock.calls.length;

    await poll(result);

    expect(requestsSince(before).map(({ rep: requested }) => requested)).toEqual([rep]);
  });
});

describe('withDisplayNames', () => {
  it('shapes an entry of repString as the server used to send it', () => {
    const shaped = withDisplayNames(
      entry('e1', {
        queueComingFrom: { uuid: 'queue-b', name: 'Room B' },
        patient: {
          uuid: 'patient-e1',
          person: { age: 30, birthdate: '1996-01-01', gender: 'F' },
          identifiers: [{ uuid: 'i1', identifier: '100A', identifierType: { uuid: 'id-type', name: 'OpenMRS ID' } }],
        },
      }),
    );

    expect(shaped.queue.display).toBe('Room A');
    expect(shaped.queueComingFrom.display).toBe('Room B');
    expect(shaped.visit.location.display).toBe('Clinic A');
    expect(shaped.patient.person.display).toBe('Patient e1');
    expect(shaped.patient.person.uuid).toBe('patient-e1');
    expect(shaped.patient.identifiers[0].identifierType.display).toBe('OpenMRS ID');
  });

  it('leaves display strings the server did send alone', () => {
    const shaped = withDisplayNames({
      uuid: 'e1',
      display: 'Entry',
      queue: { uuid: 'q', name: 'Name', display: 'Localized name' },
      patient: { uuid: 'p', person: { display: 'Person display' } },
    } as any);

    expect(shaped.queue.display).toBe('Localized name');
    expect(shaped.patient.person.display).toBe('Person display');
  });
});
