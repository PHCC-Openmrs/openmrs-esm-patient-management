import React from 'react';
import { useTranslation } from 'react-i18next';
import { MetricsCard, MetricsCardHeader, MetricsCardBody, MetricsCardItem } from './metrics-card.component';
import { useCheckedInPatients } from '../metrics.resource';

export default function CheckedInPatientsExtension() {
  const { t } = useTranslation();
  const { isLoading, checkedInPatientsCount } = useCheckedInPatients();

  return (
    <MetricsCard>
      <MetricsCardHeader title={t('checkedInPatients', 'In Service')} />
      <MetricsCardBody>
        <MetricsCardItem label={t('patients', 'Patients')} value={isLoading ? '--' : checkedInPatientsCount} />
      </MetricsCardBody>
    </MetricsCard>
  );
}
