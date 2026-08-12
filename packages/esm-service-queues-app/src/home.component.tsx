import React from 'react';
import PatientQueueHeader from './patient-queue-header/patient-queue-header.component';
import ClinicMetrics from './metrics/metrics-container.component';
import DefaultQueueTable from './queue-table/default-queue-table.component';
import OverdueVisits from './overdue-visits/overdue-visits.component';

const Home: React.FC = () => {
  return (
    <>
      <PatientQueueHeader showFilters />
      <ClinicMetrics />
      <DefaultQueueTable />
      <OverdueVisits />
    </>
  );
};

export default Home;
