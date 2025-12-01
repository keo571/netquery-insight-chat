import { useState, useCallback, useRef } from 'react';
import { queryAgent } from '../services/api';
import { debugLog } from '../utils/debug';
import { getUserFriendlyError } from '../utils/errorMessages';

export const useChat = (database = 'sample') => {
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
      sql_explanation: '',
      analysis_explanation: '',
      results: null,
      visualization: null,
      display_info: null,
      query_id: null,
      database: database, // Store which database this query was run against
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
                    sql_explanation: event.explanation,
                    sql_query: event.sql,
                    query_id: event.query_id,
                    user_question: query,
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

          case 'interpretation':
            // Handle combined analysis + visualization response
            // Show whichever is available (graceful degradation)
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    analysis_explanation: event.analysis || '',
                    visualization: event.visualization || null,
                    schemaOverview: event.schema_overview,
                    suggestedQueries: event.suggested_queries,
                    loadingStates: {
                      ...msg.loadingStates,
                      analysis: true,
                      visualization: true
                    }
                  }
                : msg
            ));
            break;

          case 'analysis':
            // Legacy support: Store analysis separately from SQL
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    analysis_explanation: event.explanation,
                    loadingStates: { ...msg.loadingStates, analysis: true }
                  }
                : msg
            ));
            break;

          case 'visualization':
            // Legacy support: Update with visualization data
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

          case 'general_answer':
            // Handle general knowledge answer (no SQL needed)
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    content: event.answer,
                    query_id: event.query_id,
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
            // Handle error with user-friendly message
            const friendlyErrorMsg = getUserFriendlyError(event.message || event, 'streaming');
            setMessages(prev => prev.map(msg =>
              msg.id === agentMessageId
                ? {
                    ...msg,
                    content: friendlyErrorMsg,
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
      }, database);

    } catch (error) {
      // Remove the placeholder message and show user-friendly error
      setMessages(prev => prev.filter(msg => msg.id !== agentMessageId));

      const friendlyMessage = error.message || getUserFriendlyError(error, 'general');
      const errorMessage = {
        id: Date.now() + 1,
        content: friendlyMessage,
        timestamp: new Date().toISOString(),
        isUser: false,
        isError: true
      };

      setMessages(prev => [...prev, errorMessage]);
      setLoading(false);
    }
  }, [loading, database]);

  const updateMessageAnalysis = useCallback((messageId, analysisData) => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId
        ? {
            ...msg,
            analysis_explanation: analysisData.analysis,
            visualization: analysisData.visualization,
            schemaOverview: analysisData.schema_overview,
            suggestedQueries: analysisData.suggested_queries
          }
        : msg
    ));
  }, []);

  return {
    messages,
    loading,
    sendMessage,
    updateMessageAnalysis
  };
};
