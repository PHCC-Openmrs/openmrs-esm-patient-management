import { AppointmentStatus } from '../types';
import { vi, describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { buildAppointmentsUrl, canTransition, toAppointmentsApiDate } from './functions';

describe('canTransition', () => {
  // Forward transitions (should be allowed)
  it.each([
    [AppointmentStatus.SCHEDULED, AppointmentStatus.CHECKEDIN],
    [AppointmentStatus.SCHEDULED, AppointmentStatus.COMPLETED],
    [AppointmentStatus.SCHEDULED, AppointmentStatus.CANCELLED],
    [AppointmentStatus.SCHEDULED, AppointmentStatus.MISSED],
    [AppointmentStatus.CHECKEDIN, AppointmentStatus.COMPLETED],
    [AppointmentStatus.CHECKEDIN, AppointmentStatus.CANCELLED],
    [AppointmentStatus.CHECKEDIN, AppointmentStatus.MISSED],
  ])('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // Backward to Scheduled (should be allowed)
  it.each([
    [AppointmentStatus.CHECKEDIN, AppointmentStatus.SCHEDULED],
    [AppointmentStatus.COMPLETED, AppointmentStatus.SCHEDULED],
    [AppointmentStatus.CANCELLED, AppointmentStatus.SCHEDULED],
    [AppointmentStatus.MISSED, AppointmentStatus.SCHEDULED],
  ])('allows %s -> Scheduled', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  // Terminal to terminal (should be blocked)
  it.each([
    [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED],
    [AppointmentStatus.COMPLETED, AppointmentStatus.MISSED],
    [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED],
    [AppointmentStatus.CANCELLED, AppointmentStatus.MISSED],
    [AppointmentStatus.MISSED, AppointmentStatus.COMPLETED],
    [AppointmentStatus.MISSED, AppointmentStatus.CANCELLED],
  ])('blocks %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  // Backward non-Scheduled transitions (should be blocked)
  it.each([
    [AppointmentStatus.CHECKEDIN, AppointmentStatus.CHECKEDIN],
    [AppointmentStatus.COMPLETED, AppointmentStatus.CHECKEDIN],
    [AppointmentStatus.CANCELLED, AppointmentStatus.CHECKEDIN],
    [AppointmentStatus.MISSED, AppointmentStatus.CHECKEDIN],
  ])('blocks %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  // Same status (except Scheduled -> Scheduled which is allowed by the rule)
  it('allows Scheduled -> Scheduled', () => {
    expect(canTransition(AppointmentStatus.SCHEDULED, AppointmentStatus.SCHEDULED)).toBe(true);
  });
});

describe('appointments API dates', () => {
  // The appointments module reads these params as UTC wall-clock time and ignores any offset.
  it('sends the UTC instant with no local offset', () => {
    expect(toAppointmentsApiDate(new Date(Date.UTC(2026, 10, 23, 22, 0, 0)))).toBe('2026-11-23T22:00:00.000Z');
  });

  it('asks for the selected day starting at local midnight, as a UTC instant', () => {
    const url = buildAppointmentsUrl('2026-11-24');
    const forDate = decodeURIComponent(url.split('forDate=')[1]);
    expect(forDate).toBe(dayjs('2026-11-24').startOf('day').toISOString());
    expect(forDate).not.toMatch(/[+-]\d{4}$/);
  });
});
