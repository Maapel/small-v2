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
    },

    runGraph: async (graph: any) => {
        const response = await fetch(`${API_URL}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph }),
        });
        
        if (!response.ok) {
            throw new Error('Execution failed');
        }
        
        return response.json();
    },

    // --- NEW ---
    removeNodes: async (graph: any, nodeIds: string[]) => {
        const response = await fetch(`${API_URL}/op/remove-nodes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, nodeIds }),
        });
        if (!response.ok) throw new Error('Failed to remove nodes');
        return response.json();
    },

    // --- NEW ---
    addImport: async (graph: any, code: string) => {
        const response = await fetch(`${API_URL}/op/add-import`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, code }),
        });
        if (!response.ok) throw new Error('Failed to add import');
        return response.json();
    },

    // --- NEW ---
    updateNodeLiteral: async (graph: any, nodeId: string, newValue: string) => {
        const response = await fetch(`${API_URL}/op/update-literal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, nodeId, newValue }),
        });
        if (!response.ok) throw new Error('Failed to update literal');
        return response.json();
    }
};
