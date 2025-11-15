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
    },

    // --- NEW GRAPH MUTATION API FUNCTIONS ---
    addEdge: async (graph: any, source: string, target: string, edgeType: string = "DATA_FLOW", label?: string, data?: any) => {
        const response = await fetch(`${API_URL}/op/add-edge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, source, target, edgeType, label, data }),
        });
        if (!response.ok) throw new Error('Failed to add edge');
        return response.json();
    },

    removeEdge: async (graph: any, source: string, target: string, edgeType?: string) => {
        const response = await fetch(`${API_URL}/op/remove-edge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, source, target, edgeType }),
        });
        if (!response.ok) throw new Error('Failed to remove edge');
        return response.json();
    },

    updatePortLiteral: async (graph: any, nodeId: string, portId: string, newValue: string) => {
        const response = await fetch(`${API_URL}/op/update-port-literal`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, nodeId, portId, newValue }),
        });
        if (!response.ok) throw new Error('Failed to update port literal');
        return response.json();
    },

    addListItem: async (graph: any, listNodeId: string, value: string = "''") => {
        const response = await fetch(`${API_URL}/op/add-list-item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, listNodeId, value }),
        });
        if (!response.ok) throw new Error('Failed to add list item');
        return response.json();
    },

    updateListItem: async (graph: any, listNodeId: string, index: number, newValue: string) => {
        const response = await fetch(`${API_URL}/op/update-list-item`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, listNodeId, index, newValue }),
        });
        if (!response.ok) throw new Error('Failed to update list item');
        return response.json();
    },

    addDictPair: async (graph: any, dictNodeId: string, key: string = "'new_key'", value: string = "''") => {
        const response = await fetch(`${API_URL}/op/add-dict-pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, dictNodeId, key, value }),
        });
        if (!response.ok) throw new Error('Failed to add dict pair');
        return response.json();
    },

    updateDictPair: async (graph: any, dictNodeId: string, index: number, keyValue?: string, valueValue?: string) => {
        const response = await fetch(`${API_URL}/op/update-dict-pair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph, dictNodeId, index, keyValue, valueValue }),
        });
        if (!response.ok) throw new Error('Failed to update dict pair');
        return response.json();
    }
};
