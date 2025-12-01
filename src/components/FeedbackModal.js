import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './FeedbackModal.css';


const FeedbackModal = ({ onSubmit, onClose, isSubmitting }) => {
  const [description, setDescription] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);

  const FEEDBACK_TAGS = [
    'Inaccurate Data',
    'Slow Response',
    'Bad Formatting',
    'SQL Error',
    'Other'
  ];

  const handleTagClick = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSubmit = () => {
    onSubmit(description, selectedTags);
  };

  const handleKeyDown = (e) => {
    // Allow Escape to close
    if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleOverlayClick = (e) => {
    // Close if clicking the overlay (not the modal content)
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="feedback-modal-overlay"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
    >
      <div className="feedback-modal">
        <div className="feedback-modal-header">
          <h3>Feedback</h3>
          <button
            className="feedback-modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={isSubmitting}
          >
            ✕
          </button>
        </div>

        <div className="feedback-modal-body">
          <div className="feedback-tags">
            {FEEDBACK_TAGS.map(tag => (
              <button
                key={tag}
                className={`feedback-tag ${selectedTags.includes(tag) ? 'selected' : ''}`}
                onClick={() => handleTagClick(tag)}
                disabled={isSubmitting}
              >
                {tag}
              </button>
            ))}
          </div>

          <label htmlFor="feedback-description">
            Additional details <span className="optional">(optional)</span>
          </label>
          <textarea
            id="feedback-description"
            className="feedback-textarea"
            placeholder="Describe the issue..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isSubmitting}
            rows={4}
            autoFocus
          />
        </div>

        <div className="feedback-modal-footer">
          <button
            className="feedback-modal-btn cancel"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            className="feedback-modal-btn submit"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting...' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

FeedbackModal.propTypes = {
  onSubmit: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
  isSubmitting: PropTypes.bool.isRequired
};

export default FeedbackModal;
