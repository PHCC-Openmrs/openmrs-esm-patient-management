import dayjs from 'dayjs';
export const spaBasePath = `${window.spaBase}/home`;
export const omrsDateFormat = 'YYYY-MM-DDTHH:mm:ss.SSSZZ';
export const startOfDay = dayjs(new Date().setUTCHours(0, 0, 0, 0)).format(omrsDateFormat);
export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const time12HourFormatRegexPattern = '^(1[0-2]|0?[1-9]):[0-5][0-9]$';

export const serviceQueuesPatientSearchWorkspace = 'create-queue-entry-workspace';
export const serviceQueuesVisitNotesWorkspace = 'service-queues-visit-notes-workspace';
export const serviceQueuesPatientVitalsWorkspace = 'service-queues-patient-vitals-workspace';

export const queueEntryCustomRepresentation =
  'custom:(uuid,display,queue:(uuid,display,name,location:(uuid,display),service:(uuid,display),allowedPriorities:(uuid,display),allowedStatuses:(uuid,display)),status,patient:(uuid,display),visit:(uuid,display,startDatetime),priority,priorityComment,sortWeight,startedAt,endedAt,locationWaitingFor,queueComingFrom,providerWaitingFor,previousQueueEntry)';

// Error codes
export const DUPLICATE_QUEUE_ENTRY_ERROR_CODE = '[queue.entry.duplicate.patient]';
export const QUEUE_ENTRY_ALREADY_ENDED_ERROR = 'queue entry that has already ended';

/**
 * How often the queue screen re-reads the metadata behind its filters and columns (queues,
 * programs, queue locations). The views opt every SWR hook under them into a 15-second poll, and
 * `useSWRImmutable` does not opt out of that, so this metadata - which practically never changes
 * while the screen is open - used to be re-fetched as often as the queue itself.
 */
export const metadataRefreshIntervalMs = 5 * 60 * 1000;
