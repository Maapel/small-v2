const API_URL = 'http://localhost:8000';

export const api = {
    injectCode: async (graph: any, code: string, worldId: string) => {
        const response = await fetch(`${API_URL}/inject`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, code, worldId }),
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Injection failed');
        }
        
        return response.json();
    }
};
