import React from 'react';
import PropTypes from 'prop-types';
import './WelcomeMessage.css';

const WelcomeMessage = ({ title, message, tables, suggestedQueries, loading, error }) => {
  return (
    <div className="welcome-message">
      <h3>{title}</h3>
      <p>{message}</p>

      {loading && <p className="welcome-loading">Loading dataset overview…</p>}
      {error && !loading && (
        <p className="welcome-error">{error}</p>
      )}

      {!loading && tables?.length > 0 && (
        <div className="welcome-section">
          <h4>What I can talk about</h4>
          <ul>
            {tables.slice(0, 4).map((table) => (
              <li key={table.name}>
                <strong>{table.name}</strong>
                {table.description && <span> — {table.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!loading && suggestedQueries?.length > 0 && (
        <div className="welcome-section">
          <h4>Suggested prompts</h4>
          <ul>
            {suggestedQueries.slice(0, 5).map((prompt, index) => (
              <li key={`${prompt}-${index}`}>{prompt}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

WelcomeMessage.propTypes = {
  title: PropTypes.string.isRequired,
  message: PropTypes.string.isRequired,
  tables: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      description: PropTypes.string
    })
  ),
  suggestedQueries: PropTypes.arrayOf(PropTypes.string),
  loading: PropTypes.bool,
  error: PropTypes.string
};

WelcomeMessage.defaultProps = {
  tables: [],
  suggestedQueries: [],
  loading: false,
  error: null
};

export default WelcomeMessage;
