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
            throw new Error('Failed to start streaming query');
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
        console.error('Streaming API Error:', error);
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
