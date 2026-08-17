import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Dropdown, DropdownSkeleton, InlineNotification, type OnChangeData } from '@carbon/react';
import { useConfig, useSession, PageHeader, PageHeaderContent, ServiceQueuesPictogram } from '@openmrs/esm-framework';
import { useQueueLocations } from '../create-queue-entry/hooks/useQueueLocations';
import {
  updateSelectedQueueLocationUuid,
  updateSelectedQueueLocationName,
  updateSelectedService,
  updateSelectedProgram,
  useServiceQueuesStore,
} from '../store/store';
import { useQueues } from '../hooks/useQueues';
import { usePrograms } from '../hooks/usePatientPrograms';
import type { ConfigObject } from '../config-schema';
import styles from './patient-queue-header.scss';

interface PatientQueueHeaderProps {
  title?: string | JSX.Element;
  showFilters: boolean;
  showLocationFilter?: boolean;
  showServiceFilter?: boolean;
  showProgramFilter?: boolean;
  actions?: React.ReactNode;
}

const PatientQueueHeader: React.FC<PatientQueueHeaderProps> = ({
  title,
  showFilters,
  showLocationFilter = true,
  showServiceFilter = true,
  showProgramFilter = false,
  actions,
}) => {
  const { t } = useTranslation();
  const { queueLocations, isLoading, error } = useQueueLocations();
  const { dashboardTitle } = useConfig<ConfigObject>();
  const userSession = useSession();
  const { selectedQueueLocationName, selectedQueueLocationUuid, selectedServiceDisplay, selectedProgramDisplay } =
    useServiceQueuesStore();
  const { queues } = useQueues();
  const { programs } = usePrograms();
  const showLocationDropdown = showFilters && showLocationFilter && queueLocations.length > 1;
  const showServiceDropdown = showFilters && showServiceFilter && queues.length > 1;
  const showProgramDropdown = showFilters && showProgramFilter && programs.length > 1;

  const serviceOptions = useMemo(() => {
    const options = queues
      .map((queue) => ({ id: queue.service.uuid, name: queue.service.display }))
      .reduce((acc, curr) => {
        if (!acc.some((option) => option.id === curr.id)) {
          acc.push(curr);
        }
        return acc;
      }, []);
    return options.length !== 1 ? [{ id: 'all', name: t('all', 'All') }, ...options] : options;
  }, [queues, t]);

  const programOptions = useMemo(() => {
    const options = programs.map((program) => ({ id: program.uuid, name: program.name }));
    return options.length !== 1 ? [{ id: 'all', name: t('all', 'All') }, ...options] : options;
  }, [programs, t]);

  const handleQueueLocationChange = useCallback(
    ({ selectedItem }) => {
      if (selectedItem.id === 'all') {
        updateSelectedQueueLocationUuid(null);
        updateSelectedQueueLocationName(null);
      } else {
        updateSelectedQueueLocationUuid(selectedItem.id);
        updateSelectedQueueLocationName(selectedItem.name);
        updateSelectedService(null, t('all', 'All'));
      }
    },
    [t],
  );

  const handleServiceChange = useCallback(
    (data: OnChangeData<{ id: string; name: string }>) => {
      const selectedItem = data.selectedItem;
      if (selectedItem) {
        if (selectedItem.id === 'all') {
          updateSelectedService(null, t('all', 'All'));
        } else {
          updateSelectedService(selectedItem.id, selectedItem.name);
        }
      }
    },
    [t],
  );

  const handleProgramChange = useCallback(
    (data: OnChangeData<{ id: string; name: string }>) => {
      const selectedItem = data.selectedItem;
      if (selectedItem) {
        if (selectedItem.id === 'all') {
          updateSelectedProgram(null, t('all', 'All'));
        } else {
          updateSelectedProgram(selectedItem.id, selectedItem.name);
        }
      }
    },
    [t],
  );

  useEffect(() => {
    if (isLoading || error) {
      return;
    }
    // selectedQueueLocationUuid is persisted in sessionStorage, so it can carry a stale value across
    // session-location changes. When the location dropdown isn't shown, there's no way for the user to
    // manually override it, so always mirror the live session location instead of leaving a stale
    // (possibly wrong-location) selection in place.
    if (!showLocationDropdown && userSession?.sessionLocation?.uuid) {
      if (selectedQueueLocationUuid !== userSession.sessionLocation.uuid) {
        handleQueueLocationChange({
          selectedItem: {
            id: userSession.sessionLocation.uuid,
            name: userSession.sessionLocation.display,
          },
        });
      }
      return;
    }
    if (!selectedQueueLocationUuid) {
      // Prefer the session location, even if it isn't tagged as a "queue location" -- otherwise a
      // deployment with exactly one tagged queue location would force-select that location instead
      // of the clinician's actual session location, and the tables would show the wrong patients.
      if (userSession?.sessionLocation?.uuid) {
        handleQueueLocationChange({
          selectedItem: {
            id: userSession?.sessionLocation?.uuid,
            name: userSession?.sessionLocation?.display,
          },
        });
      } else if (queueLocations.length === 1) {
        handleQueueLocationChange({ selectedItem: queueLocations[0] });
      }
    }
  }, [
    showLocationDropdown,
    selectedQueueLocationName,
    selectedQueueLocationUuid,
    error,
    handleQueueLocationChange,
    isLoading,
    queueLocations,
    userSession?.sessionLocation?.display,
    userSession?.sessionLocation?.uuid,
  ]);

  return (
    <PageHeader className={styles.header} data-testid="patient-queue-header">
      <PageHeaderContent
        title={title ? title : t(dashboardTitle.key, dashboardTitle.value)}
        illustration={<ServiceQueuesPictogram />}
      />
      <div className={styles.dropdownContainer}>
        {isLoading ? (
          <div className={styles.dropdownSkeletonContainer}>
            <DropdownSkeleton />
          </div>
        ) : error ? (
          <div className={styles.errorContainer}>
            <InlineNotification
              kind="error"
              title={t('failedToLoadLocations', 'Failed to load locations')}
              hideCloseButton
            />
          </div>
        ) : (
          showLocationDropdown && (
            <Dropdown
              aria-label={t('selectQueueLocation', 'Select a queue location')}
              className={styles.dropdown}
              id="queueLocationDropdown"
              label={selectedQueueLocationName ?? t('all', 'All')}
              items={
                queueLocations.length !== 1 ? [{ id: 'all', name: t('all', 'All') }, ...queueLocations] : queueLocations
              }
              itemToString={(item: { name: string } | null) => (item ? item.name : '')}
              titleText={t('location', 'Location')}
              type="inline"
              onChange={handleQueueLocationChange}
            />
          )
        )}
        {showServiceDropdown && (
          <Dropdown
            aria-label={t('selectService', 'Select a service')}
            className={styles.dropdown}
            id="serviceDropdown"
            label={selectedServiceDisplay ?? t('all', 'All')}
            items={serviceOptions}
            itemToString={(item) => item?.name}
            titleText={t('service', 'Service')}
            type="inline"
            onChange={handleServiceChange}
          />
        )}
        {showProgramDropdown && (
          <Dropdown
            aria-label={t('selectServiceType', 'Select a service type')}
            className={styles.dropdown}
            id="programDropdown"
            label={selectedProgramDisplay ?? t('all', 'All')}
            items={programOptions}
            itemToString={(item) => item?.name}
            titleText={t('serviceType', 'Service type')}
            type="inline"
            onChange={handleProgramChange}
          />
        )}
        {actions}
      </div>
    </PageHeader>
  );
};

export default PatientQueueHeader;
