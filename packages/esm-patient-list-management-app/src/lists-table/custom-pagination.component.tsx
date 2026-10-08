import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pagination } from '@carbon/react';
import { useLayoutType } from '@openmrs/esm-framework';
import { usePaginationInfo } from './use-pagination-info.component';
import styles from './custom-pagination.scss';

interface CustomPaginationProps {
  currentItems: number;
  totalItems: number;
  pageNumber: number;
  pageSize: number;
  onPageNumberChange?: ({ page }: { page: number }) => void;
}

export const CustomPagination: React.FC<CustomPaginationProps> = ({
  totalItems,
  pageSize,
  onPageNumberChange,
  pageNumber,
  currentItems,
}) => {
  const { itemsDisplayed, pageSizes } = usePaginationInfo(pageSize, totalItems, pageNumber, currentItems);
  const { t } = useTranslation();
  const isTablet = useLayoutType() === 'tablet';

  return (
    <>
      {totalItems > 0 && (
        <div className={isTablet ? styles.tablet : styles.desktop}>
          <div>{itemsDisplayed}</div>
          <Pagination
            className={styles.pagination}
            itemsPerPageText={t('itemsPerPage', 'Items per page:')}
            itemRangeText={(min, max, total) =>
              t('paginationItemRange', '{{min}}–{{max}} of {{total}} items', { min, max, total })
            }
            pageRangeText={(_current, total) =>
              t('paginationPageRange', 'of {{total}} pages', {
                count: total,
                total,
                defaultValue_one: 'of {{total}} page',
                defaultValue_other: 'of {{total}} pages',
              })
            }
            page={pageNumber}
            pageSize={pageSize}
            pageSizes={pageSizes}
            totalItems={totalItems}
            onChange={onPageNumberChange}
            size={isTablet ? 'lg' : 'sm'}
          />
        </div>
      )}
    </>
  );
};
