import React from 'react';
import { useTranslation } from 'react-i18next';
import { MetricsCard, MetricsCardHeader, MetricsCardBody, MetricsCardItem } from './metrics-card.component';
import { useUrgentPatients } from '../metrics.resource';

export default function UrgentPatientsExtension() {
  const { t } = useTranslation();
  const { isLoading, urgentPatientsCount } = useUrgentPatients();

  return (
    <MetricsCard>
      <MetricsCardHeader title={t('urgentPatients', 'Urgent Patients')} />
      <MetricsCardBody>
        <MetricsCardItem label={t('patients', 'Patients')} value={isLoading ? '--' : urgentPatientsCount} />
      </MetricsCardBody>
    </MetricsCard>
  );
}
