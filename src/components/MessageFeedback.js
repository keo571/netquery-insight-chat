import React, { useState } from 'react';
import PropTypes from 'prop-types';
import FeedbackModal from './FeedbackModal';
import { submitFeedback } from '../services/api';
import { getUserFriendlyError } from '../utils/errorMessages';
import './MessageFeedback.css';

const MessageFeedback = ({ message }) => {
  const [feedbackGiven, setFeedbackGiven] = useState(null); // 'up' | 'down' | null
  const [showModal, setShowModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleThumbsUp = async () => {
    if (feedbackGiven) return; // Already gave feedback

    setIsSubmitting(true);
    try {
      await submitFeedback({
        type: 'thumbs_up',
        query_id: message.query_id,
        user_question: message.user_question,
        sql_query: message.sql_query,
        timestamp: new Date().toISOString()
      });
      setFeedbackGiven('up');
    } catch (error) {
      const friendlyError = error.message || getUserFriendlyError(error, 'feedback');
      alert(friendlyError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleThumbsDown = () => {
    if (feedbackGiven) return; // Already gave feedback
    setShowModal(true);
  };

  const handleModalSubmit = async (description) => {
    setIsSubmitting(true);
    try {
      await submitFeedback({
        type: 'thumbs_down',
        query_id: message.query_id,
        user_question: message.user_question,
        sql_query: message.sql_query,
        description: description || '',
        timestamp: new Date().toISOString()
      });
      setFeedbackGiven('down');
      setShowModal(false);
    } catch (error) {
      const friendlyError = error.message || getUserFriendlyError(error, 'feedback');
      alert(friendlyError);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
  };

  // Don't show feedback buttons if no query_id (e.g., welcome message)
  if (!message.query_id) {
    return null;
  }

  return (
    <>
      <div className="message-feedback">
        <button
          className={`feedback-btn ${feedbackGiven === 'up' ? 'active' : ''}`}
          onClick={handleThumbsUp}
          disabled={feedbackGiven !== null || isSubmitting}
          title="Helpful response"
        >
          👍
        </button>
        <button
          className={`feedback-btn ${feedbackGiven === 'down' ? 'active' : ''}`}
          onClick={handleThumbsDown}
          disabled={feedbackGiven !== null || isSubmitting}
          title="Not helpful"
        >
          👎
        </button>
        {feedbackGiven && (
          <span className="feedback-thanks">Thanks for your feedback!</span>
        )}
      </div>

      {showModal && (
        <FeedbackModal
          onSubmit={handleModalSubmit}
          onClose={handleModalClose}
          isSubmitting={isSubmitting}
        />
      )}
    </>
  );
};

MessageFeedback.propTypes = {
  message: PropTypes.shape({
    query_id: PropTypes.string,
    user_question: PropTypes.string,
    sql_query: PropTypes.string
  }).isRequired
};

export default MessageFeedback;
