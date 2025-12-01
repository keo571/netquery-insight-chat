import React, { useState } from 'react';
import PropTypes from 'prop-types';
import DatabaseSelector from './DatabaseSelector';
import './Sidebar.css';

const Sidebar = ({
  isOpen,
  onClose,
  schema,
  onAction,
  selectedDatabase,
  databases,
  onDatabaseChange
}) => {
  const [activeTab, setActiveTab] = useState('suggestions'); // 'suggestions' or 'schema'
  const [expandedTables, setExpandedTables] = useState({});

  const toggleTable = (tableName) => {
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !prev[tableName]
    }));
  };

  return (
    <>
      {/* Mobile Overlay */}
      <div
        className={`sidebar-overlay ${isOpen ? 'active' : ''}`}
        onClick={onClose}
      />

      <div className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <h2>Netquery Insights</h2>
          <button className="close-sidebar-btn" onClick={onClose}>
            ×
          </button>
        </div>

        {/* Database Selector */}
        <div className="sidebar-section">
          <div className="section-label">Database</div>
          <DatabaseSelector
            selectedDatabase={selectedDatabase}
            databases={databases}
            onDatabaseChange={onDatabaseChange}
          />
        </div>

        <div className="sidebar-tabs">
          <button
            className={`tab-btn ${activeTab === 'suggestions' ? 'active' : ''}`}
            onClick={() => setActiveTab('suggestions')}
          >
            Suggestions
          </button>
          <button
            className={`tab-btn ${activeTab === 'schema' ? 'active' : ''}`}
            onClick={() => setActiveTab('schema')}
          >
            Data Schema
          </button>
        </div>

        <div className="tab-content">
          {activeTab === 'suggestions' && (
            <div className="suggestions-list">
              {schema?.suggested_queries && schema.suggested_queries.length > 0 ? (
                schema.suggested_queries.map((query, index) => (
                  <button
                    key={index}
                    className="suggestion-item"
                    onClick={() => onAction({ type: 'SELECT_QUERY', query })}
                  >
                    <span className="suggestion-icon">✨</span>
                    <span className="suggestion-text">{query}</span>
                  </button>
                ))
              ) : (
                <div className="empty-state">No suggestions available for {selectedDatabase}</div>
              )}
            </div>
          )}

          {activeTab === 'schema' && (
            <div className="schema-list">
              {schema?.tables && schema.tables.length > 0 ? (
                schema.tables.map((table) => (
                  <div key={table.name} className="table-item">
                    <button
                      className="table-header"
                      onClick={() => toggleTable(table.name)}
                    >
                      <span className="table-icon">🗃️</span>
                      <span className="table-name">{table.name}</span>
                      <span className={`expand-icon ${expandedTables[table.name] ? 'expanded' : ''}`}>
                        ▼
                      </span>
                    </button>
                    {expandedTables[table.name] && table.columns && (
                      <div className="columns-list">
                        {table.columns.map((col, idx) => (
                          <div key={idx} className="column-item">
                            <span className="column-name">{col.name}</span>
                            <span className="column-type">{col.type}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="empty-state">No tables available for {selectedDatabase}</div>
              )}
            </div>
          )}
        </div>

        <div className="sidebar-footer">
          <button
            className="view-diagram-btn"
            onClick={() => onAction({ type: 'VIEW_SCHEMA_DIAGRAM' })}
          >
            <span className="diagram-icon">📊</span>
            View Schema Diagram
          </button>
        </div>
      </div>
    </>
  );
};

Sidebar.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  schema: PropTypes.object,
  onAction: PropTypes.func.isRequired,
  selectedDatabase: PropTypes.string.isRequired,
  databases: PropTypes.arrayOf(PropTypes.string).isRequired,
  onDatabaseChange: PropTypes.func.isRequired,
};

export default Sidebar;
