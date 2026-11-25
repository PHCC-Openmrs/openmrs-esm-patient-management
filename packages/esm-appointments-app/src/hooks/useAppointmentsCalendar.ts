import { openmrsFetch, restBaseUrl } from '@openmrs/esm-framework';
import dayjs from 'dayjs';
import useSWR from 'swr';
import { toAppointmentsApiDate } from '../helpers/functions';
import { type DailyAppointmentsCountByService } from '../types';

interface AppointmentCountMapEntry {
  allAppointmentsCount: number;
}

interface AppointmentSummaryResponse {
  appointmentService: {
    name: string;
    uuid: string;
  };
  appointmentCountMap: Map<string, AppointmentCountMapEntry>;
}

export const useAppointmentsCalendar = (forDate: string, period: string) => {
  const { startDate, endDate } = evaluateAppointmentCalendarDates(forDate, period);
  const url = `${restBaseUrl}/appointment/appointmentSummary?startDate=${startDate}&endDate=${endDate}`;

  const { data, error, isLoading } = useSWR<{ data: Array<AppointmentSummaryResponse> }>(
    startDate && endDate ? url : null,
    openmrsFetch,
    { errorRetryCount: 2 },
  );
  // Transform API response into daily appointment counts grouped by service
  const results: Array<DailyAppointmentsCountByService> = data?.data.reduce((acc, service) => {
    const serviceName = service.appointmentService.name;
    const serviceUuid = service.appointmentService.uuid;
    Object.entries(service.appointmentCountMap).forEach(([key, value]) => {
      const existingEntry = acc.find((entry) => entry.appointmentDate === key);
      if (existingEntry) {
        existingEntry.services.push({ serviceName, serviceUuid, count: value.allAppointmentsCount });
      } else {
        acc.push({
          appointmentDate: key,
          services: [{ serviceName, serviceUuid, count: value.allAppointmentsCount }],
        });
      }
    });
    return acc;
  }, []);
  return { isLoading, calendarEvents: results, error };
};

function evaluateAppointmentCalendarDates(forDate: string, period: string) {
  if (period === 'daily') {
    return {
      startDate: toAppointmentsApiDate(dayjs(forDate).startOf('day')),
      endDate: toAppointmentsApiDate(dayjs(forDate).endOf('day')),
    };
  }

  if (period === 'weekly') {
    return {
      startDate: toAppointmentsApiDate(dayjs(forDate).startOf('week')),
      endDate: toAppointmentsApiDate(dayjs(forDate).endOf('week')),
    };
  }

  if (period === 'monthly') {
    return {
      startDate: toAppointmentsApiDate(dayjs(forDate).startOf('month')),
      endDate: toAppointmentsApiDate(dayjs(forDate).endOf('month')),
    };
  }
}
