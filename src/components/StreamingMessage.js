import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import PaginatedTable from './PaginatedTable';
import DataVisualization from './DataVisualization';
import './Message.css';

// Wrapper component that only renders the container if chart is actually rendered
const ConditionalVisualization = ({ visualization, data }) => {
  const chartRef = useRef(null);

  if (!visualization || visualization.type === 'none') {
    return null;
  }

  const processedData = visualization.data && visualization.data.length > 0 ? visualization.data : data;

  if (!processedData || processedData.length === 0) {
    return null;
  }

  // All validations passed - render the chart with container
  return (
    <div className="visualization fade-in" ref={chartRef}>
      <DataVisualization
        visualization={visualization}
        data={processedData}
      />
    </div>
  );
};

const StreamingMessage = React.memo(({
  message,
  isUser,
  agentName,
  onImageClick
}) => {
  const [displayedContent, setDisplayedContent] = useState('');

  useEffect(() => {
    // Show content immediately without animation
    setDisplayedContent(message.content);
  }, [message.content]);

  return (
    <div className={`message ${isUser ? 'user-message' : 'agent-message'}`}>
      <div className="message-header">
        <span className="message-sender">{isUser ? 'You' : agentName}</span>
        <span className="message-time">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="message-content">
        {isUser ? (
          <div className="user-query">{displayedContent}</div>
        ) : (
          <div className="agent-response">
            <div className="response-text">
              <ReactMarkdown>{displayedContent}</ReactMarkdown>
            </div>

            {message.visualization_path && (
              <div className="visualization fade-in">
                <img
                  src={message.visualization_path}
                  alt="Network Diagram"
                  className="diagram-image"
                  onClick={() => onImageClick(message.visualization_path)}
                />
              </div>
            )}

            {/* 1. SQL section - show immediately when available */}
            {message.sql_explanation && (
              <div className={`explanation fade-in ${!displayedContent && !message.visualization_path ? 'no-border' : ''}`}>
                <ReactMarkdown>{message.sql_explanation}</ReactMarkdown>
              </div>
            )}

            {/* 2. Data section - show loading or table */}
            {message.isLoading && !message.loadingStates?.data ? (
              <div className="loading-section fade-in">
                <div className="loading-spinner"></div>
                <span>Loading data...</span>
              </div>
            ) : message.results && (
              <div className="results-table fade-in">
                <PaginatedTable
                  data={message.results}
                  pageSize={message.display_info?.initial_display || 20}
                  maxDisplay={message.results.length}
                  displayInfo={message.display_info}
                  queryId={message.query_id}
                />
              </div>
            )}

            {/* 3. Analysis & Visualization section - show loading until interpretation completes */}
            {message.isLoading && message.loadingStates?.data && !message.loadingStates?.analysis && !message.loadingStates?.visualization ? (
              <div className="loading-section fade-in">
                <div className="loading-spinner"></div>
                <span>Analyzing results and generating visualization...</span>
              </div>
            ) : null}

            {/* Analysis appears when ready (independent of visualization) */}
            {message.analysis_explanation && (
              <div className="explanation fade-in">
                <ReactMarkdown>{message.analysis_explanation}</ReactMarkdown>
              </div>
            )}

            {/* Visualization appears when ready (independent of analysis) */}
            {message.visualization && (
              <ConditionalVisualization
                visualization={message.visualization}
                data={message.results}
              />
            )}

            {(message.suggestedQueries?.length > 0 || message.schemaOverview) && (
              <div className="guidance-panel fade-in">
                {message.schemaOverview?.tables?.length > 0 && (
                  <div className="guidance-section">
                    <h4>Key datasets I know</h4>
                    <ul>
                      {message.schemaOverview.tables.slice(0, 5).map((table) => (
                        <li key={table.name}>
                          <strong>{table.name}</strong>
                          {table.description && <span> — {table.description}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {message.suggestedQueries?.length > 0 && (
                  <div className="guidance-section">
                    <h4>Suggested prompts</h4>
                    <ul>
                      {message.suggestedQueries.slice(0, 5).map((suggestion, index) => (
                        <li key={`${suggestion}-${index}`}>{suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

StreamingMessage.displayName = 'StreamingMessage';

StreamingMessage.propTypes = {
  message: PropTypes.shape({
    id: PropTypes.number.isRequired,
    content: PropTypes.string.isRequired,
    timestamp: PropTypes.string.isRequired,
    sql_explanation: PropTypes.string,
    analysis_explanation: PropTypes.string,
    visualization_path: PropTypes.string,
    results: PropTypes.any,
    isError: PropTypes.bool,
    suggestedQueries: PropTypes.arrayOf(PropTypes.string),
    schemaOverview: PropTypes.object
  }).isRequired,
  isUser: PropTypes.bool.isRequired,
  agentName: PropTypes.string.isRequired,
  onImageClick: PropTypes.func.isRequired
};

export default StreamingMessage;
