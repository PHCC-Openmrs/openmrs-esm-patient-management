import React, { useEffect, useMemo, useState } from 'react';
import { DataTableSkeleton, Dropdown, Layer, TableToolbarSearch } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { isDesktop, showSnackbar, useConfig, useLayoutType } from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import { dedupeQueueEntriesByPatient, isQueueEntryFromToday } from '../service-queues.resource';
import { updateSelectedQueueStatus, useServiceQueuesStore } from '../store/store';
import { useColumns } from './cells/columns.resource';
import { useQueueEntries } from '../hooks/useQueueEntries';
import { useActiveProgramsForPatients } from '../hooks/usePatientPrograms';
import useQueueStatuses from '../hooks/useQueueStatuses';
import ClearQueueEntries from '../modals/clear-queue-entries-modal/clear-queue-entries.component';
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
  const { selectedServiceUuid, selectedQueueLocationUuid, selectedQueueStatusUuid, selectedProgramUuid } =
    useServiceQueuesStore();
  const [searchTerm, setSearchTerm] = useState('');

  // Before any explicit choice is made, default to "In Service" rather than every status - a
  // freshly-loaded queue should read as "who's being attended to right now", not lump waiting
  // and finished patients in together.
  const effectiveStatusUuid = selectedQueueStatusUuid || concepts.defaultTransitionStatus;

  // "Finished Service" is the one status the backend only ever sets on entries it has already
  // ended, so requesting isEnded: false there would hide every match - see searchCriteria below.
  const isFinishedServiceStatusSelected = selectedQueueStatusUuid === concepts.defaultFinishedServiceStatus;

  const searchCriteria = useMemo(() => {
    // The backend auto-ends a queue entry whenever its visit ends, regardless of status, and also
    // ends an entry once the patient moves on to a later queue/room. Excluding ended entries is
    // therefore correct for every status except the terminal "Finished Service" one. Every other
    // status (e.g. "In Service", "Waiting") must still exclude ended entries, or an
    // already-finished/superseded entry keeps showing as if still active.
    return {
      service: selectedServiceUuid,
      isEnded: isFinishedServiceStatusSelected ? undefined : false,
      status: effectiveStatusUuid,
    };
  }, [selectedServiceUuid, isFinishedServiceStatusSelected, effectiveStatusUuid]);

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
    const todaysEntries = queueEntries
      ?.filter(isQueueEntryFromToday)
      .filter(
        (queueEntry) => !selectedQueueLocationUuid || queueEntry.visit?.location?.uuid === selectedQueueLocationUuid,
      )
      .filter((queueEntry) => {
        if (!selectedProgramUuid) {
          return true;
        }
        const patientPrograms = programsByPatientUuid[queueEntry.patient?.uuid] ?? [];
        return patientPrograms.some((enrollment) => enrollment.program?.uuid === selectedProgramUuid);
      });

    // A patient can legitimately have more than one entry today (e.g. two separate,
    // fully-completed visits) - only show their most current one, not every historical entry.
    return dedupeQueueEntriesByPatient(todaysEntries ?? []).filter((queueEntry) => {
      return columns?.some((column) => {
        const columnSearchTerm = column.getFilterableValue?.(queueEntry)?.toLocaleLowerCase();
        return columnSearchTerm?.includes(searchTermLowercase);
      });
    });
  }, [columns, queueEntries, searchTerm, selectedQueueLocationUuid, selectedProgramUuid, programsByPatientUuid]);

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
          {filteredQueueEntries?.length > 0 && <ClearQueueEntries queueEntries={filteredQueueEntries} />}
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
