import React from 'react';
import PropTypes from 'prop-types';
import SchemaVisualizer from './SchemaVisualizer';
import './SchemaModal.css';

const SchemaModal = ({ isOpen, onClose, schema }) => {
  if (!isOpen) return null;

  return (
    <div className="schema-modal-overlay fade-in" onClick={onClose}>
      <div className="schema-modal-content" onClick={e => e.stopPropagation()}>
        <div className="schema-modal-header">
          <h2>Schema Diagram</h2>
          <button className="close-modal-btn" onClick={onClose}>×</button>
        </div>
        <div className="schema-modal-body">
          <SchemaVisualizer key={schema?.schema_id} schema={schema} />
        </div>
      </div>
    </div>
  );
};

SchemaModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  schema: PropTypes.object
};

export default SchemaModal;
