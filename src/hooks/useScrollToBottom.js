import { useEffect, useRef } from 'react';

export const useScrollToBottom = (messages) => {
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    const el = messagesEndRef.current;
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return messagesEndRef;
};