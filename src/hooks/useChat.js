import { useState, useCallback, useRef } from 'react';
import { queryAgent } from '../services/api';
import { debugLog } from '../utils/debug';

export const useChat = () => {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef(null); // Track session ID across requests

  const sendMessage = useCallback(async (query) => {
    if (!query.trim() || loading) return;

    const userMessage = {
      id: Date.now(),
      content: query,
      timestamp: new Date().toISOString(),
      isUser: true
    };

    // Add user message to chat
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);

    // Create placeholder agent message that will be updated progressively
    const agentMessageId = Date.now() + 1;
    const initialAgentMessage = {
      id: agentMessageId,
      content: '',
      explanation: '',
      results: null,
      visualization: null,
      display_info: null,
      query_id: null,
      suggestedQueries: [],
      schemaOverview: null,
      timestamp: new Date().toISOString(),
      isUser: false,
      isLoading: true, // Flag to show loading states
      loadingStates: {
        sql: false,
        data: false,
        analysis: false,
        visualization: false
      }
    };

    setMessages(prev => [...prev, initialAgentMessage]);

    try {
      await queryAgent(query, sessionIdRef.current, (event) => {
        debugLog('Stream event:', event);

        switch (event.type) {
          case 'session':
            // Store session ID
            if (event.session_id) {
              sessionIdRef.current = event.session_id;
              debugLog('Session ID:', event.session_id);
            }
            break;

          case 'sql':
            // Update with SQL and query_id
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    explanation: event.explanation,
                    query_id: event.query_id,
                    loadingStates: { ...msg.loadingStates, sql: true }
                  }
                : msg
            ));
            break;

          case 'data':
            // Update with data results
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    results: event.results,
                    display_info: event.display_info,
                    loadingStates: { ...msg.loadingStates, data: true }
                  }
                : msg
            ));
            break;

          case 'analysis':
            // Append analysis to explanation
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    explanation: msg.explanation + event.explanation,
                    loadingStates: { ...msg.loadingStates, analysis: true }
                  }
                : msg
            ));
            break;

          case 'visualization':
            // Update with visualization data
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    visualization: event.visualization,
                    schemaOverview: event.schema_overview,
                    suggestedQueries: event.suggested_queries,
                    loadingStates: { ...msg.loadingStates, visualization: true }
                  }
                : msg
            ));
            break;

          case 'guidance':
            // Handle guidance response (schema help)
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    content: event.message,
                    schemaOverview: event.schema_overview,
                    suggestedQueries: event.suggested_queries,
                    isLoading: false,
                    loadingStates: {
                      sql: true,
                      data: true,
                      analysis: true,
                      visualization: true
                    }
                  }
                : msg
            ));
            break;

          case 'done':
            // Mark message as fully loaded
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? { ...msg, isLoading: false }
                : msg
            ));
            setLoading(false);
            break;

          case 'error':
            // Handle error
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    content: `Error: ${event.message}`,
                    isError: true,
                    isLoading: false
                  }
                : msg
            ));
            setLoading(false);
            break;

          default:
            debugLog('Unknown event type:', event.type);
        }
      });

    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
        isUser: false,
        isError: true
      };

      setMessages(prev => [...prev, errorMessage]);
      setLoading(false);
    }
  }, [loading]);

  return {
    messages,
    loading,
    sendMessage
  };
};
