import {
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from '@xyflow/react';
import { create } from 'zustand';

// ... (Types are unchanged)
type EngineParam = { name: string; optional: boolean };
type EngineNode = { 
    id: string; 
    type: string; 
    label: string; 
    world: string; 
    data: {
        params?: EngineParam[]; 
        [key: string]: any;
    } 
};
type EngineEdge = { 
    source: string; 
    target: string; 
    type: string; 
    label?: string;
    data?: {
        index?: number;
        keyword?: string;
    }
};
type GraphData = { nodes: EngineNode[]; edges: EngineEdge[] };

export type RFState = {
  nodes: Node[];
  edges: Edge[];
  rawGraph: GraphData;
  currentWorld: string;
  worldStack: string[];
  isSidebarOpen: boolean;
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  loadGraph: (data: GraphData) => void;
  enterWorld: (nodeId: string) => void;
  goUp: () => void;
  goToWorld: (worldId: string) => void;
  toggleSidebar: () => void;
};

const getRawNode = (graph: GraphData, nodeId: string) => graph.nodes.find(n => n.id === nodeId);

// ... (buildWorldPath is unchanged)
const buildWorldPath = (graph: GraphData, worldId: string): { path: string, stack: string[] } => {
    let currentId = worldId;
    const stack: string[] = [];
    
    while (currentId && currentId !== 'root') {
        stack.push(currentId);
        const node = getRawNode(graph, currentId);
        if (!node) break; 
        currentId = node.world;
    }
    stack.push('root');
    
    const pathStack = stack.reverse();
    const path = pathStack
        .map(id => {
            if (id === 'root') return 'root';
            if (id === 'world_imports') return 'imports'; 
            return getRawNode(graph, id)?.label || '...';
        })
        .join(' > ');
        
    return { path, stack: pathStack };
};


const filterWorld = (graph: GraphData, worldId: string): { nodes: Node[], edges: Edge[] } => {
    const worldNodes = graph.nodes.filter(n => 
        n.world === worldId && 
        n.type !== 'FUNCTION_DEF' && 
        n.type !== 'CLASS_DEF' &&
        n.type !== 'IMPORT'
    );
    
    const worldNodeMap = new Map(worldNodes.map(n => [n.id, n]));
    const allEdges = graph.edges;
    
    // --- UPDATED: Clutter Reduction & Data Structure Pre-processing ---
    
    const collapsedNodeIds = new Set<string>();
    const collapsedEdgeIds = new Set<string>();
    
    const processedNodeData = new Map<string, any>();
    worldNodes.forEach(node => {
        processedNodeData.set(node.id, { ...node.data, port_defaults: {} });
    });

    for (const targetNode of worldNodes) {
        const targetNodeData = processedNodeData.get(targetNode.id)!;
        
        // --- RENAMED: Pre-process LIST_CONSTRUCTOR ---
        if (targetNode.type === 'LIST_CONSTRUCTOR') {
            const itemEdges = allEdges
                .filter(e => e.target === targetNode.id && e.type === 'LIST_ELEMENT')
                .sort((a, b) => (a.data?.index ?? 0) - (b.data?.index ?? 0));
                
            // We now pass *all* items to the node, literal or wired
            const initialItems: any[] = []; 
            for (const edge of itemEdges) {
                const sourceNode = getRawNode(graph, edge.source);
                if (sourceNode && sourceNode.type === 'LITERAL') {
                    // This is a literal, collapse it
                    initialItems.push({ 
                        isWired: false, 
                        value: sourceNode.label, 
                        portId: `item_${edge.data?.index ?? 0}` 
                    });
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    // This is a wired input, the node will render a port
                    initialItems.push({ 
                        isWired: true, 
                        value: `[Wired Input]`, 
                        portId: `item_${edge.data?.index ?? 0}` 
                    });
                }
            }
            targetNodeData.initialItems = initialItems;
        }
        
        // --- RENAMED: Pre-process DICT_CONSTRUCTOR ---
        else if (targetNode.type === 'DICT_CONSTRUCTOR') {
            const keyEdges = allEdges.filter(e => e.target === targetNode.id && e.type === 'DICT_KEY');
            const valueEdges = allEdges.filter(e => e.target === targetNode.id && e.type === 'DICT_VALUE');
            
            const pairs: { [key: number]: { key?: any, value?: any } } = {};

            for (const edge of keyEdges) {
                const index = edge.data?.index ?? 0;
                if (!pairs[index]) pairs[index] = {};
                const sourceNode = getRawNode(graph, edge.source);
                const portId = `key_${index}`;
                
                if (sourceNode && sourceNode.type === 'LITERAL') {
                    pairs[index].key = { isWired: false, value: sourceNode.label, portId };
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    pairs[index].key = { isWired: true, value: "[Wired Key]", portId };
                }
            }
            for (const edge of valueEdges) {
                const index = edge.data?.index ?? 0;
                if (!pairs[index]) pairs[index] = {};
                const sourceNode = getRawNode(graph, edge.source);
                const portId = `value_${index}`;
                
                if (sourceNode && sourceNode.type === 'LITERAL') {
                    pairs[index].value = { isWired: false, value: sourceNode.label, portId };
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    pairs[index].value = { isWired: true, value: "[Wired Value]", portId };
                }
            }
            targetNodeData.initialPairs = Object.values(pairs).map(p => ({ 
                key: p.key ?? { isWired: false, value: '?', portId: '?' }, 
                value: p.value ?? { isWired: false, value: '?', portId: '?' } 
            }));
        }
        
        // --- "In-Port Literal" logic for all OTHER nodes ---
        else {
            const incomingEdges = allEdges.filter(e => e.target === targetNode.id);
            for (const edge of incomingEdges) {
                const sourceNode = getRawNode(graph, edge.source);
                
                if (sourceNode && sourceNode.type === 'LITERAL') {
                    let portName: string | null = null;
                    
                    if (edge.data?.keyword) portName = edge.data.keyword;
                    else if (edge.data?.index !== undefined && targetNodeData.params) {
                        const param = (targetNodeData.params as EngineParam[]).find((p, i) => i === edge.data?.index);
                        if(param) portName = param.name;
                    }
                    
                    if (!portName) {
                        if (edge.type === 'OPERAND') portName = `operand_${edge.data?.index ?? 0}`;
                        else if (edge.type === 'ACCESS_KEY') portName = 'access_key';
                        else if (edge.type === 'ACCESS_VALUE') portName = 'access_value';
                        else if (edge.type === 'ATTRIBUTE_VALUE') portName = 'attribute_value';
                        else if (edge.type === 'INPUT') portName = 'value';
                        else if (edge.type === 'WRITES_TO') portName = 'input';
                        else if (edge.type === 'ITERATES_ON') portName = 'iterates_on';
                    }

                    if (portName) {
                        collapsedNodeIds.add(sourceNode.id);
                        collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`); 
                        targetNodeData.port_defaults[portName] = sourceNode.label;
                    }
                }
            }
        }
    }
    // --- END Clutter Reduction ---

    const finalWorldNodes = worldNodes.filter(n => !collapsedNodeIds.has(n.id));
    
    const nodeIds = new Set(finalWorldNodes.map(n => n.id));
    
    const worldEdges = allEdges.filter(e => 
        (nodeIds.has(e.source) && nodeIds.has(e.target)) && // Both nodes must be visible
        e.type !== 'CLOSURE_OF' &&
        !collapsedEdgeIds.has(`${e.source}-${e.target}-${e.type}`)
    );

    const COLUMNS = 4; const X_SP = 300; const Y_SP = 200;
    return {
        nodes: finalWorldNodes.map((n, i) => {
            const nodeData = processedNodeData.get(n.id) || n.data;
            
            let exportedToWorlds: { worldId: string; label: string; fullPath: string }[] = [];
            if (n.type === 'VARIABLE') {
                exportedToWorlds = graph.edges
                    .filter(e => e.source === n.id && e.type === 'CLOSURE_OF')
                    .map(e => {
                        const proxyNode = getRawNode(graph, e.target);
                        if (!proxyNode) return null;
                        const worldNode = getRawNode(graph, proxyNode.world);
                        if (!worldNode) return null;
                        const { path } = buildWorldPath(graph, worldNode.id);
                        return { worldId: worldNode.id, label: worldNode.label, fullPath: path };
                    })
                    .filter((item): item is { worldId: string; label: string; fullPath: string } => item !== null);
            }

            return {
                id: n.id, 
                type: n.type,
                data: { ...nodeData, label: n.label, type: n.type, exportedToWorlds },
                position: { x: (i % COLUMNS) * X_SP + 50, y: Math.floor(i / COLUMNS) * Y_SP + 100 }
            };
        }),
        
        edges: worldEdges.map((e, i) => {
            let targetHandle: string | null = null;
            let label: string | undefined = undefined; // --- NEW: For edge labels ---
            const targetNode = getRawNode(graph, e.target);
            if (!targetNode) return { id: `e_${i}`, source: e.source, target: e.target }; 
            
            const targetNodeData = processedNodeData.get(e.target) || targetNode.data;

            if (e.type === 'ARGUMENT') {
                if (targetNodeData.params) {
                    if (e.data?.keyword) {
                        targetHandle = e.data.keyword;
                    } else if (e.data?.index !== undefined && (targetNodeData.params as EngineParam[])[e.data.index]) {
                        targetHandle = (targetNodeData.params as EngineParam[])[e.data.index].name;
                    }
                }
            } else if (e.type === 'LIST_ELEMENT') {
                targetHandle = `item_${e.data?.index ?? 0}`;
                label = `${e.data?.index ?? 0}`; // --- ADDED EDGE LABEL ---
            } else if (e.type === 'DICT_KEY') {
                targetHandle = `key_${e.data?.index ?? 0}`;
                label = `K${e.data?.index ?? 0}`; // --- ADDED EDGE LABEL ---
            } else if (e.type === 'DICT_VALUE') {
                targetHandle = `value_${e.data?.index ?? 0}`;
                label = `V${e.data?.index ?? 0}`; // --- ADDED EDGE LABEL ---
            } else if (e.type === 'OPERAND') {
                targetHandle = `operand_${e.data?.index ?? 0}`;
            } else if (e.type === 'WRITES_TO') {
                targetHandle = 'input';
            } else if (e.type === 'INPUT') {
                targetHandle = 'value';
            } else if (e.type === 'ACCESS_VALUE') {
                targetHandle = 'access_value';
            } else if (e.type === 'ACCESS_KEY') {
                targetHandle = 'access_key';
            } else if (e.type === 'ATTRIBUTE_VALUE') {
                targetHandle = 'attribute_value';
            } else if (e.type === 'ITERATES_ON') {
                targetHandle = 'iterates_on';
            }

            return {
                id: `e_${i}`, 
                source: e.source, 
                target: e.target, 
                targetHandle: targetHandle,
                label: label, // --- Pass the label to React Flow ---
                animated: ['WRITES_TO', 'INPUT'].includes(e.type),
                style: { stroke: e.type === 'ARGUMENT' ? '#f59e0b' : '#64748b', strokeWidth: 2 }
            };
        })
    };
};

// --- Store definition (unchanged) ---
const useStore = create<RFState>((set, get) => ({
  nodes: [], edges: [], rawGraph: { nodes: [], edges: [] },
  currentWorld: 'root', worldStack: [], 
  isSidebarOpen: true,
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges) }),
  loadGraph: (data) => {
      const { nodes, edges } = filterWorld(data, 'root');
      set({ rawGraph: data, currentWorld: 'root', worldStack: [], nodes, edges, isSidebarOpen: true });
  },
  enterWorld: (nodeId) => {
      const { rawGraph, currentWorld, worldStack } = get();
      if (currentWorld === nodeId) return;
      const newStack = [...worldStack, currentWorld];
      const { nodes, edges } = filterWorld(rawGraph, nodeId);
      set({ worldStack: newStack, currentWorld: nodeId, nodes, edges });
  },
  goUp: () => {
      const { rawGraph, worldStack } = get();
      if (worldStack.length === 0) return;
      const newStack = [...worldStack];
      const prevWorld = newStack.pop()!;
      const { nodes, edges } = filterWorld(rawGraph, prevWorld);
      set({ worldStack: newStack, currentWorld: prevWorld, nodes, edges });
  },
  goToWorld: (worldId) => {
      const { rawGraph, currentWorld } = get();
      if (currentWorld === worldId) return; 
      const { stack } = buildWorldPath(rawGraph, worldId);
      const newWorldId = stack.pop()!; 
      const newStack = stack; 
      const { nodes, edges } = filterWorld(rawGraph, newWorldId);
      set({ worldStack: newStack, currentWorld: newWorldId, nodes, edges });
  },
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));

export default useStore;