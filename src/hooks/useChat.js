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

    try {
      // Send query with session ID for conversation continuity
      const result = await queryAgent(query, sessionIdRef.current);

      // Store session ID from response for next request
      if (result.session_id) {
        sessionIdRef.current = result.session_id;
        debugLog('Session ID:', result.session_id);
      }
      debugLog('API result:', result);


      const hasResponseText = typeof result.response === 'string' && result.response.trim().length > 0;
      const fallbackGuidance = result.explanation || 'Here are a few topics I can assist with.';
      const content = hasResponseText
        ? result.response
        : (result.guidance ? fallbackGuidance : '');

      const agentMessage = {
        id: Date.now() + 1,
        content,
        explanation: result.explanation,
        results: result.results,
        visualization: result.visualization,
        visualization_path: result.visualization_path,
        display_info: result.display_info,
        query_id: result.query_id,
        metadata: result.metadata,
        suggestedQueries: result.suggested_queries,
        schemaOverview: result.schema_overview,
        timestamp: new Date().toISOString(),
        isUser: false
      };

      setMessages(prev => [...prev, agentMessage]);
    } catch (error) {
      const errorMessage = {
        id: Date.now() + 1,
        content: `Error: ${error.message}`,
        timestamp: new Date().toISOString(),
        isUser: false,
        isError: true
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  }, [loading]);

  return {
    messages,
    loading,
    sendMessage
  };
};
