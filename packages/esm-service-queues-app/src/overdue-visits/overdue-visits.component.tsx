import React from 'react';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';
import {
  Button,
  DataTable,
  DataTableSkeleton,
  Layer,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tile,
} from '@carbon/react';
import {
  ConfigurableLink,
  formatDatetime,
  isDesktop,
  showModal,
  useConfig,
  useLayoutType,
} from '@openmrs/esm-framework';
import { type ConfigObject } from '../config-schema';
import { useOverdueVisits } from '../metrics/metrics.resource';
import styles from '../queue-table/queue-table.scss';

function OverdueVisits() {
  const { t } = useTranslation();
  const layout = useLayoutType();
  const { customPatientChartUrl } = useConfig<ConfigObject>();
  const { overdueVisits, isLoading, mutate } = useOverdueVisits();

  const headers = [
    { key: 'name', header: t('name', 'Name') },
    { key: 'visitStarted', header: t('visitStarted', 'Visit started') },
    { key: 'daysOpen', header: t('daysOpen', 'Days open') },
    { key: 'actions', header: t('actions', 'Actions') },
  ];

  const rows = overdueVisits.map((visit) => ({
    id: visit.uuid,
    name: (
      <ConfigurableLink to={customPatientChartUrl} templateParams={{ patientUuid: visit.patient?.uuid }}>
        {visit.patient?.person?.display}
      </ConfigurableLink>
    ),
    visitStarted: formatDatetime(new Date(visit.startDatetime)),
    daysOpen: Math.max(1, dayjs().diff(dayjs(visit.startDatetime), 'day')),
    actions: (
      <Button
        kind="danger--tertiary"
        size={isDesktop(layout) ? 'sm' : 'lg'}
        onClick={() => {
          const dispose = showModal('end-visit-dialog', {
            patientUuid: visit.patient?.uuid,
            closeModal: () => {
              dispose();
              mutate();
            },
          });
        }}>
        {t('endVisit_title', 'End Visit')}
      </Button>
    ),
  }));

  if (isLoading) {
    return <DataTableSkeleton role="progressbar" />;
  }

  return (
    <div className={styles.defaultQueueTable}>
      <Layer className={styles.tableSection}>
        <div className={styles.headerContainer}>
          <div className={!isDesktop(layout) ? styles.tabletHeading : styles.desktopHeading}>
            <h2>{t('overdueVisits', 'Overdue visits')}</h2>
          </div>
        </div>
        <DataTable rows={rows} headers={headers} size={isDesktop(layout) ? 'sm' : 'lg'} useZebraStyles>
          {({ rows, headers, getTableProps, getHeaderProps, getRowProps }) => (
            <TableContainer className={styles.tableContainer}>
              <Table {...getTableProps()} aria-label={t('overdueVisits', 'Overdue visits')}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <TableHeader key={header.key} {...getHeaderProps({ header })}>
                        {header.header}
                      </TableHeader>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow {...getRowProps({ row })} key={row.id}>
                      {row.cells.map((cell) => (
                        <TableCell key={cell.id}>{cell.value}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
        {rows.length === 0 && (
          <div className={styles.tileContainer}>
            <Tile className={styles.tile}>
              <div className={styles.tileContent}>
                <p className={styles.content}>{t('noOverdueVisits', 'No overdue visits')}</p>
              </div>
            </Tile>
          </div>
        )}
      </Layer>
    </div>
  );
}

export default OverdueVisits;
