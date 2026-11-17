import { renderHook } from '@testing-library/react';
import useSWR from 'swr';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivePatientPrograms, useActiveProgramsForPatients } from './usePatientPrograms';

vi.mock('swr', () => ({
  default: vi.fn().mockReturnValue({ data: undefined, isLoading: false }),
}));

const mockUseSWR = vi.mocked(useSWR);

const noPolling = expect.objectContaining({
  refreshInterval: 0,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
});

describe('program enrollment lookups', () => {
  beforeEach(() => {
    mockUseSWR.mockClear();
  });

  it("does not poll a queue row's enrollments", () => {
    renderHook(() => useActivePatientPrograms('patient-uuid'));

    expect(mockUseSWR).toHaveBeenCalledWith(
      expect.stringContaining('/programenrollment?patient=patient-uuid'),
      expect.any(Function),
      noPolling,
    );
  });

  it("does not poll the Service type filter's enrollments for every queued patient", () => {
    renderHook(() => useActiveProgramsForPatients(['patient-a', 'patient-b']));

    expect(mockUseSWR).toHaveBeenCalledWith(
      ['queue-entry-active-programs', 'patient-a', 'patient-b'],
      expect.any(Function),
      noPolling,
    );
  });
});
