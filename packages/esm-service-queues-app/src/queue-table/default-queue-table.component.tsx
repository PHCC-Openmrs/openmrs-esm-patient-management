import React, { useEffect, useMemo, useState } from 'react';
import { DataTableSkeleton, Dropdown, Layer, TableToolbarSearch } from '@carbon/react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import { isDesktop, showSnackbar, useConfig, useLayoutType } from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import { updateSelectedQueueStatus, useServiceQueuesStore } from '../store/store';
import { useColumns } from './cells/columns.resource';
import { useQueueEntries } from '../hooks/useQueueEntries';
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
  const { selectedServiceUuid, selectedQueueLocationUuid, selectedQueueStatusUuid } = useServiceQueuesStore();
  const [searchTerm, setSearchTerm] = useState('');

  const searchCriteria = useMemo(() => {
    return {
      service: selectedServiceUuid,
      // The backend auto-ends a queue entry whenever its visit ends, regardless of status. Excluding
      // ended entries only makes sense for the unfiltered "Any" view; a specific status filter (e.g.
      // "Finished Service") should still surface today's matches even though the backend marked them ended.
      isEnded: selectedQueueStatusUuid ? undefined : false,
      status: selectedQueueStatusUuid,
    };
  }, [selectedServiceUuid, selectedQueueStatusUuid]);

  const { queueEntries, isLoading, error, isValidating } = useQueueEntries(searchCriteria);

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
    return queueEntries
      ?.filter(
        (queueEntry) =>
          dayjs(queueEntry.startedAt).isSame(dayjs(), 'day') ||
          (queueEntry.endedAt && dayjs(queueEntry.endedAt).isSame(dayjs(), 'day')),
      )
      .filter(
        (queueEntry) => !selectedQueueLocationUuid || queueEntry.visit?.location?.uuid === selectedQueueLocationUuid,
      )
      .filter((queueEntry) => {
        return columns?.some((column) => {
          const columnSearchTerm = column.getFilterableValue?.(queueEntry)?.toLocaleLowerCase();
          return columnSearchTerm?.includes(searchTermLowercase);
        });
      });
  }, [columns, queueEntries, searchTerm, selectedQueueLocationUuid]);

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

  return (
    <div className={styles.filterContainer}>
      <Dropdown
        id="statusFilter"
        items={filteredStatuses}
        itemToString={(item) => (item ? item.display : '')}
        label={selectedQueueStatusDisplay ?? t('all', 'All')}
        onChange={handleStatusChange}
        size={isDesktop(layout) ? 'sm' : 'lg'}
        titleText={t('showPatientsWithStatus', 'Show patients with status:')}
        type="inline"
      />
    </div>
  );
}

export default DefaultQueueTable;
