import React from 'react';
import PropTypes from 'prop-types';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import './DataVisualization.css';
import { debugLog } from '../utils/debug';

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658'];

const DataVisualization = ({ visualization, data }) => {
  if (!visualization || !data || data.length === 0) {
    return null;
  }

  const { type, title, config } = visualization;

  // Don't render anything if type is "none"
  if (type === 'none') {
    return null;
  }

  let { x_column, y_column } = config;

  // Use backend-processed data if available, otherwise fall back to original data
  let processedData = visualization.data || data;

  // Handle missing column configuration
  if (!x_column || !y_column) {
    return (
      <div className="chart-container">
        <h4 className="chart-title">{title}</h4>
        <div className="chart-error">
          Missing chart configuration (x_column or y_column)
        </div>
      </div>
    );
  }

  // Validate that chart type is appropriate for the data
  const isAggregateChart = ['bar', 'pie', 'line'].includes(type);
  if (isAggregateChart) {
    // Check if data looks aggregated (has numeric aggregates or grouped data)
    const firstRow = processedData[0];
    const hasNumericAggregate = Object.keys(firstRow).some(key => {
      const value = firstRow[key];
      const lowerKey = key.toLowerCase();
      // Check if column name suggests aggregation AND value is numeric
      return typeof value === 'number' && (
        lowerKey.includes('count') ||
        lowerKey.includes('total') ||
        lowerKey.includes('sum') ||
        lowerKey.includes('avg') ||
        lowerKey.includes('average') ||
        lowerKey.includes('max') ||
        lowerKey.includes('min') ||
        lowerKey === 'value' ||
        lowerKey === 'amount'
      );
    });

    // Check if data looks like entity relationships (e.g., VIP → Pool Name)
    // Relationship data has multiple string columns and no aggregates
    const stringColumnCount = Object.keys(firstRow).filter(key =>
      typeof firstRow[key] === 'string'
    ).length;
    const isRelationshipData = stringColumnCount >= 2 && !hasNumericAggregate;

    // Check for duplicate categories (sign of grouped/aggregated data)
    const xValues = processedData.map(row => row[x_column]);
    const hasDuplicates = new Set(xValues).size < xValues.length;

    // Suppress chart if:
    // 1. Data appears to be individual records (no aggregates, no duplicates, many rows)
    // 2. Data appears to be entity relationships (multiple string columns, no aggregates)
    if (isRelationshipData) {
      debugLog('Suppressing chart - data appears to be entity relationships, not suitable for aggregate charts');
      return null;
    }

    if (!hasNumericAggregate && !hasDuplicates && processedData.length > 5) {
      debugLog('Suppressing chart - data appears to be individual records, not aggregated');
      return null;
    }
  }

  // Use the chart type specified by the backend
  // The backend has more context and should decide the appropriate visualization
  const chartType = type;

  debugLog('Rendering chart:', {
    type: chartType,
    numCategories: processedData.length,
    dataColumns: Object.keys(processedData[0])
  });

  // Validate that columns exist in processed data
  const firstRow = processedData[0];
  const availableColumns = Object.keys(firstRow);

  // Try to intelligently map columns if they don't exist
  if (!firstRow.hasOwnProperty(x_column) || !firstRow.hasOwnProperty(y_column)) {
    // Try to find suitable column mappings
    const findSuitableColumn = (suggestedName, availableCols, isXColumn = false) => {
      // Direct match
      if (availableCols.includes(suggestedName)) return suggestedName;

      // Case-insensitive match
      const lowerSuggested = suggestedName.toLowerCase();
      const caseInsensitiveMatch = availableCols.find(col => col.toLowerCase() === lowerSuggested);
      if (caseInsensitiveMatch) return caseInsensitiveMatch;

      // Partial match (contains)
      const partialMatch = availableCols.find(col =>
        col.toLowerCase().includes(lowerSuggested) || lowerSuggested.includes(col.toLowerCase())
      );
      if (partialMatch) return partialMatch;

      // Common generic aliases only (no domain-specific terms)
      const aliases = {
        'name': ['label', 'title', 'category', 'group'],
        'count': ['total', 'value', 'amount', 'num', 'number'],
        'value': ['count', 'total', 'amount', 'num'],
        'category': ['name', 'label', 'group', 'type']
      };

      const possibleAliases = aliases[lowerSuggested] || [];
      for (const alias of possibleAliases) {
        const match = availableCols.find(col => col.toLowerCase() === alias);
        if (match) return match;
      }

      // Smart type-based inference as last resort
      // For x-column (categorical): find the first string column
      if (isXColumn && (lowerSuggested === 'name' || lowerSuggested === 'category')) {
        const categoricalCol = availableCols.find(col => {
          const value = processedData[0][col];
          // Exclude 'items' as it's likely an array/detail column
          return typeof value === 'string' && col !== 'items';
        });
        if (categoricalCol) return categoricalCol;
      }

      // For y-column (numeric): find the first numeric column
      if (!isXColumn && (lowerSuggested === 'count' || lowerSuggested === 'value')) {
        const numericCol = availableCols.find(col => {
          const value = processedData[0][col];
          return typeof value === 'number';
        });
        if (numericCol) return numericCol;
      }

      return null;
    };

    const mappedX = findSuitableColumn(x_column, availableColumns, true);
    const mappedY = findSuitableColumn(y_column, availableColumns, false);

    if (mappedX && mappedY) {
      // Use mapped columns
      x_column = mappedX;
      y_column = mappedY;
    } else {
      // If we still can't find suitable columns, show error
      return (
        <div className="chart-container">
          <h4 className="chart-title">{title}</h4>
          <div className="chart-error">
            Chart columns not found in data: {x_column}, {y_column}<br/>
            Available columns: {availableColumns.join(', ')}
          </div>
        </div>
      );
    }
  }

  const renderChart = () => {
    switch (chartType) {
      case 'bar':
        // Enhanced tooltip for grouped data
        const renderBarTooltip = (props) => {
          if (props.active && props.payload && props.payload.length) {
            const data = props.payload[0].payload;
            const value = props.payload[0].value;
            const label = props.label;

            // Check if this is grouped data with original items
            if (data.originalItems && Array.isArray(data.originalItems)) {
              const maxItems = 5;
              return (
                <div className="custom-tooltip">
                  <p className="tooltip-label">{`${label}: ${value}`}</p>
                  <div className="tooltip-names">
                    <strong>Items:</strong>
                    <ul style={{ margin: '4px 0', paddingLeft: '16px', fontSize: '12px' }}>
                      {data.originalItems.slice(0, maxItems).map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                      {data.originalItems.length > maxItems && (
                        <li style={{ fontStyle: 'italic' }}>
                          ...and {data.originalItems.length - maxItems} more
                        </li>
                      )}
                    </ul>
                  </div>
                </div>
              );
            }

            // Default tooltip
            return (
              <div className="custom-tooltip">
                <p className="tooltip-label">{`${label}: ${value}`}</p>
              </div>
            );
          }
          return null;
        };

        return (
          <BarChart data={processedData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x_column} />
            <YAxis />
            <Tooltip content={renderBarTooltip} />
            <Legend />
            <Bar dataKey={y_column} fill="#8884d8" />
          </BarChart>
        );

      case 'line':
        return (
          <LineChart data={processedData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x_column} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey={y_column} stroke="#8884d8" strokeWidth={2} />
          </LineChart>
        );

      case 'pie':
        // Custom label function to show percentages
        const renderLabel = (entry) => {
          // Use pre-calculated percentage from backend if available
          const percentage = entry.percentage || 0;
          return `${entry[x_column]}: ${percentage}%`;
        };

        // Custom tooltip to show both value and percentage
        const renderTooltip = (props) => {
          if (props.active && props.payload && props.payload.length) {
            const data = props.payload[0];
            const pieData = data.payload;

            // Use pre-calculated percentage from backend if available
            const percentage = pieData.percentage || 0;

            return (
              <div className="custom-tooltip">
                <p className="tooltip-label">{`${data.name}: ${data.value}`}</p>
                <p className="tooltip-percentage">{`Percentage: ${percentage}%`}</p>
              </div>
            );
          }
          return null;
        };

        return (
          <PieChart>
            <Pie
              data={processedData}
              dataKey={y_column}
              nameKey={x_column}
              cx="50%"
              cy="50%"
              outerRadius={120}
              fill="#8884d8"
              label={renderLabel}
              labelLine={false}
            >
              {processedData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={renderTooltip} />
            <Legend />
          </PieChart>
        );

      case 'scatter':
        return (
          <ScatterChart data={processedData}>
            <CartesianGrid />
            <XAxis dataKey={x_column} />
            <YAxis dataKey={y_column} />
            <Tooltip cursor={{ strokeDasharray: '3 3' }} />
            <Legend />
            <Scatter dataKey={y_column} fill="#8884d8" />
          </ScatterChart>
        );

      case 'area':
        return (
          <LineChart data={processedData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={x_column} />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey={y_column}
              stroke="#8884d8"
              strokeWidth={2}
              fill="#8884d8"
              fillOpacity={0.3}
            />
          </LineChart>
        );

      default:
        return (
          <div className="chart-error">
            Unsupported chart type: {type}
          </div>
        );
    }
  };

  return (
    <div className="chart-container">
      <h4 className="chart-title">{title}</h4>
      <ResponsiveContainer width="100%" height={400}>
        {renderChart()}
      </ResponsiveContainer>
      {config.reason && (
        <p className="chart-reason">💡 {config.reason}</p>
      )}
    </div>
  );
};

DataVisualization.propTypes = {
  visualization: PropTypes.shape({
    type: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    config: PropTypes.shape({
      x_column: PropTypes.string.isRequired,
      y_column: PropTypes.string.isRequired,
      reason: PropTypes.string,
      grouping: PropTypes.shape({
        enabled: PropTypes.bool,
        original_column: PropTypes.string,
        group_by_column: PropTypes.string,
        aggregate_column: PropTypes.string
      })
    }).isRequired
  }).isRequired,
  data: PropTypes.arrayOf(PropTypes.object).isRequired
};

export default DataVisualization;
