import { type Session, userHasAccess, type Visit } from '@openmrs/esm-framework';

/**
 * Lets a user end visits started at any location. Defined by the locationbasedaccess module, which enforces
 * the same rule on the server (locationbasedaccess.access.visitEnd). Mirrors useVisitEndPermission in
 * esm-patient-common-lib, which this app doesn't depend on.
 */
export const END_VISITS_AT_ANY_LOCATION_PRIVILEGE = 'End Visits At Any Location';

/**
 * A visit can only be ended from a session logged in at the visit's own location (exact match), unless the
 * user is a System Developer or holds END_VISITS_AT_ANY_LOCATION_PRIVILEGE. A visit with no location is not
 * restricted.
 */
export function canEndVisitFromSession(
  visit: Pick<Visit, 'location'> | null | undefined,
  session: Session | null | undefined,
): boolean {
  const visitLocationUuid = visit?.location?.uuid;
  if (!visitLocationUuid) {
    return true;
  }
  if (session?.user && userHasAccess(END_VISITS_AT_ANY_LOCATION_PRIVILEGE, session.user)) {
    return true;
  }
  return visitLocationUuid === session?.sessionLocation?.uuid;
}

export function visitLocationName(visit: Pick<Visit, 'location'> | null | undefined): string | null {
  return visit?.location?.display ?? visit?.location?.name ?? null;
}
