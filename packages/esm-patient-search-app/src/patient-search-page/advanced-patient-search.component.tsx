import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useConfig, type OpenmrsResource } from '@openmrs/esm-framework';
import { type PatientSearchConfig } from '../config-schema';
import { useInfinitePatientSearch } from '../patient-search.resource';
import { type AdvancedPatientSearchState } from '../types';
import PatientSearchComponent from './patient-search-lg.component';
import RefineSearch, { initialFilters } from './refine-search/refine-search.component';
import styles from './advanced-patient-search.scss';

interface AdvancedPatientSearchProps {
  query: string;
  inTabletOrOverlay?: boolean;
  stickyPagination?: boolean;
}

/** Patients requested from the server per page. The results list shows 15-20 of them at a time. */
const serverPageSize = 50;

const AdvancedPatientSearchComponent: React.FC<AdvancedPatientSearchProps> = ({
  query,
  stickyPagination,
  inTabletOrOverlay,
}) => {
  const { includeDead } = useConfig<PatientSearchConfig>();
  const [filters, setFilters] = useState<AdvancedPatientSearchState>(initialFilters);
  const filtersApplied = useMemo(() => {
    let count = 0;
    Object.entries(filters).forEach(([key, value]) => {
      if (key !== 'attributes' && value !== initialFilters[key]) {
        count++;
      }
    });

    const attributesWithValues = Object.entries(filters.attributes || {}).filter(([key, value]) => value !== '');

    count += attributesWithValues.length;
    return count;
  }, [filters]);

  const filtersKey = useMemo(() => JSON.stringify(filters), [filters]);

  const {
    data: searchResults,
    currentPage: loadedPages,
    setPage: setLoadedPages,
    hasMore,
    isLoading,
    isValidating,
    fetchError,
    totalResults,
  } = useInfinitePatientSearch(query, includeDead, !!query, serverPageSize);

  // The refine-search filters run in the browser (the REST patient search only takes `q`), so
  // they need every match. Only while a filter is applied, keep loading pages until all are in.
  // Without a filter, pages are loaded on demand as the user pages through the results (see
  // `loadResultsUpTo`), so a broad search costs one request instead of one per 50 matches.
  useEffect(() => {
    if (filtersApplied && hasMore && searchResults?.length === loadedPages * serverPageSize) {
      setLoadedPages((page) => page + 1);
    }
  }, [filtersApplied, searchResults, loadedPages, hasMore, setLoadedPages]);

  const loadResultsUpTo = useCallback(
    (count: number) => {
      const pagesNeeded = Math.ceil(count / serverPageSize);
      if (pagesNeeded > loadedPages) {
        setLoadedPages(pagesNeeded);
      }
    },
    [loadedPages, setLoadedPages],
  );

  const filteredResults = useMemo(() => {
    if (searchResults && filtersApplied) {
      return searchResults.filter((patient) => {
        // Gender filter
        if (filters.gender !== 'any') {
          const genderMap = {
            male: 'M',
            female: 'F',
            other: 'O',
            unknown: 'U',
          };
          if (patient.person.gender !== genderMap[filters.gender]) {
            return false;
          }
        }

        // Date of birth filters
        if (filters.dateOfBirth) {
          const dayOfBirth = new Date(patient.person.birthdate).getDate();
          if (dayOfBirth !== filters.dateOfBirth) {
            return false;
          }
        }

        if (filters.monthOfBirth) {
          const monthOfBirth = new Date(patient.person.birthdate).getMonth() + 1;
          if (monthOfBirth !== filters.monthOfBirth) {
            return false;
          }
        }

        if (filters.yearOfBirth) {
          const yearOfBirth = new Date(patient.person.birthdate).getFullYear();
          if (yearOfBirth !== filters.yearOfBirth) {
            return false;
          }
        }

        // Postcode filter
        if (filters.postcode) {
          if (!patient.person.addresses.some((address) => address.postalCode === filters.postcode)) {
            return false;
          }
        }

        // Age filter
        if (filters.age) {
          if (Number(patient.person.age) !== Number(filters.age)) {
            return false;
          }
        }

        // Person attributes filter
        if (Object.keys(filters.attributes).length) {
          for (const [attributeUuid, value] of Object.entries(filters.attributes)) {
            if (value === '') continue;

            const matchingAttribute = patient.attributes.find((attr) => attr.attributeType.uuid === attributeUuid);

            if (!matchingAttribute) return false;

            const isValueObj = typeof matchingAttribute.value === 'object';
            const patientAttributeValue = isValueObj
              ? (matchingAttribute.value as OpenmrsResource).uuid
              : matchingAttribute.value;
            if ((patientAttributeValue as string).toLowerCase() !== value.toLowerCase()) {
              return false;
            }
          }
        }

        return true;
      });
    }

    return searchResults;
  }, [filtersApplied, filters, searchResults]);

  // Without a filter, the server's total drives the pagination and pages are fetched as the user
  // reaches them. With one, every page is being loaded, so the filtered list is the whole result set.
  const serverPaging = filtersApplied
    ? {}
    : { totalResults, hasMore, isLoadingMore: isValidating, onLoadMore: loadResultsUpTo };

  return (
    <div
      className={classNames({
        [styles.advancedPatientSearchTabletOrOverlay]: inTabletOrOverlay,
        [styles.advancedPatientSearchDesktop]: !inTabletOrOverlay,
      })}>
      {!inTabletOrOverlay && (
        <div className={styles.refineSearchDesktop}>
          <RefineSearch filtersApplied={filtersApplied} setFilters={setFilters} inTabletOrOverlay={inTabletOrOverlay} />
        </div>
      )}
      <div
        className={classNames({
          [styles.patientSearchResultsTabletOrOverlay]: inTabletOrOverlay,
          [styles.patientSearchResultsDesktop]: !inTabletOrOverlay,
        })}>
        <PatientSearchComponent
          query={query}
          stickyPagination={stickyPagination}
          inTabletOrOverlay={inTabletOrOverlay}
          isLoading={isLoading}
          fetchError={fetchError}
          searchResults={filteredResults ?? []}
          pageResetKey={filtersKey}
          {...serverPaging}
        />
      </div>
      {inTabletOrOverlay && (
        <RefineSearch filtersApplied={filtersApplied} setFilters={setFilters} inTabletOrOverlay={inTabletOrOverlay} />
      )}
    </div>
  );
};

export default AdvancedPatientSearchComponent;
