import { getUserFriendlyError } from '../utils/errorMessages';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

export const queryAgent = async (query, sessionId = null, onEvent) => {
    try {
        const requestBody = {
            message: query
        };

        // Include session ID if provided (for conversation continuity)
        if (sessionId) {
            requestBody.session_id = sessionId;
        }

        const response = await fetch(`${API_URL}/chat`, {
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

export const fetchSchemaOverview = async () => {
    try {
        const response = await fetch(`${API_URL}/schema/overview`);
        if (!response.ok) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            throw error;
        }
        return await response.json();
    } catch (error) {
        const friendlyMessage = getUserFriendlyError(error, 'schema');
        const userError = new Error(friendlyMessage);
        userError.originalError = error;
        throw userError;
    }
};

export const fetchInterpretation = async (queryId) => {
    try {
        const response = await fetch(`${API_URL}/api/interpret/${queryId}`);
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

export const submitFeedback = async (feedbackData) => {
    try {
        const response = await fetch(`${API_URL}/api/feedback`, {
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
