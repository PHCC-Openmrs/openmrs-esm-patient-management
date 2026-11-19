import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import type { SearchedPatient } from '../types';
import { EmptyState, ErrorState, LoadingState, PatientSearchResults } from './patient-search-views.component';
import { PatientBannerSkeleton } from './patient-banner/banner/patient-banner.component';
import Pagination from '../ui-components/pagination/pagination.component';
import styles from './patient-search-lg.scss';

interface PatientSearchComponentProps {
  query: string;
  inTabletOrOverlay?: boolean;
  stickyPagination?: boolean;
  /** The results loaded so far (all of them, unless `hasMore`). */
  searchResults: Array<SearchedPatient>;
  isLoading: boolean;
  fetchError: Error | null;
  /** The number of matches on the server, when only some of them are loaded in `searchResults`. */
  totalResults?: number;
  /** Whether the server has results beyond `searchResults`. */
  hasMore?: boolean;
  /** Whether further results are being fetched. */
  isLoadingMore?: boolean;
  /** Asks for at least the first `count` results to be loaded (called when a page needs them). */
  onLoadMore?: (count: number) => void;
  /** Return to the first page whenever this (or the query) changes, e.g. when the filters change. */
  pageResetKey?: string;
}

const PatientSearchComponent: React.FC<PatientSearchComponentProps> = ({
  query,
  stickyPagination,
  inTabletOrOverlay,
  searchResults,
  isLoading,
  fetchError,
  totalResults: serverTotal,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  pageResetKey = '',
}) => {
  const { t } = useTranslation();
  const resultsToShow = inTabletOrOverlay ? 15 : 20;
  // Once every result is loaded, the loaded list is the truth; until then, the server's count.
  const totalResults = hasMore ? Math.max(serverTotal ?? 0, searchResults.length) : searchResults.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / resultsToShow));

  // The page belongs to the query and filters it was chosen for, so a new search starts on page 1
  // in the same render (an effect would first render, and fetch, the old page of the new search).
  const resetKey = JSON.stringify([query, pageResetKey]);
  const [selectedPage, setSelectedPage] = useState({ resetKey, page: 1 });
  const currentPage = selectedPage.resetKey === resetKey ? Math.min(selectedPage.page, totalPages) : 1;

  const goTo = useCallback(
    (page: number) => setSelectedPage({ resetKey, page: Math.max(1, Math.min(totalPages, page)) }),
    [resetKey, totalPages],
  );

  const firstIndex = (currentPage - 1) * resultsToShow;
  const lastIndex = Math.min(firstIndex + resultsToShow, totalResults);
  const results = useMemo(() => searchResults.slice(firstIndex, lastIndex), [searchResults, firstIndex, lastIndex]);
  const missingResults = lastIndex - firstIndex - results.length;

  // Fetch the rest of this page only once the user has paged to it.
  useEffect(() => {
    if (missingResults > 0) {
      onLoadMore?.(lastIndex);
    }
  }, [missingResults, lastIndex, onLoadMore]);

  const searchResultsView = useMemo(() => {
    // Only show the full skeleton when there is nothing to show
    if ((isLoading || (isLoadingMore && missingResults > 0)) && !results?.length) {
      return <LoadingState />;
    }

    if (fetchError) {
      return <ErrorState />;
    }

    if (!isLoading && (!results || results.length === 0)) {
      return <EmptyState />;
    }

    return (
      <>
        <PatientSearchResults searchResults={results} />
        {isLoadingMore &&
          missingResults > 0 &&
          [...Array(Math.min(missingResults, 5)).keys()].map((index) => <PatientBannerSkeleton key={index} />)}
      </>
    );
  }, [fetchError, isLoading, isLoadingMore, missingResults, results]);

  return (
    <div
      className={classNames({
        [styles.searchResultsDesktop]: !inTabletOrOverlay,
        [styles.searchResultsTabletOrOverlay]: inTabletOrOverlay,
      })}>
      <div
        className={classNames({
          [styles.broadBottomMargin]: stickyPagination,
        })}>
        <h2
          className={classNames(styles.resultsHeader, styles.productiveHeading02, {
            [styles.leftPaddedResultHeader]: inTabletOrOverlay,
          })}>
          {isLoading
            ? t('searchingText', 'Searching...')
            : t('searchResultsCount', '{{count}} search result', {
                count: totalResults,
              })}
        </h2>
        {searchResultsView}
      </div>
      {totalResults > resultsToShow ? (
        <div
          className={classNames(styles.pagination, {
            [styles.stickyPagination]: stickyPagination,
          })}>
          <Pagination
            setCurrentPage={goTo}
            currentPage={currentPage}
            hasMore={currentPage < totalPages}
            totalPages={totalPages}
          />
        </div>
      ) : (
        <div className={styles.spacer} />
      )}
    </div>
  );
};

export default PatientSearchComponent;
