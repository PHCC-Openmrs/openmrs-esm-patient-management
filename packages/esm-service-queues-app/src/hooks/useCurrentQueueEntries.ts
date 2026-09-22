import { useMemo } from 'react';
import { useConfig } from '@openmrs/esm-framework';
import dayjs from 'dayjs';
import { type ConfigObject } from '../config-schema';
import { dedupeQueueEntriesByPatient, isQueueEntryFromToday } from '../service-queues.resource';
import { ALL_QUEUE_STATUSES_UUID, useServiceQueuesStore } from '../store/store';
import { useColumns } from '../queue-table/cells/columns.resource';
import { useActiveProgramsForPatients } from './usePatientPrograms';
import { useQueueEntries } from './useQueueEntries';

/**
 * The single source of truth for "who is in the queue right now", shared by the queue table and
 * the metrics cards above it so the two can't disagree: every population filter the user can
 * pick is applied here, once: service, queue/room, queue location, priority, program, an
 * explicitly-chosen status and the table's free-text search. The one thing left to a caller is
 * the table's fallback to "In Service" when no status has been picked at all - that fallback is
 * the table's own default view, not a filter the user chose, and applying it to the population
 * would permanently zero the Finished Service and Average visit duration cards.
 *
 * Priority is applied client-side, after the dedup, for the same reason as the queue: it is a
 * property of a single entry, not of the patient. Sending priority=<uuid> as a search param would
 * narrow the fetch *before* the dedup can establish which entry is the patient's current one, so a
 * patient triaged Not Urgent this morning and re-triaged Urgent since would still be fetched (and
 * listed) under Not Urgent, on the strength of an entry that has already been superseded.
 *
 * Every status this deployment's workflow can produce (In Service, Finished Service) is fetched
 * in one request rather than only the currently-selected one, and reduced to each patient's
 * single most current entry today. A patient who finished one visit and started a new one later
 * the same day would otherwise still show under "Finished Service" - their older, superseded
 * entry - since a query scoped to just one status has no way to know a newer entry with a
 * different status now exists for the same patient. isEnded is intentionally omitted: In Service
 * entries are naturally still open, Finished Service ones are always already ended, and any
 * stale/ended intermediate room-step entries that slip in regardless get discarded by the
 * per-patient "keep only the latest" dedup.
 *
 * The selected queue is deliberately not sent as a search param either, for the same reason.
 * Moving a patient between rooms ends their entry in the room they left and opens a new one in
 * the room they moved to, so a query scoped to a single queue only ever sees one side of that
 * move and the dedup has nothing to compare against: the patient goes on being listed as still
 * present in the room they left, while also appearing in the room they moved to. Fetch across
 * queues - exactly as the "All" option already does - and apply the queue filter client-side,
 * after the dedup has settled which entry is the patient's current one.
 *
 * Location is likewise not sent as a search param: the REST endpoint's `location` filter matches
 * the location of the entry's *queue* (`q.location`), whereas this view - and the table's own
 * Location column - scope by the location of the patient's *visit*. Filtering server-side by
 * queue location counted a different population than the table displayed: a patient whose visit
 * is at location A but who was placed in a queue belonging to location B was counted at B while
 * being listed at A. So fetch across locations and filter by visit location client-side, against
 * selectedQueueLocationUuid (which mirrors the session location unless the user picks another).
 */
export function useCurrentQueueEntries() {
  const { concepts } = useConfig<ConfigObject>();
  const {
    selectedServiceUuid,
    selectedQueueLocationUuid,
    selectedProgramUuid,
    selectedQueueUuid,
    selectedPriorityUuid,
    selectedQueueStatusUuid,
    queueTableSearchTerm,
  } = useServiceQueuesStore();

  // The table's search box searches over whatever columns are configured, so the counts have to
  // be narrowed against those same columns to stay in step with the rows on screen.
  const columns = useColumns(null, null, { silent: true });

  const searchCriteria = useMemo(
    () => ({
      service: selectedServiceUuid,
      status: [concepts.defaultTransitionStatus, concepts.defaultFinishedServiceStatus],
      // Bound the fetch to today server-side. Without it the endpoint returns the site's entire
      // queue-entry history, oldest-first, which the dedup below then discards down to today -
      // so the table's load time grew with every entry the site had ever recorded, and today's
      // rows (the only ones kept) always landed on the *last* page of a sequential page-by-page
      // fetch that renders nothing until it finishes. Start-of-day is a safe bound for the
      // isQueueEntryFromToday filter below rather than a second, competing one: an entry cannot
      // start before the visit it belongs to, so every entry that filter would have kept starts
      // at or after today's midnight. If the tab is left open past midnight this memo keeps
      // yesterday's bound until something else invalidates it, which only ever widens the
      // window by a day - the client-side filter stays the authority on what is shown.
      startedOnOrAfter: dayjs().startOf('day').toISOString(),
    }),
    [selectedServiceUuid, concepts.defaultTransitionStatus, concepts.defaultFinishedServiceStatus],
  );

  const { queueEntries, isLoading, error, isValidating } = useQueueEntries(searchCriteria);

  // Program enrollment isn't part of the queue-entry representation, so it can't be filtered
  // server-side -- only fetched (and filtered) once we know which patients are in the queue.
  const patientUuidsNeedingProgramCheck = useMemo(
    () => (selectedProgramUuid ? (queueEntries ?? []).map((entry) => entry.patient?.uuid).filter(Boolean) : []),
    [queueEntries, selectedProgramUuid],
  );
  const { programsByPatientUuid } = useActiveProgramsForPatients(patientUuidsNeedingProgramCheck);

  const currentQueueEntries = useMemo(() => {
    // A patient can legitimately have more than one entry today (e.g. finishing one visit and
    // starting a new one later) - establish their single most current entry first, across every
    // fetched status, before applying any other filter. Otherwise a patient's older, superseded
    // "Finished Service" entry could still pass a caller's status filter even though they now
    // have a newer "In Service" entry.
    const todaysLatestEntryPerPatient = dedupeQueueEntriesByPatient((queueEntries ?? []).filter(isQueueEntryFromToday));

    return (
      todaysLatestEntryPerPatient
        .filter((queueEntry) => !selectedQueueUuid || queueEntry.queue?.uuid === selectedQueueUuid)
        .filter(
          (queueEntry) => !selectedQueueLocationUuid || queueEntry.visit?.location?.uuid === selectedQueueLocationUuid,
        )
        .filter((queueEntry) => !selectedPriorityUuid || queueEntry.priority?.uuid === selectedPriorityUuid)
        // Only an explicit pick of a *single* status narrows the population. The table falls back
        // to "In Service" when nothing is picked, but applying that fallback here would leave the
        // Finished Service and Average visit duration cards reading 0 and "--" on every fresh
        // load - the two cards exist precisely to report the status the table isn't showing. An
        // explicit "All" is likewise no narrowing at all: the fetch above is already bounded to
        // the statuses this view knows about.
        .filter(
          (queueEntry) =>
            !selectedQueueStatusUuid ||
            selectedQueueStatusUuid === ALL_QUEUE_STATUSES_UUID ||
            queueEntry.status?.uuid === selectedQueueStatusUuid,
        )
        .filter((queueEntry) => {
          const searchTermLowercase = queueTableSearchTerm?.trim().toLowerCase();
          if (!searchTermLowercase) {
            return true;
          }
          return (
            columns?.some((column) =>
              column?.getFilterableValue?.(queueEntry)?.toLocaleLowerCase().includes(searchTermLowercase),
            ) ?? false
          );
        })
        .filter((queueEntry) => {
          if (!selectedProgramUuid) {
            return true;
          }
          const patientPrograms = programsByPatientUuid[queueEntry.patient?.uuid] ?? [];
          return patientPrograms.some((enrollment) => enrollment.program?.uuid === selectedProgramUuid);
        })
    );
  }, [
    queueEntries,
    selectedQueueUuid,
    selectedQueueLocationUuid,
    selectedPriorityUuid,
    selectedProgramUuid,
    programsByPatientUuid,
    selectedQueueStatusUuid,
    queueTableSearchTerm,
    columns,
  ]);

  return { currentQueueEntries, isLoading, error, isValidating };
}
