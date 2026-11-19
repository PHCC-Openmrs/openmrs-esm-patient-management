/**
 * @vitest-environment jsdom
 *
 * The form-submit flow under test does not fire its callback under happy-dom
 * (likely a DOM-event-dispatch divergence). Run this file under jsdom.
 */
import React from 'react';
import { vi, describe, it, expect, test, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getDefaultsFromConfigSchema, PatientPhoto, useConfig } from '@openmrs/esm-framework';
import { configSchema, type PatientSearchConfig } from '../config-schema';
import { type PatientSearchResponse } from '../types';
import { mockAdvancedSearchResults } from '__mocks__';
import { PatientSearchContext } from '../patient-search-context';
import { useInfinitePatientSearch } from '../patient-search.resource';
import { usePersonAttributeType } from './refine-search/person-attributes.resource';
import AdvancedPatientSearchComponent from './advanced-patient-search.component';

const mockUseConfig = vi.mocked(useConfig<PatientSearchConfig>);
const mockUseInfinitePatientSearch = vi.mocked(useInfinitePatientSearch);
const mockUsePersonAttributeType = vi.mocked(usePersonAttributeType);

vi.mock('../patient-search.resource', () => ({
  useInfinitePatientSearch: vi.fn(),
}));

vi.mock('./refine-search/person-attributes.resource', () => ({
  usePersonAttributeType: vi.fn(),
}));

vi.mock('react-router-dom', async () => ({
  ...((await vi.importActual('react-router-dom')) as object),
  useParams: vi.fn(() => ({
    page: 1,
  })),
  useLocation: vi.fn(),
  useSearchParams: vi.fn(() => [
    {
      get: vi.fn(() => 'Jos'),
    },
  ]),
}));

const mockPatientActionContextValue = {
  nonNavigationSelectPatientAction: vi.fn(),
  selectPatientAction: vi.fn(),
};

const mockSearchResults: PatientSearchResponse = {
  isValidating: false,
  totalResults: 2,
  data: mockAdvancedSearchResults as unknown as PatientSearchResponse['data'],
  currentPage: 1,
  setPage: vi.fn(),
  hasMore: false,
  isLoading: false,
  fetchError: null,
};

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <PatientSearchContext.Provider value={mockPatientActionContextValue}>{children}</PatientSearchContext.Provider>
);

describe('AdvancedPatientSearchComponent', () => {
  const user = userEvent.setup();

  beforeEach(() => {
    mockUseInfinitePatientSearch.mockReturnValue(mockSearchResults);
    mockUseConfig.mockReturnValue({
      ...getDefaultsFromConfigSchema(configSchema),
      search: {
        disableTabletSearchOnKeyUp: false,
        showRecentlySearchedPatients: false,
        searchFilterFields: {
          gender: {
            enabled: true,
          },
          dateOfBirth: {
            enabled: true,
          },
          age: {
            enabled: true,
            min: 0,
          },
          postcode: {
            enabled: true,
          },
          personAttributes: [
            {
              attributeTypeUuid: '14d4f066-15f5-102d-96e4-000c29c2a5d7',
            },
          ],
        },
      } as PatientSearchConfig['search'],
    });
    mockUsePersonAttributeType.mockReturnValue({
      isLoading: false,
      error: null,
      data: {
        format: 'java.lang.String',
        uuid: '14d4f066-15f5-102d-96e4-000c29c2a5d7',
        display: 'Telephone Number',
      },
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <Wrapper>
        <AdvancedPatientSearchComponent query="Jos" {...props} />
      </Wrapper>,
    );
  };

  it('renders without crashing', () => {
    renderComponent();
    expect(screen.getByText('Refine search')).toBeInTheDocument();
  });

  it('displays search results correctly', () => {
    renderComponent();
    expect(screen.getByText(/2 search result/)).toBeInTheDocument();
  });

  describe('Filtering', () => {
    it('filters by gender correctly', async () => {
      renderComponent();

      await user.click(screen.getByRole('tab', { name: /female/i }));
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(screen.getByText(/0 search result/)).toBeInTheDocument();
    });

    it('filters by age correctly', async () => {
      renderComponent();

      // Set age filter
      const ageInput = screen.getByRole('spinbutton', { name: /age/i });
      await user.type(ageInput, '30');
      await user.click(screen.getByRole('button', { name: /apply/i }));

      // TODO: Restore these tests once we improve the patient banner test stubs
      // expect one patient Joseph Davis
      // const patientBanners = screen.getAllByRole('banner');
      // expect(patientBanners).toHaveLength(1);
      // expect(within(patientBanners[0]).getByText(/Joseph Davis/i)).toBeInTheDocument();
      // expect(within(patientBanners[0]).getByText(/30/)).toBeInTheDocument();
    });

    it('filters by postcode correctly', async () => {
      renderComponent();

      // Set postcode filter
      const postcodeInput = screen.getByRole('textbox', { name: /postcode/i });
      await user.type(postcodeInput, '46548');
      await user.click(screen.getByRole('button', { name: /apply/i }));

      // TODO: Restore these tests once we improve the patient banner test stubs
      // // expect one patient Joseph Davis
      // const patientBanners = screen.getAllByRole('banner');
      // expect(patientBanners).toHaveLength(1);
      // expect(within(patientBanners[0]).getByText(/Joseph Davis/i)).toBeInTheDocument();
    });

    it('filters by person attribute correctly', async () => {
      renderComponent();

      // Set phone number attribute filter
      const phoneInput = screen.getByLabelText(/phone number/i);
      await user.type(phoneInput, '0785434125');
      await user.click(screen.getByRole('button', { name: /apply/i }));

      // TODO: Restore these tests once we improve the patient banner test stubs
      // const patientBanners = screen.getAllByRole('banner');
      // expect(patientBanners).toHaveLength(1);

      // expect(within(patientBanners[0]).getByText(/Joshua Johnson/)).toBeInTheDocument();
    });

    it('combines multiple filters correctly', async () => {
      renderComponent();

      // Set multiple filters
      await user.click(screen.getByRole('tab', { name: /any/i }));
      const ageInput = screen.getByRole('spinbutton', { name: /age/i });
      await user.type(ageInput, '5');
      await user.click(screen.getByRole('button', { name: /apply/i }));

      // TODO: Restore these tests once we improve the patient banner test stubs
      // // expect one patient Joshua Johnson
      // const patientBanners = screen.getAllByRole('banner');
      // expect(patientBanners).toHaveLength(1);
      // expect(within(patientBanners[0]).getByText(/Joshua Johnson/)).toBeInTheDocument();
    });

    it('resets filters correctly', async () => {
      renderComponent();

      // Set a filter
      await user.click(screen.getByRole('tab', { name: /female/i }));
      await user.click(screen.getByRole('button', { name: /apply/i }));

      // Reset filters
      await user.click(screen.getByRole('button', { name: /reset fields/i }));

      // TODO: Restore these tests once we improve the patient banner test stubs
      // // expects all search results 2 patients
      // const patientBanners = screen.getAllByRole('banner');
      // expect(patientBanners).toHaveLength(2);
    });
  });

  describe('Paging', () => {
    // A broad search: the first server page (50 patients) of 2,001 matches is loaded.
    const firstServerPage = Array.from({ length: 50 }, (_, index) => ({
      ...mockAdvancedSearchResults[0],
      uuid: `patient-${index}`,
      person: {
        ...mockAdvancedSearchResults[0].person,
        gender: index % 2 ? 'F' : 'M',
        personName: { ...mockAdvancedSearchResults[0].person.personName, display: `Patient ${index}` },
      },
    })) as unknown as PatientSearchResponse['data'];

    const mockSetPage = vi.fn();

    beforeEach(() => {
      // Render each card as its patient's name, to tell which results are on screen
      vi.mocked(PatientPhoto).mockImplementation(({ patientName }) => <div>{patientName}</div>);
      mockSetPage.mockReset();
      mockUseInfinitePatientSearch.mockReturnValue({
        ...mockSearchResults,
        data: firstServerPage,
        totalResults: 2001,
        hasMore: true,
        currentPage: 1,
        setPage: mockSetPage,
      });
    });

    it('shows the server total and loads only the first page of results', () => {
      renderComponent();

      expect(screen.getByText(/2001 search result/)).toBeInTheDocument();
      expect(screen.getByText('Patient 0')).toBeInTheDocument();
      expect(screen.queryByText('Patient 20')).not.toBeInTheDocument();
      expect(mockSetPage).not.toHaveBeenCalled();
    });

    it('does not fetch the next server page until the user pages beyond the loaded results', async () => {
      renderComponent();

      // Results 21-40 are already loaded
      await user.click(screen.getByRole('button', { name: '2' }));
      expect(screen.getByText('Patient 20')).toBeInTheDocument();
      expect(mockSetPage).not.toHaveBeenCalled();

      // Results 41-60 need the second server page
      await user.click(screen.getByRole('button', { name: '3' }));
      expect(screen.getByText('Patient 40')).toBeInTheDocument();
      expect(mockSetPage).toHaveBeenCalledTimes(1);
      expect(mockSetPage).toHaveBeenCalledWith(2);
    });

    it('fetches every page only while a filter is applied', async () => {
      renderComponent();
      expect(mockSetPage).not.toHaveBeenCalled();

      await user.click(screen.getByRole('tab', { name: /female/i }));
      await user.click(screen.getByRole('button', { name: /apply/i }));

      expect(mockSetPage).toHaveBeenCalled();
      const loadNextPage = mockSetPage.mock.calls.at(-1)[0] as (page: number) => number;
      expect(loadNextPage(1)).toBe(2);
      // The filtered results are counted, not the server total
      expect(screen.getByText(/25 search result/)).toBeInTheDocument();
    });
  });

  describe('Layout', () => {
    it('renders in desktop layout by default', () => {
      renderComponent();
      const container = screen.getByText(/Refine search/i);
      expect(container).toBeInTheDocument();
    });

    it('renders in tablet layout when specified', () => {
      renderComponent({ inTabletOrOverlay: true });
      const container = screen.getByText(/Refine search/i);
      expect(container).toBeInTheDocument();
    });
  });
});
