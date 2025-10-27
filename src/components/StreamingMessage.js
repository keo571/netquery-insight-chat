import React, { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import ReactMarkdown from 'react-markdown';
import PaginatedTable from './PaginatedTable';
import DataVisualization from './DataVisualization';
import './Message.css';

// Wrapper component that only renders the container if chart is actually rendered
const ConditionalVisualization = ({ visualization, data }) => {
  const chartRef = useRef(null);
  const [shouldRender, setShouldRender] = useState(true);

  // Check if DataVisualization would return null
  useEffect(() => {
    if (!visualization || !data || data.length === 0 || visualization.type === 'none') {
      setShouldRender(false);
    }
  }, [visualization, data]);

  if (!shouldRender) {
    return null;
  }

  return (
    <div className="visualization fade-in" ref={chartRef}>
      <DataVisualization
        visualization={visualization}
        data={data}
      />
    </div>
  );
};

const StreamingMessage = React.memo(({
  message,
  isUser,
  agentName,
  onImageClick,
  streamingSpeed = 30  // milliseconds per character
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  useEffect(() => {
    if (!isUser && message.content) {
      setIsStreaming(true);
      let currentIndex = 0;

      const streamInterval = setInterval(() => {
        if (currentIndex < message.content.length) {
          // Add characters in chunks for smoother display
          const chunkSize = Math.min(3, message.content.length - currentIndex);
          setDisplayedContent(message.content.slice(0, currentIndex + chunkSize));
          currentIndex += chunkSize;
        } else {
          clearInterval(streamInterval);
          setIsStreaming(false);
        }
      }, streamingSpeed);

      return () => clearInterval(streamInterval);
    } else if (isUser) {
      setDisplayedContent(message.content);
    }
  }, [message.content, isUser, streamingSpeed]);

  const handleSkipStreaming = () => {
    setDisplayedContent(message.content);
    setIsStreaming(false);
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
              {isStreaming && (
                <span className="cursor-blink">▊</span>
              )}
            </div>

            {isStreaming && (
              <button
                className="skip-streaming-btn"
                onClick={handleSkipStreaming}
              >
                Skip animation
              </button>
            )}

            {!isStreaming && message.visualization_path && (
              <div className="visualization fade-in">
                <img
                  src={message.visualization_path}
                  alt="Network Diagram"
                  className="diagram-image"
                  onClick={() => onImageClick(message.visualization_path)}
                />
              </div>
            )}

            {/* Data section - show immediately when available or loading state */}
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

            {/* Explanation section - show SQL immediately, then analysis when ready */}
            {message.explanation && (
              <div className={`explanation fade-in ${!displayedContent && !message.visualization_path ? 'no-border' : ''}`}>
                <ReactMarkdown>{message.explanation}</ReactMarkdown>
                {message.isLoading && message.loadingStates?.data && !message.loadingStates?.analysis && (
                  <div className="loading-inline">
                    <div className="loading-spinner-small"></div>
                    <span>Analyzing results...</span>
                  </div>
                )}
              </div>
            )}

            {/* Visualization section - show loading state until ready */}
            {message.isLoading && message.loadingStates?.data && !message.loadingStates?.visualization ? (
              <div className="loading-section fade-in">
                <div className="loading-spinner"></div>
                <span>Generating visualization...</span>
              </div>
            ) : message.visualization && (
              <ConditionalVisualization
                visualization={message.visualization}
                data={message.results}
              />
            )}

            {!isStreaming && (message.suggestedQueries?.length > 0 || message.schemaOverview) && (
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
    explanation: PropTypes.string,
    visualization_path: PropTypes.string,
    results: PropTypes.any,
    isError: PropTypes.bool,
    suggestedQueries: PropTypes.arrayOf(PropTypes.string),
    schemaOverview: PropTypes.object
  }).isRequired,
  isUser: PropTypes.bool.isRequired,
  agentName: PropTypes.string.isRequired,
  onImageClick: PropTypes.func.isRequired,
  streamingSpeed: PropTypes.number
};

export default StreamingMessage;
