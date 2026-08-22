import { useMemo } from 'react';
import { fhirBaseUrl, getLocale, useFhirFetchAll, useSession } from '@openmrs/esm-framework';

/**
 * @param applyLocationRestriction Whether to narrow the result to the current user's
 *   admin-assigned allowed locations (read from the `locationUuid` user property, written by the
 *   locationbasedaccess module if installed). Defaults to `true` for operational call sites (the
 *   queue location switcher), where a restricted user should only see their own locations. Pass
 *   `false` from administrative screens that configure queues/queue rooms for the whole
 *   installation (`admin/queues/queue-form.workspace.tsx`,
 *   `admin/queue-rooms/queue-room-form.workspace.tsx`) - those are system-configuration tasks, not
 *   the "where am I working" operational context this restriction targets.
 */
export function useQueueLocations(applyLocationRestriction = true) {
  const apiUrl = `${fhirBaseUrl}/Location?_summary=data&_tag=queue location`;
  const { data, error, isLoading } = useFhirFetchAll<fhir.Location>(apiUrl);
  const { user } = useSession();

  const allowedLocationUuids = useMemo(() => {
    const raw = user?.userProperties?.locationUuid;
    if (!raw) {
      return undefined;
    }
    const uuids = raw
      .split(',')
      .map((uuid) => uuid.trim())
      .filter(Boolean);
    return uuids.length ? uuids : undefined;
  }, [user]);

  const queueLocations = useMemo(() => {
    const all = data?.map((response) => response).sort((a, b) => a.name.localeCompare(b.name, getLocale())) ?? [];
    return applyLocationRestriction && allowedLocationUuids
      ? all.filter((loc) => allowedLocationUuids.includes(loc.id))
      : all;
  }, [data, applyLocationRestriction, allowedLocationUuids]);

  return { queueLocations, isLoading, error };
}
