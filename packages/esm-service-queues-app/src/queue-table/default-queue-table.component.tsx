import React, { useEffect, useMemo } from 'react';
import { DataTableSkeleton, Dropdown, Layer, TableToolbarSearch } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import { isDesktop, showSnackbar, useConfig, useLayoutType } from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import {
  ALL_QUEUE_STATUSES_UUID,
  updateQueueTableSearchTerm,
  updateSelectedPriority,
  updateSelectedQueue,
  updateSelectedQueueStatus,
  useServiceQueuesStore,
} from '../store/store';
import { useColumns } from './cells/columns.resource';
import { useCurrentQueueEntries } from '../hooks/useCurrentQueueEntries';
import { useQueues } from '../hooks/useQueues';
import usePriorities from '../hooks/usePriorities';
import useQueueStatuses from '../hooks/useQueueStatuses';
import QueuePriority from './components/queue-priority.component';
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
  const { queueTableSearchTerm } = useServiceQueuesStore();

  // Shared with the metrics cards above this table, so the cards count exactly the population the
  // table lists: every filter the user picks, including the status dropdown and the search box
  // below, is applied there once. With no status picked -- the state a fresh session starts in --
  // nothing is narrowed by status, so the table opens on every status side by side.
  const { currentQueueEntries, isLoading, error, isValidating } = useCurrentQueueEntries();

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

  if (isLoading) {
    return <DataTableSkeleton role="progressbar" />;
  }

  return (
    <QueueTable
      ExpandedRow={QueueTableExpandedRow}
      isValidating={isValidating}
      queueEntries={currentQueueEntries ?? []}
      queueUuid={null}
      statusUuid={null}
      tableFilters={
        <>
          <QueueDropdownFilter />
          <StatusDropdownFilter />
          <PriorityDropdownFilter />
          <TableToolbarSearch
            className={styles.search}
            onChange={(e) => {
              if (typeof e === 'string') {
                updateQueueTableSearchTerm(e);
              } else if (e && 'target' in e) {
                const target = e.target as HTMLInputElement;
                updateQueueTableSearchTerm(target.value);
              }
            }}
            value={queueTableSearchTerm ?? ''}
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
  const { selectedQueueStatusUuid } = useServiceQueuesStore();

  const statusItems = useMemo(
    () => [
      { uuid: ALL_QUEUE_STATUSES_UUID, display: t('all', 'All') },
      ...(statuses ?? []).filter((status) => status?.uuid && status.uuid !== concepts.defaultStatusConceptUuid),
    ],
    [statuses, concepts.defaultStatusConceptUuid, t],
  );

  // An absent selection is the same view as an explicit "All" -- every status at once -- so the
  // dropdown labels itself "All" until the user narrows it, matching the queue and priority
  // dropdowns either side of it.
  const selectedStatus = useMemo(
    () => statusItems.find((status) => status?.uuid === (selectedQueueStatusUuid ?? ALL_QUEUE_STATUSES_UUID)),
    [statusItems, selectedQueueStatusUuid],
  );

  const handleStatusChange = ({ selectedItem }) => {
    updateSelectedQueueStatus(selectedItem?.uuid, selectedItem?.display);
  };

  return (
    <div className={styles.filterContainer}>
      <Dropdown
        id="statusFilter"
        items={statusItems}
        itemToString={(item) => (item ? item.display : '')}
        label={selectedStatus?.display ?? t('all', 'All')}
        onChange={handleStatusChange}
        selectedItem={selectedStatus ?? null}
        size={isDesktop(layout) ? 'sm' : 'lg'}
        titleText={t('showPatientsWithStatus', 'Show patients with status:')}
        type="inline"
      />
    </div>
  );
}

function PriorityDropdownFilter() {
  const { t } = useTranslation();
  const layout = useLayoutType();
  const { priorityConfigs } = useConfig<ConfigObject>();
  const { selectedPriorityUuid, selectedPriorityDisplay, selectedQueueLocationUuid } = useServiceQueuesStore();
  // Scoped to the location on screen for the same reason the queue dropdown is: a location's
  // queues are the only ones whose entries this table lists, so offering priorities that only
  // exist on some other location's queues would just be dead options.
  const { priorities } = usePriorities(selectedQueueLocationUuid);

  const priorityItems = useMemo(
    () => [{ uuid: 'all', display: t('all', 'All') }, ...(priorities ?? [])],
    [priorities, t],
  );

  const handlePriorityChange = ({ selectedItem }) => {
    if (!selectedItem || selectedItem.uuid === 'all') {
      updateSelectedPriority(null, null);
    } else {
      updateSelectedPriority(selectedItem.uuid, selectedItem.display);
    }
  };

  return (
    <div className={styles.filterContainer}>
      <Dropdown
        id="priorityFilter"
        items={priorityItems}
        itemToString={(item) => (item ? item.display : '')}
        // Render the real priority tag for each option, so the dropdown carries the same
        // green/orange/red grading as the table's Priority column and the Move modal.
        itemToElement={(item) =>
          item && item.uuid !== 'all' ? (
            <QueuePriority priority={item} priorityConfigs={priorityConfigs} />
          ) : (
            <span>{item?.display}</span>
          )
        }
        label={selectedPriorityDisplay ?? t('all', 'All')}
        onChange={handlePriorityChange}
        selectedItem={priorityItems.find((item) => item.uuid === (selectedPriorityUuid ?? 'all'))}
        size={isDesktop(layout) ? 'sm' : 'lg'}
        titleText={t('showPatientsWithPriority', 'Show patients with priority:')}
        type="inline"
      />
    </div>
  );
}

export default DefaultQueueTable;
