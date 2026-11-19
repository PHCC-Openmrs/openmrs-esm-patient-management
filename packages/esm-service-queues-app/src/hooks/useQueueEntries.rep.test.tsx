import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig, useSession } from '@openmrs/esm-framework';
import { mockSession } from '__mocks__';
import { renderWithSwr } from 'tools';
import { type ConfigObject, configSchema } from '../config-schema';
import { type QueueEntry } from '../types';
import { repString, signatureRepString, withDisplayNames } from './useQueueEntries';
import CallQueueEntryModal from '../modals/call-modal/call-queue-entry.modal';
import UndoTransitionQueueEntryModal from '../modals/undo-transition-queue-entry.modal';
import QueueTable from '../queue-table/queue-table.component';

// The `identifierTypeUuid` default of `defaultColumnConfig`, so the patient-identifier column renders this identifier.
const openmrsIdTypeUuid = '05a29f94-c0ed-11e2-94be-8c13b969e334';
const visitQueueNumberAttributeUuid = 'queue-number-visit-attr-type-uuid';

// Shaped exactly like `repString`: asserted against it below, then rendered through the columns and row actions
// (after `withDisplayNames`, as useQueueEntries hands entries out), so a future trim that drops a field something
// still reads fails here.
const serverQueueEntry = {
  uuid: 'queue-entry-uuid',
  display: 'Alice Johnson',
  queue: { uuid: 'current-queue-uuid', name: 'General Surgery' },
  status: { uuid: 'in-service-status-uuid', display: 'In Service' },
  patient: {
    uuid: 'patient-uuid',
    person: {
      age: 40,
      birthdate: '1986-01-01T00:00:00.000+0000',
      gender: 'F',
    },
    identifiers: [
      {
        uuid: 'identifier-uuid',
        identifier: '100GEJ',
        identifierType: { uuid: openmrsIdTypeUuid, name: 'OpenMRS ID' },
      },
    ],
  },
  visit: {
    uuid: 'visit-uuid',
    startDatetime: '2024-01-02T00:00:00.000+0000',
    stopDatetime: null,
    location: { uuid: 'visit-location-uuid', name: 'Deir Al-Balah PHCC' },
    attributes: [{ uuid: 'visit-attribute-uuid', value: '42', attributeType: { uuid: visitQueueNumberAttributeUuid } }],
  },
  priority: { uuid: 'urgent-priority-uuid', display: 'Urgent' },
  priorityComment: null,
  sortWeight: 0,
  startedAt: '2024-01-02T00:00:00.000+0000',
  endedAt: null,
  queueComingFrom: { uuid: 'coming-from-queue-uuid', name: 'Triage' },
  previousQueueEntry: {
    uuid: 'previous-queue-entry-uuid',
    startedAt: '2024-01-01T00:00:00.000+0000',
    status: { uuid: 'waiting-status-uuid', display: 'Waiting' },
  },
} as unknown as QueueEntry;

const repShapedQueueEntry = withDisplayNames(serverQueueEntry);

type KeyTree = { [key: string]: KeyTree | true };

// Turns `custom:(uuid,queue:(uuid,display))` into `{ uuid: true, queue: { uuid: true, display: true } }`.
function parseRepresentation(rep: string): KeyTree {
  return JSON.parse(
    rep
      .replace(/^custom:/, '')
      .replace(/(\w+):/g, '"$1":')
      .replace(/(\w+)(?=[,)])/g, '"$1":true')
      .replace(/\(/g, '{')
      .replace(/\)/g, '}'),
  );
}

// Mirrors the fixture as the same kind of tree; arrays are represented by their first element.
function toKeyTree(value: unknown): KeyTree | true {
  if (Array.isArray(value)) {
    return value.length > 0 ? toKeyTree(value[0]) : true;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, toKeyTree(nested)]));
  }
  return true;
}

const mockUseConfig = vi.mocked(useConfig<ConfigObject>);
const mockUseSession = vi.mocked(useSession);
const configDefaults = getDefaultsFromConfigSchema<ConfigObject>(configSchema);

vi.mock('../service-queues.resource', async () => ({
  ...((await vi.importActual('../service-queues.resource')) as object),
  serveQueueEntry: vi.fn().mockResolvedValue({ status: 200 }),
  updateQueueEntry: vi.fn().mockResolvedValue({ status: 201 }),
}));

vi.mock('./useQueueEntries', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  useMutateQueueEntries: () => ({ mutateQueueEntries: vi.fn() }),
}));

vi.mock('../modals/call-modal/call-queue-entry.resource', () => ({
  requeueQueueEntry: vi.fn().mockResolvedValue({ status: 200 }),
}));

vi.mock('../hooks/useQueues', () => ({
  useQueues: vi.fn().mockReturnValue({ queues: [] }),
}));

describe('Queue entry custom representation contract', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue(mockSession.data);
    mockUseConfig.mockReturnValue({
      ...configDefaults,
      customPatientChartUrl: 'someUrl',
      visitQueueNumberAttributeUuid,
      defaultIdentifierTypes: [openmrsIdTypeUuid],
      concepts: { ...configDefaults.concepts, defaultTransitionStatus: 'some-default-transition-status' },
    } as ConfigObject);
  });

  it('has a fixture shaped exactly like the representation useQueueEntries requests', () => {
    expect(toKeyTree(serverQueueEntry)).toEqual(parseRepresentation(repString));
  });

  it('only polls for signature fields that the full representation also carries', () => {
    // Each poll's signatures are compared with the same fields of the entries last fetched in full, so a
    // field missing from those would count as a change on every poll.
    const isContainedIn = (inner: KeyTree, outer: KeyTree) =>
      Object.entries(inner).every(
        ([key, value]) =>
          key in outer && (value === true || (outer[key] !== true && isContainedIn(value, outer[key] as KeyTree))),
      );
    expect(isContainedIn(parseRepresentation(signatureRepString), parseRepresentation(repString))).toBe(true);
  });

  it('requests no display string that has a cheaper equivalent', () => {
    // Metadata `display` is a message-source lookup per entry; `name` gives the same string.
    const rep = parseRepresentation(repString) as any;
    expect(rep.queue.display).toBeUndefined();
    expect(rep.queueComingFrom.display).toBeUndefined();
    expect(rep.visit.location.display).toBeUndefined();
    expect(rep.patient.display).toBeUndefined();
    expect(rep.patient.person.display).toBeUndefined();
    expect(rep.patient.identifiers.identifierType.display).toBeUndefined();
  });

  it('supplies every field read by the configured columns', () => {
    mockUseConfig.mockReturnValue({
      ...configDefaults,
      customPatientChartUrl: 'someUrl',
      visitQueueNumberAttributeUuid,
      queueTables: {
        ...configDefaults.queueTables,
        tableDefinitions: [
          {
            columns: [
              'patient-name',
              'patient-identifier',
              'patient-age',
              'coming-from',
              'priority',
              'status',
              'queue',
              'location',
              'queue-number',
              'visit-start-time',
              'wait-time',
              'actions',
            ],
            appliedTo: [{ queue: '', status: '' }],
          },
        ],
      },
    } as ConfigObject);

    renderWithSwr(<QueueTable queueEntries={[repShapedQueueEntry]} queueUuid={null} statusUuid={null} />);

    expect(screen.getByRole('link', { name: 'Alice Johnson' })).toBeInTheDocument();
    expect(screen.getByText('100GEJ')).toBeInTheDocument();
    expect(screen.getByText('Triage')).toBeInTheDocument();
    expect(screen.getByText('Urgent')).toBeInTheDocument();
    expect(screen.getByText('In Service')).toBeInTheDocument();
    expect(screen.getByText('General Surgery')).toBeInTheDocument();
    expect(screen.getByText('Deir Al-Balah PHCC')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    // patient-age, visit-start-time and wait-time render "NaN"/"Invalid Date" if birthdate or a datetime is dropped.
    expect(screen.queryByText(/NaN|Invalid Date/i)).not.toBeInTheDocument();
  });

  it('supplies every field read by the Call action modal', () => {
    renderWithSwr(<CallQueueEntryModal queueEntry={repShapedQueueEntry} closeModal={vi.fn()} />);

    expect(screen.getByText(/Alice Johnson/)).toBeInTheDocument();
    expect(screen.getByText(/OpenMRS ID/)).toBeInTheDocument();
    expect(screen.getAllByText('100GEJ').length).toBeGreaterThan(0);
    expect(screen.getByText(/Gender:\s*F/)).toBeInTheDocument();
    expect(screen.getByText(/Age:\s*40/)).toBeInTheDocument();
  });

  it('supplies every field read by the Undo action modal', () => {
    renderWithSwr(<UndoTransitionQueueEntryModal queueEntry={repShapedQueueEntry} closeModal={vi.fn()} />);

    expect(screen.getByText(/move patient back to queue "Triage" with status "Waiting"/)).toBeInTheDocument();
    expect(screen.getByText(/Undo transition for Alice Johnson/)).toBeInTheDocument();
  });
});
