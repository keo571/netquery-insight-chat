import React, { useState, useEffect } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import PaginatedTable from './PaginatedTable';
import DataVisualization from './DataVisualization';
import { fetchInterpretation } from '../services/api';
import './Message.css';

// Helper component for visualization
const ConditionalVisualization = ({ visualization, data }) => {
  if (!visualization || visualization.type === 'none') {
    return null;
  }

  const processedData = visualization.data && visualization.data.length > 0 ? visualization.data : data;

  if (!processedData || processedData.length === 0) {
    return null;
  }

  return (
    <div className="visualization fade-in">
      <DataVisualization
        visualization={visualization}
        data={processedData}
      />
    </div>
  );
};

ConditionalVisualization.propTypes = {
  visualization: PropTypes.object,
  data: PropTypes.array
};

// Helper component for loading state
const LoadingSection = ({ message }) => (
  <div className="loading-section fade-in">
    <div className="loading-spinner"></div>
    <span>{message}</span>
  </div>
);

LoadingSection.propTypes = {
  message: PropTypes.string.isRequired
};

// Helper component for guidance panel
const GuidancePanel = ({ suggestedQueries, schemaOverview }) => {
  if (!suggestedQueries?.length && !schemaOverview?.tables?.length) {
    return null;
  }

  return (
    <div className="guidance-panel fade-in">
      {schemaOverview?.tables?.length > 0 && (
        <div className="guidance-section">
          <h4>Key datasets I know</h4>
          <ul>
            {schemaOverview.tables.slice(0, 5).map((table) => (
              <li key={table.name}>
                <strong>{table.name}</strong>
                {table.description && <span> — {table.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestedQueries?.length > 0 && (
        <div className="guidance-section">
          <h4>Suggested prompts</h4>
          <ul>
            {suggestedQueries.slice(0, 5).map((suggestion, index) => (
              <li key={`${suggestion}-${index}`}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

GuidancePanel.propTypes = {
  suggestedQueries: PropTypes.arrayOf(PropTypes.string),
  schemaOverview: PropTypes.object
};

const StreamingMessage = React.memo(({
  message,
  isUser,
  agentName,
  onImageClick,
  onUpdateAnalysis
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [analysisError, setAnalysisError] = useState(null);

  useEffect(() => {
    // Show content immediately without animation
    setDisplayedContent(message.content);
  }, [message.content]);

  const handleShowAnalysis = async () => {
    if (!message.query_id) return;

    setLoadingAnalysis(true);
    setAnalysisError(null);
    try {
      const data = await fetchInterpretation(message.query_id);
      onUpdateAnalysis(message.id, data);
    } catch (error) {
      console.error('Failed to fetch interpretation:', error);
      setAnalysisError(error.message || 'Failed to load analysis');
    } finally {
      setLoadingAnalysis(false);
    }
  };

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
              <LoadingSection message="Loading data..." />
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

            {/* Show Analysis button - only show if we have data and haven't loaded analysis yet */}
            {message.query_id && message.results && !message.analysis_explanation && !loadingAnalysis && (
              <div className="analysis-toggle-container fade-in">
                <button
                  className="toggle-analysis-btn"
                  onClick={handleShowAnalysis}
                  title="Show analysis and visualization"
                >
                  📊 Show Analysis
                </button>
              </div>
            )}

            {/* Show loading state when fetching analysis */}
            {loadingAnalysis && (
              <LoadingSection message="Loading analysis and visualization..." />
            )}

            {/* Show error if analysis fetch failed */}
            {analysisError && (
              <div className="explanation fade-in" style={{ color: '#d32f2f' }}>
                Failed to load analysis: {analysisError}
              </div>
            )}

            {/* Analysis appears when ready */}
            {message.analysis_explanation && (
              <div className="explanation fade-in">
                <ReactMarkdown>{message.analysis_explanation}</ReactMarkdown>
              </div>
            )}

            {/* Visualization appears when ready */}
            {message.visualization && (
              <ConditionalVisualization
                visualization={message.visualization}
                data={message.results}
              />
            )}

            <GuidancePanel
              suggestedQueries={message.suggestedQueries}
              schemaOverview={message.schemaOverview}
            />
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
  onImageClick: PropTypes.func.isRequired,
  onUpdateAnalysis: PropTypes.func.isRequired
};

export default StreamingMessage;
