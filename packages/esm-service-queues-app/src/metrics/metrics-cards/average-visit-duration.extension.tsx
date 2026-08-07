import React from 'react';
import { useTranslation } from 'react-i18next';
import { MetricsCard, MetricsCardHeader, MetricsCardBody, MetricsCardItem } from './metrics-card.component';
import { useCompletedVisits } from '../metrics.resource';

export default function AverageVisitDurationExtension() {
  const { t } = useTranslation();
  const { isLoading, averageVisitDurationInMinutes } = useCompletedVisits();

  return (
    <MetricsCard>
      <MetricsCardHeader title={t('averageVisitDuration', 'Average visit duration')} />
      <MetricsCardBody>
        <MetricsCardItem
          label={t('minutes', 'Minutes')}
          value={isLoading || averageVisitDurationInMinutes === null ? '--' : averageVisitDurationInMinutes}
        />
      </MetricsCardBody>
    </MetricsCard>
  );
}
