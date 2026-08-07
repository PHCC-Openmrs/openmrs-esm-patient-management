import React from 'react';
import { useTranslation } from 'react-i18next';
import { MetricsCard, MetricsCardHeader, MetricsCardBody, MetricsCardItem } from './metrics-card.component';
import { useCompletedVisits } from '../metrics.resource';

export default function CompletedVisitsExtension() {
  const { t } = useTranslation();
  const { isLoading, completedVisitsCount } = useCompletedVisits();

  return (
    <MetricsCard>
      <MetricsCardHeader title={t('visitsCompletedToday', 'Visits completed today')} />
      <MetricsCardBody>
        <MetricsCardItem label={t('visits', 'Visits')} value={isLoading ? '--' : completedVisitsCount} />
      </MetricsCardBody>
    </MetricsCard>
  );
}
