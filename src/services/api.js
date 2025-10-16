const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8001';

export const queryAgent = async (query, sessionId = null) => {
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
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Failed to query agent');
        }

        return await response.json();
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
};

export const fetchSchemaOverview = async () => {
    try {
        const response = await fetch(`${API_URL}/schema/overview`);
        if (!response.ok) {
            throw new Error('Failed to load schema overview');
        }
        return await response.json();
    } catch (error) {
        console.error('Schema overview error:', error);
        throw error;
    }
};
