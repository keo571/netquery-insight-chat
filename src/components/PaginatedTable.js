import React, { useState, useCallback } from 'react';
import PropTypes from 'prop-types';
import './PaginatedTable.css';

const BACKEND_API_URL = process.env.REACT_APP_NETQUERY_API_URL || 'http://localhost:8000';

const PaginatedTable = ({ data, pageSize = 10, maxDisplay = 30, displayInfo, queryId }) => {
  const [displayedRows, setDisplayedRows] = useState(pageSize);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleLoadMore = useCallback(() => {
    setDisplayedRows(prev => Math.min(prev + pageSize, maxDisplay));
  }, [pageSize, maxDisplay]);

  // Server-side download for full dataset
  const downloadFullDataset = useCallback(async () => {
    if (!queryId) return;

    setIsDownloading(true);
    try {
      const response = await fetch(`${BACKEND_API_URL}/api/download/${queryId}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `query_results_${queryId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error('Download failed');
      }
    } catch (error) {
      console.error('Download error:', error);
    } finally {
      setIsDownloading(false);
    }
  }, [queryId]);

  // Local CSV download for cached data only
  const downloadCachedCSV = useCallback(() => {
    if (!data || !Array.isArray(data) || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row =>
        headers.map(h => JSON.stringify(row[h] ?? '')).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cached_results_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [data]);

  if (!data || !Array.isArray(data) || data.length === 0) {
    return <div className="json-table-empty">No data available</div>;
  }

  const headers = Object.keys(data[0]);
  const totalRows = data.length;
  const visibleData = data.slice(0, displayedRows);
  const hasMore = displayedRows < Math.min(totalRows, maxDisplay);
  const hasFullDataset = displayInfo?.total_in_dataset && displayInfo.total_in_dataset !== totalRows;

  return (
    <div className="paginated-table-container">
      <div className="table-header">
        <span className="row-info">
          Showing {visibleData.length} of {totalRows} rows
          {displayInfo?.total_in_dataset && (
            <span> (total in dataset: {displayInfo.total_in_dataset})</span>
          )}
        </span>

        {/* Download buttons */}
        <div className="download-buttons">
          {hasFullDataset && queryId ? (
            <button
              className="download-csv-btn"
              onClick={downloadFullDataset}
              disabled={isDownloading}
              title="Download complete dataset from server"
            >
              {isDownloading ? (
                <>⏳ Downloading...</>
              ) : (
                <>📥 Download Full Dataset ({displayInfo.total_in_dataset} rows)</>
              )}
            </button>
          ) : (
            <button
              className="download-csv-btn"
              onClick={downloadCachedCSV}
              title="Download cached data as CSV"
            >
              📥 Download CSV ({totalRows} rows)
            </button>
          )}
        </div>
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
                  <td key={cellIndex}>
                    {row[header] !== null && row[header] !== undefined
                      ? String(row[header])
                      : ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <button
          className="load-more-btn"
          onClick={handleLoadMore}
        >
          Load {Math.min(pageSize, maxDisplay - displayedRows)} more rows
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
