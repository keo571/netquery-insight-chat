import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import './ChatInput.css';

const ChatInput = ({
  currentQuery,
  setCurrentQuery,
  loading,
  onSubmit,
  placeholder,
  autoFocus = false
}) => {
  const textareaRef = useRef(null);
  // Auto-focus when a suggestion is clicked
  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus, currentQuery]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const handleTextareaChange = (e) => {
    setCurrentQuery(e.target.value);
    
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = newHeight + 'px';
    
    // Add scrollable class only when content exceeds max height
    if (textarea.scrollHeight > 120) {
      textarea.classList.add('scrollable');
    } else {
      textarea.classList.remove('scrollable');
    }
  };

  return (
    <form onSubmit={onSubmit} className="chat-input">
      <div className="input-container">
        <textarea
          ref={textareaRef}
          value={currentQuery}
          onChange={handleTextareaChange}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          rows={1}
          disabled={loading}
          className="message-input"
        />
        <button
          type="submit"
          disabled={loading || !currentQuery.trim()}
          className="send-button"
        >
          {loading ? '...' : 'Send'}
        </button>
      </div>
    </form>
  );
};

ChatInput.propTypes = {
  currentQuery: PropTypes.string.isRequired,
  setCurrentQuery: PropTypes.func.isRequired,
  loading: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
  placeholder: PropTypes.string.isRequired,
  autoFocus: PropTypes.bool
};

export default ChatInput;