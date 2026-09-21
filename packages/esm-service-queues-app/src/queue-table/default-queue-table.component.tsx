import React, { useEffect, useMemo, useState } from 'react';
import { DataTableSkeleton, Dropdown, Layer, TableToolbarSearch } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { isDesktop, showSnackbar, useConfig, useLayoutType } from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import { dedupeQueueEntriesByPatient, isQueueEntryFromToday } from '../service-queues.resource';
import { updateSelectedQueue, updateSelectedQueueStatus, useServiceQueuesStore } from '../store/store';
import { useColumns } from './cells/columns.resource';
import { useQueueEntries } from '../hooks/useQueueEntries';
import { useQueues } from '../hooks/useQueues';
import { useActiveProgramsForPatients } from '../hooks/usePatientPrograms';
import useQueueStatuses from '../hooks/useQueueStatuses';
import QueueTable from './queue-table.component';
import QueueTableExpandedRow from './queue-table-expanded-row.component';
import styles from './queue-table.scss';

function DefaultQueueTable() {
  const { t } = useTranslation();
  const layout = useLayoutType();

  return (
    <div className={styles.defaultQueueTable}>
      <Layer className={styles.tableSection}>
        <div className={styles.headerContainer}>
          <div className={!isDesktop(layout) ? styles.tabletHeading : styles.desktopHeading}>
            <h2>{t('patientsCurrentlyInQueue', 'Patients currently in queue')}</h2>
          </div>
        </div>
        <QueueTableSection />
      </Layer>
    </div>
  );
}

function QueueTableSection() {
  const { t } = useTranslation();
  const layout = useLayoutType();
  const { concepts } = useConfig<ConfigObject>();
  const {
    selectedServiceUuid,
    selectedQueueLocationUuid,
    selectedQueueStatusUuid,
    selectedProgramUuid,
    selectedQueueUuid,
  } = useServiceQueuesStore();
  const [searchTerm, setSearchTerm] = useState('');

  // Before any explicit choice is made, default to "In Service" rather than every status - a
  // freshly-loaded queue should read as "who's being attended to right now", not lump waiting
  // and finished patients in together.
  const effectiveStatusUuid = selectedQueueStatusUuid || concepts.defaultTransitionStatus;

  const searchCriteria = useMemo(() => {
    // Always fetch every status this deployment's workflow can produce (In Service, Finished
    // Service) in one request, rather than only the currently-selected one. A patient who
    // finished one visit and started a new one later the same day would otherwise still show
    // under "Finished Service" - their older, superseded entry - since a query scoped to just
    // that one status has no way to know a newer entry with a different status now exists for
    // the same patient. isEnded is intentionally omitted: In Service entries are naturally
    // still open, Finished Service ones are always already ended, and any stale/ended
    // intermediate room-step entries that slip in regardless get discarded by the per-patient
    // "keep only the latest" dedup below.
    //
    // The selected queue is deliberately not sent as a search param either, for the same reason.
    // Moving a patient between rooms ends their entry in the room they left and opens a new one
    // in the room they moved to, so a query scoped to a single queue only ever sees one side of
    // that move and the dedup below has nothing to compare against: the patient goes on being
    // listed as still present in the room they left, while also appearing in the room they moved
    // to. Fetch across queues - exactly as the "All" option already does - and apply the queue
    // filter client-side, after the dedup has settled which entry is the patient's current one.
    return {
      service: selectedServiceUuid,
      status: [concepts.defaultTransitionStatus, concepts.defaultFinishedServiceStatus],
    };
  }, [selectedServiceUuid, concepts.defaultTransitionStatus, concepts.defaultFinishedServiceStatus]);

  const { queueEntries, isLoading, error, isValidating } = useQueueEntries(searchCriteria);

  // Program enrollment isn't part of the queue-entry representation, so it can't be filtered
  // server-side -- only fetched (and filtered) once we know which patients are on this page.
  const patientUuidsNeedingProgramCheck = useMemo(
    () => (selectedProgramUuid ? (queueEntries ?? []).map((entry) => entry.patient?.uuid).filter(Boolean) : []),
    [queueEntries, selectedProgramUuid],
  );
  const { programsByPatientUuid } = useActiveProgramsForPatients(patientUuidsNeedingProgramCheck);

  useEffect(() => {
    if (error?.message) {
      showSnackbar({
        title: t('errorLoadingQueueEntries', 'Error loading queue entries'),
        kind: 'error',
        subtitle: error?.message,
      });
    }
  }, [error?.message, t]);

  const columns = useColumns(null, null);
  useEffect(() => {
    if (!columns) {
      showSnackbar({
        kind: 'warning',
        title: t('notableConfig', 'No table configuration'),
        subtitle: 'No table configuration defined for queue: null and status: null',
      });
    }
  }, [columns, t]);

  const filteredQueueEntries = useMemo(() => {
    const searchTermLowercase = searchTerm.toLowerCase();

    // A patient can legitimately have more than one entry today (e.g. finishing one visit and
    // starting a new one later) - establish their single most current entry first, across every
    // fetched status, before applying any other filter. Otherwise a patient's older, superseded
    // "Finished Service" entry could still pass the status filter below even though they now
    // have a newer "In Service" entry.
    const todaysLatestEntryPerPatient = dedupeQueueEntriesByPatient((queueEntries ?? []).filter(isQueueEntryFromToday));

    return todaysLatestEntryPerPatient
      .filter((queueEntry) => !selectedQueueUuid || queueEntry.queue?.uuid === selectedQueueUuid)
      .filter((queueEntry) => queueEntry.status?.uuid === effectiveStatusUuid)
      .filter(
        (queueEntry) => !selectedQueueLocationUuid || queueEntry.visit?.location?.uuid === selectedQueueLocationUuid,
      )
      .filter((queueEntry) => {
        if (!selectedProgramUuid) {
          return true;
        }
        const patientPrograms = programsByPatientUuid[queueEntry.patient?.uuid] ?? [];
        return patientPrograms.some((enrollment) => enrollment.program?.uuid === selectedProgramUuid);
      })
      .filter((queueEntry) => {
        return columns?.some((column) => {
          const columnSearchTerm = column.getFilterableValue?.(queueEntry)?.toLocaleLowerCase();
          return columnSearchTerm?.includes(searchTermLowercase);
        });
      });
  }, [
    columns,
    queueEntries,
    searchTerm,
    effectiveStatusUuid,
    selectedQueueUuid,
    selectedQueueLocationUuid,
    selectedProgramUuid,
    programsByPatientUuid,
  ]);

  if (isLoading) {
    return <DataTableSkeleton role="progressbar" />;
  }

  return (
    <QueueTable
      ExpandedRow={QueueTableExpandedRow}
      isValidating={isValidating}
      queueEntries={filteredQueueEntries ?? []}
      queueUuid={null}
      statusUuid={null}
      tableFilters={
        <>
          <QueueDropdownFilter />
          <StatusDropdownFilter />
          <TableToolbarSearch
            className={styles.search}
            onChange={(e) => {
              if (typeof e === 'string') {
                setSearchTerm(e);
              } else if (e && 'target' in e) {
                const target = e.target as HTMLInputElement;
                setSearchTerm(target.value);
              }
            }}
            placeholder={t('searchThisList', 'Search this list')}
            size={isDesktop(layout) ? 'sm' : 'lg'}
            persistent
          />
        </>
      }
    />
  );
}

function QueueDropdownFilter() {
  const { t } = useTranslation();
  const layout = useLayoutType();
  const { selectedQueueDisplay, selectedQueueLocationUuid } = useServiceQueuesStore();
  // Queue names are only unique within a location -- every location runs its own "Doctor Room 1",
  // "Pharmacy", "Front Desk" and so on -- so an unscoped list repeats each name once per location.
  // Scope it to the location currently being viewed, which is the only location whose entries this
  // table shows anyway.
  const { queues } = useQueues(selectedQueueLocationUuid);

  const queueItems = useMemo(() => {
    const locationQueues = queues ?? [];
    // With no location selected ("All"), same-named queues from different locations are back in the
    // list together -- qualify just those with their location so they can still be told apart.
    const ambiguousDisplays = new Set(
      locationQueues.map(({ display }) => display).filter((display, index, all) => all.indexOf(display) !== index),
    );

    return [
      { uuid: 'all', display: t('all', 'All') },
      ...locationQueues.map((queue) => ({
        uuid: queue.uuid,
        display:
          ambiguousDisplays.has(queue.display) && queue.location?.display
            ? `${queue.display} (${queue.location.display})`
            : queue.display,
      })),
    ];
  }, [queues, t]);

  const handleQueueChange = ({ selectedItem }) => {
    if (selectedItem.uuid === 'all') {
      updateSelectedQueue(null, null);
    } else {
      updateSelectedQueue(selectedItem.uuid, selectedItem.display);
    }
  };

  return (
    <div className={styles.filterContainer}>
      <Dropdown
        id="queueFilter"
        items={queueItems}
        itemToString={(item) => (item ? item.display : '')}
        label={selectedQueueDisplay ?? t('all', 'All')}
        onChange={handleQueueChange}
        size={isDesktop(layout) ? 'sm' : 'lg'}
        titleText={t('showPatientsInQueue', 'Show patients in queue:')}
        type="inline"
      />
    </div>
  );
}

function StatusDropdownFilter() {
  const { t } = useTranslation();
  const layout = useLayoutType();
  const { statuses } = useQueueStatuses();
  const { concepts } = useConfig<ConfigObject>();
  const { selectedQueueStatusDisplay } = useServiceQueuesStore();
  const handleStatusChange = ({ selectedItem }) => {
    updateSelectedQueueStatus(selectedItem.uuid, selectedItem?.display);
  };

  const filteredStatuses = useMemo(
    () => (statuses ?? []).filter((status) => status?.uuid !== concepts.defaultStatusConceptUuid),
    [statuses, concepts.defaultStatusConceptUuid],
  );

  // "In Service" (defaultTransitionStatus) is what the unfiltered query above now actually
  // returns by default (see QueueTableSection) -- so before any explicit selection is made, the
  // dropdown should label itself with that status rather than "All", since "All" isn't a real
  // selectable option and doesn't describe what's actually on screen.
  const defaultStatus = useMemo(
    () => (statuses ?? []).find((status) => status?.uuid === concepts.defaultTransitionStatus),
    [statuses, concepts.defaultTransitionStatus],
  );

  return (
    <div className={styles.filterContainer}>
      <Dropdown
        id="statusFilter"
        items={filteredStatuses}
        itemToString={(item) => (item ? item.display : '')}
        label={selectedQueueStatusDisplay ?? defaultStatus?.display ?? t('all', 'All')}
        onChange={handleStatusChange}
        size={isDesktop(layout) ? 'sm' : 'lg'}
        titleText={t('showPatientsWithStatus', 'Show patients with status:')}
        type="inline"
      />
    </div>
  );
}

export default DefaultQueueTable;
