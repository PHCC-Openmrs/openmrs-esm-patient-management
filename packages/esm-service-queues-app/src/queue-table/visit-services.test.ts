import { type Visit } from '@openmrs/esm-framework';
import { describe, expect, it } from 'vitest';
import { type PatientProgram } from '../types';
import {
  SERVICE_VISIT_ATTRIBUTE_TYPE_UUID,
  getEnrollmentsSinceVisitStart,
  getVisitServiceProgramUuids,
  visitHasServiceProgram,
} from './visit-services';

const visitWith = (value?: string, startDatetime = '2026-10-16T05:30:25.000+0000') =>
  ({
    uuid: 'visit-uuid',
    startDatetime,
    attributes: value
      ? [{ uuid: 'a', value, attributeType: { uuid: SERVICE_VISIT_ATTRIBUTE_TYPE_UUID } }]
      : [{ uuid: 'b', value: 'FRO-001', attributeType: { uuid: 'some-other-type' } }],
  }) as unknown as Visit;

const enrollment = (programUuid: string, name: string, dateEnrolled: string) =>
  ({
    uuid: `${programUuid}-${dateEnrolled}`,
    program: { uuid: programUuid, name },
    dateEnrolled,
  }) as unknown as PatientProgram;

describe('visit services', () => {
  it('reads the services chosen for the visit once each', () => {
    expect(getVisitServiceProgramUuids(visitWith('p1, p2,p1,'))).toEqual(['p1', 'p2']);
    expect(getVisitServiceProgramUuids(visitWith())).toBeNull();
    expect(getVisitServiceProgramUuids(null)).toBeNull();
  });

  it('keeps only the enrollments that began with the visit, one per program', () => {
    const enrollments = [
      enrollment('nutrition', 'Nutrition', '2026-10-13T10:25:55.000+0000'),
      enrollment('nutrition', 'Nutrition', '2026-10-16T05:30:25.000+0000'),
      enrollment('nutrition', 'Nutrition', '2026-10-16T05:31:00.000+0000'),
      enrollment('srh', 'SRH', '2026-10-16T05:30:25.000+0000'),
      enrollment('peds', 'Pediatric', '2026-10-12T15:53:44.000+0000'),
    ];
    expect(getEnrollmentsSinceVisitStart(enrollments, visitWith()).map((e) => e.program.uuid)).toEqual([
      'nutrition',
      'srh',
    ]);
  });

  it("matches a program against the visit's own services, not the patient's other enrollments", () => {
    const enrollments = [enrollment('srh', 'SRH', '2026-10-13T14:10:52.000+0000')];
    expect(visitHasServiceProgram(visitWith('nutrition'), 'srh', enrollments)).toBe(false);
    expect(visitHasServiceProgram(visitWith('nutrition,srh'), 'srh', enrollments)).toBe(true);
    // no Service attribute: only enrollments since the visit started count
    expect(visitHasServiceProgram(visitWith(), 'srh', enrollments)).toBe(false);
  });
});
