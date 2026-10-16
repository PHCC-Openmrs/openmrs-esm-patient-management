import { type Visit } from '@openmrs/esm-framework';
import { type PatientProgram } from '../types';

// The "Service" visit attribute type: the start-visit form stores the services (program UUIDs)
// chosen for a visit as one comma-separated value (a distro-provisioned attribute type).
export const SERVICE_VISIT_ATTRIBUTE_TYPE_UUID = '487b03fe-8034-4e95-ab67-bac9f2d7a27b';

// Enrollments the start-visit form opens carry the visit's start time; allow a little clock drift.
const ENROLLMENT_START_TOLERANCE_MS = 60 * 1000;

/** The program UUIDs chosen for the visit, without repeats, or null when it has no Service attribute. */
export function getVisitServiceProgramUuids(visit?: Visit | null): Array<string> | null {
  const attribute = visit?.attributes?.find(
    (visitAttribute) => visitAttribute.attributeType?.uuid === SERVICE_VISIT_ATTRIBUTE_TYPE_UUID,
  );
  const value = typeof attribute?.value === 'string' ? attribute.value : null;
  if (!value) {
    return null;
  }
  return [
    ...new Set(
      value
        .split(',')
        .map((uuid) => uuid.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * For a visit without a Service attribute (started before it existed, or by another app): the
 * active enrollments that began with the visit, one per program. Enrollments from earlier visits
 * are left out.
 */
export function getEnrollmentsSinceVisitStart(
  activeEnrollments: Array<PatientProgram>,
  visit?: Visit | null,
): Array<PatientProgram> {
  const visitStart = visit?.startDatetime ? new Date(visit.startDatetime).getTime() : null;
  const seenPrograms = new Set<string>();
  return activeEnrollments.filter((enrollment) => {
    const programUuid = enrollment.program?.uuid;
    if (!programUuid || seenPrograms.has(programUuid)) {
      return false;
    }
    if (
      visitStart != null &&
      new Date(enrollment.dateEnrolled).getTime() < visitStart - ENROLLMENT_START_TOLERANCE_MS
    ) {
      return false;
    }
    seenPrograms.add(programUuid);
    return true;
  });
}

/** Whether the program is one of the services of the visit. */
export function visitHasServiceProgram(
  visit: Visit | null | undefined,
  programUuid: string,
  activeEnrollments: Array<PatientProgram>,
): boolean {
  const serviceProgramUuids = getVisitServiceProgramUuids(visit);
  if (serviceProgramUuids) {
    return serviceProgramUuids.includes(programUuid);
  }
  return getEnrollmentsSinceVisitStart(activeEnrollments, visit).some(
    (enrollment) => enrollment.program?.uuid === programUuid,
  );
}
