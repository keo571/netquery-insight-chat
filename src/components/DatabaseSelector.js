import React, { useState, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './DatabaseSelector.css';

const DatabaseSelector = ({ selectedDatabase, databases, onDatabaseChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (database) => {
        onDatabaseChange(database);
        setIsOpen(false);
    };

    return (
        <div className="database-selector" ref={dropdownRef}>
            <button
                className="database-selector-button"
                onClick={() => setIsOpen(!isOpen)}
                aria-label="Select database"
            >
                <span className="database-icon">🗄️</span>
                <span className="database-name">{selectedDatabase}</span>
                <span className={`dropdown-arrow ${isOpen ? 'open' : ''}`}>▼</span>
            </button>

            {isOpen && (
                <div className="database-dropdown">
                    {databases.map((db) => (
                        <button
                            key={db}
                            className={`database-option ${db === selectedDatabase ? 'selected' : ''}`}
                            onClick={() => handleSelect(db)}
                        >
                            <span className="database-icon">🗄️</span>
                            <span>{db}</span>
                            {db === selectedDatabase && <span className="check-icon">✓</span>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

DatabaseSelector.propTypes = {
    selectedDatabase: PropTypes.string.isRequired,
    databases: PropTypes.arrayOf(PropTypes.string).isRequired,
    onDatabaseChange: PropTypes.func.isRequired,
};

export default DatabaseSelector;
