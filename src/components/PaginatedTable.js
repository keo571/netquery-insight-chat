import React, { useState, useCallback, useMemo, useEffect } from 'react';
import PropTypes from 'prop-types';
import { debugLog } from '../utils/debug';
import './PaginatedTable.css';

const BACKEND_API_URL = process.env.REACT_APP_NETQUERY_API_URL || 'http://localhost:8000';

// Pagination constants - aligned with backend MAX_CACHE_ROWS (30)
const DEFAULT_PAGE_SIZE = 15;  // Initial rows to display
const MAX_CACHED_ROWS = 30;    // Maximum rows cached by backend

// Helper function to trigger browser download
const triggerBrowserDownload = (url, filename = '') => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

// Helper function to convert data to CSV format
const convertToCSV = (data) => {
  if (!data?.length) return '';

  const headers = Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(header => JSON.stringify(row[header] ?? '')).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
};

const PaginatedTable = ({ data, pageSize = DEFAULT_PAGE_SIZE, maxDisplay = MAX_CACHED_ROWS, displayInfo, queryId }) => {
  const [displayedRows, setDisplayedRows] = useState(pageSize);

  // Reset displayedRows when new data arrives
  useEffect(() => {
    setDisplayedRows(pageSize);
  }, [data, pageSize]);

  // Load more rows handler
  const handleLoadMore = useCallback(() => {
    setDisplayedRows(prev => Math.min(prev + pageSize, maxDisplay));
  }, [pageSize, maxDisplay]);

  // Download full dataset from server
  const downloadFullDataset = useCallback(() => {
    if (!queryId) return;

    debugLog(`Initiating download for query_id: ${queryId}`);
    const downloadUrl = `${BACKEND_API_URL}/api/download/${queryId}`;
    triggerBrowserDownload(downloadUrl);
    debugLog('Download initiated - browser will show progress');
  }, [queryId]);

  // Download cached data as CSV
  const downloadCachedCSV = useCallback(() => {
    if (!data?.length) return;

    const csvContent = convertToCSV(data);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);

    triggerBrowserDownload(url, `cached_results_${Date.now()}.csv`);
    URL.revokeObjectURL(url);
  }, [data]);

  // Compute derived values using useMemo for performance (before early return)
  const { headers, totalRows, visibleData, hasMore, hasFullDataset } = useMemo(() => {
    if (!data?.length) {
      return { headers: [], totalRows: 0, visibleData: [], hasMore: false, hasFullDataset: false };
    }

    const headers = Object.keys(data[0]);
    const totalRows = data.length;
    const visibleData = data.slice(0, displayedRows);
    const hasMore = displayedRows < Math.min(totalRows, maxDisplay);
    const hasFullDataset = displayInfo?.total_in_dataset && displayInfo.total_in_dataset !== totalRows;

    return { headers, totalRows, visibleData, hasMore, hasFullDataset };
  }, [data, displayedRows, maxDisplay, displayInfo]);

  // Early return if no data
  if (!data?.length) {
    return <div className="json-table-empty">No data available</div>;
  }

  // Render download button based on dataset availability
  const renderDownloadButton = () => {
    if (hasFullDataset && queryId) {
      return (
        <button
          className="download-csv-btn"
          onClick={downloadFullDataset}
          title="Download complete dataset from server (browser will show progress)"
        >
          📥 Download Full Dataset ({displayInfo.total_in_dataset} rows)
        </button>
      );
    }

    return (
      <button
        className="download-csv-btn"
        onClick={downloadCachedCSV}
        title="Download cached data as CSV"
      >
        📥 Download CSV ({totalRows} rows)
      </button>
    );
  };

  // Render table cell value
  const renderCellValue = (value) => {
    return value !== null && value !== undefined ? String(value) : '';
  };

  // Generate display message based on data state
  const getDisplayMessage = () => {
    const hasMoreInDataset = displayInfo?.total_in_dataset && displayInfo.total_in_dataset > totalRows;
    const showingAll = visibleData.length === totalRows;
    const isCached = totalRows === MAX_CACHED_ROWS;

    if (showingAll && isCached && hasMoreInDataset) {
      // Showing all cached rows, more exist in dataset
      return `Showing all ${MAX_CACHED_ROWS} cached rows (${displayInfo.total_in_dataset} total in dataset)`;
    }

    if (showingAll && !hasMoreInDataset) {
      // Showing complete dataset (< MAX_CACHED_ROWS rows, no caching)
      return `Showing all ${totalRows} rows`;
    }

    // Showing partial cached data (with Load More available)
    return (
      <>
        Showing {visibleData.length} of {totalRows} {isCached ? 'cached rows' : 'rows'}
        {hasMoreInDataset && <span> ({displayInfo.total_in_dataset} total in dataset)</span>}
      </>
    );
  };

  return (
    <div className="paginated-table-container">
      <div className="data-preview-header">Data Preview:</div>

      <div className="table-header">
        <span className="row-info">{getDisplayMessage()}</span>
        <div className="download-buttons">{renderDownloadButton()}</div>
      </div>

      <div className="json-table-wrapper">
        <table className="json-table">
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th key={index}>{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleData.map((row, rowIndex) => (
              <tr key={rowIndex} className="fade-in">
                {headers.map((header, cellIndex) => (
                  <td key={cellIndex}>{renderCellValue(row[header])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button className="load-more-btn" onClick={handleLoadMore}>
          Load More
        </button>
      )}
    </div>
  );
};

PaginatedTable.propTypes = {
  data: PropTypes.arrayOf(PropTypes.object),
  pageSize: PropTypes.number,
  maxDisplay: PropTypes.number,
  displayInfo: PropTypes.object,
  queryId: PropTypes.string
};

export default PaginatedTable;
