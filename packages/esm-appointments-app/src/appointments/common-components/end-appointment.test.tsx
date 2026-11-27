import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  updateVisit,
  showSnackbar,
  useSession,
  useVisit,
  type Session,
  type VisitReturnType,
  type FetchResponse,
  type Visit,
} from '@openmrs/esm-framework';
import { changeAppointmentStatus } from '../../patient-appointments/patient-appointments.resource';
import EndAppointmentModal from './end-appointment.modal';

const closeModal = vi.fn();
const mockUseVisit = vi.mocked(useVisit);
const mockUpdateVisit = vi.mocked(updateVisit);
const mockUseSession = vi.mocked(useSession);

function sessionAt(locationUuid: string) {
  return {
    authenticated: true,
    sessionId: 'session',
    user: { uuid: 'user', privileges: [], roles: [] },
    sessionLocation: { uuid: locationUuid, display: locationUuid },
  } as unknown as Session;
}

vi.mock('../../patient-appointments/patient-appointments.resource', () => ({
  changeAppointmentStatus: vi.fn().mockResolvedValue({}),
}));

vi.mock('../../hooks/useMutateAppointments', () => ({
  useMutateAppointments: vi.fn().mockReturnValue({ mutateAppointments: vi.fn() }),
}));

describe('EndAppointmentModal', () => {
  beforeEach(() => {
    mockUpdateVisit.mockResolvedValue({} as FetchResponse<Visit>);
  });

  it('has a cancel button that closes the modal', async () => {
    const user = userEvent.setup();

    render(<EndAppointmentModal appointmentUuid={'abc'} patientUuid={'123'} closeModal={closeModal} />);

    const cancelButton = screen.getByText('Cancel');
    await user.click(cancelButton);
    expect(closeModal).toHaveBeenCalled();
  });

  it('should update appointment status but not visit on submit if no active visit', async () => {
    const user = userEvent.setup();

    render(<EndAppointmentModal appointmentUuid={'abc'} patientUuid={'123'} closeModal={closeModal} />);

    const submitButton = screen.getByRole('button', { name: /check out/i });
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(changeAppointmentStatus).toHaveBeenCalledWith('Completed', 'abc');
    expect(useVisit).toHaveBeenCalledWith('123');
    expect(updateVisit).not.toHaveBeenCalled();
    expect(closeModal).toHaveBeenCalled();
    expect(showSnackbar).toHaveBeenCalledWith({
      title: 'Appointment ended',
      subtitle: 'Appointment successfully ended.',
      isLowContrast: true,
      kind: 'success',
    });
  });

  it('should update appointment status and visit on submit if active visit', async () => {
    const user = userEvent.setup();

    mockUseVisit.mockReturnValue({
      activeVisit: { location: { uuid: 'def' }, visitType: { uuid: 'ghi' }, startDatetime: new Date() },
      mutate: vi.fn(),
    } as unknown as VisitReturnType);
    mockUseSession.mockReturnValue(sessionAt('def'));

    render(<EndAppointmentModal appointmentUuid={'abc'} patientUuid={'123'} closeModal={closeModal} />);

    const submitButton = screen.getByRole('button', { name: /check out/i });
    expect(submitButton).toBeEnabled();
    await user.click(submitButton);
    expect(changeAppointmentStatus).toHaveBeenCalledWith('Completed', 'abc');
    expect(useVisit).toHaveBeenCalledWith('123');
    expect(updateVisit).toHaveBeenCalled();
    expect(closeModal).toHaveBeenCalled();
    expect(showSnackbar).toHaveBeenCalledWith({
      title: 'Appointment ended',
      subtitle: 'Appointment successfully ended and visit successfully closed',
      isLowContrast: true,
      kind: 'success',
    });
  });

  it('completes the appointment but leaves open a visit started at another location', async () => {
    const user = userEvent.setup();

    mockUseVisit.mockReturnValue({
      activeVisit: {
        location: { uuid: 'site-a', display: 'Site A' },
        visitType: { uuid: 'ghi' },
        startDatetime: new Date(),
      },
      mutate: vi.fn(),
    } as unknown as VisitReturnType);
    mockUseSession.mockReturnValue(sessionAt('site-b'));

    render(<EndAppointmentModal appointmentUuid={'abc'} patientUuid={'123'} closeModal={closeModal} />);

    expect(screen.getByText(/the visit was left open because it was started at site a/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /check out/i }));

    expect(changeAppointmentStatus).toHaveBeenCalledWith('Completed', 'abc');
    expect(updateVisit).not.toHaveBeenCalled();
    expect(showSnackbar).toHaveBeenCalledWith({
      title: 'Appointment ended',
      subtitle: 'The visit was left open because it was started at Site A. Log in at Site A to end it.',
      isLowContrast: true,
      kind: 'info',
    });
  });
});
