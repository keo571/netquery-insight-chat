import { getUserFriendlyError } from '../utils/errorMessages';

// ================================
// API URL CONFIGURATION
// ================================

// Database to backend URL mapping (for dual backend / development mode)
const DATABASE_URLS = {
    'sample': process.env.REACT_APP_SAMPLE_URL || 'http://localhost:8000',
    'neila': process.env.REACT_APP_NEILA_URL || 'http://localhost:8001',
};

/**
 * Detect if we're running in same-origin mode (served by backend)
 *
 * Same-origin mode: Frontend is served by the backend (e.g., http://server:3000)
 * Cross-origin mode: Frontend runs on separate dev server (npm start)
 *
 * In same-origin mode, we use window.location.origin for API calls.
 * This enables zero-config deployment where users just access the backend URL.
 */
const isSameOriginMode = () => {
    // Check if we have an explicit dev mode flag (forces cross-origin mode)
    const forceDevMode = process.env.REACT_APP_DEV_MODE === 'true';
    if (forceDevMode) {
        return false;
    }

    // In production build served by backend, NODE_ENV is 'production'
    // In development (npm start), NODE_ENV is 'development'
    return process.env.NODE_ENV === 'production';
};

/**
 * Get API URL for a specific database
 *
 * - Same-origin mode: Always use window.location.origin (backend serves frontend on any port)
 * - Cross-origin mode: Use configured URLs from environment variables
 *
 * @param {string} database - Database name (used only in cross-origin mode)
 * @returns {string} API base URL
 */
const getApiUrl = (database = 'sample') => {
    // Production: Use same origin (backend serves frontend on any port)
    if (isSameOriginMode()) {
        return window.location.origin;
    }
    // Development: Use configured URLs for database switching
    return DATABASE_URLS[database] || DATABASE_URLS['sample'];
};

/**
 * Check if database switching is available
 * Only available in cross-origin (development) mode
 */
export const isDatabaseSwitchingEnabled = () => {
    return !isSameOriginMode();
};

export const queryAgent = async (query, sessionId = null, onEvent, database = 'sample') => {
    try {
        const requestBody = {
            message: query,
            database: database,  // Include selected database
            include_interpretation: false  // User clicks "Show Analysis" to get interpretation
        };

        // Include session ID if provided (for conversation continuity)
        if (sessionId) {
            requestBody.session_id = sessionId;
        }

        const response = await fetch(`${getApiUrl(database)}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            throw error;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');

            // Keep the last partial line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6); // Remove 'data: ' prefix
                    if (data.trim()) {
                        try {
                            const event = JSON.parse(data);
                            onEvent(event);

                            if (event.type === 'done' || event.type === 'error') {
                                return;
                            }
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e, data);
                        }
                    }
                }
            }
        }
    } catch (error) {
        // Create user-friendly error for streaming context
        const friendlyMessage = getUserFriendlyError(error, 'streaming');
        const userError = new Error(friendlyMessage);
        userError.originalError = error; // Keep original for debugging
        throw userError;
    }
};

/**
 * Fetch the schema overview from the backend
 * @param {string} database - The database name (e.g., 'sample', 'neila')
 * @returns {Promise<Object>} Schema overview data
 */
export const fetchSchemaOverview = async (database = 'sample') => {
    try {
        const response = await fetch(`${getApiUrl(database)}/api/schema/overview?database=${encodeURIComponent(database)}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch schema: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error fetching schema overview:', error);
        throw error;
    }
};

export const fetchInterpretation = async (queryId, database = 'sample') => {
    try{
        const response = await fetch(`${getApiUrl(database)}/api/interpret/${queryId}?database=${encodeURIComponent(database)}`);
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            throw error;
        }
        return await response.json();
    } catch (error) {
        const friendlyMessage = getUserFriendlyError(error, 'general');
        const userError = new Error(friendlyMessage);
        userError.originalError = error;
        throw userError;
    }
};

export const submitFeedback = async (feedbackData, database = 'sample') => {
    try {
        const response = await fetch(`${getApiUrl(database)}/api/feedback`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(feedbackData),
        });
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            throw error;
        }
        return await response.json();
    } catch (error) {
        const friendlyMessage = getUserFriendlyError(error, 'feedback');
        const userError = new Error(friendlyMessage);
        userError.originalError = error;
        throw userError;
    }
};
