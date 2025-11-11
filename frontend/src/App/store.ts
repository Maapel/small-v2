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

// Types matching your Python engine output
type EngineParam = { name: string; optional: boolean };
type EngineNode = { 
    id: string; 
    type: string; 
    label: string; 
    world: string; 
    data: {
        params?: EngineParam[]; // List of parameters for defs and calls
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

// --- NEW: WORLD PATH UTILITY ---
/**
 * Builds a human-readable path for a given worldId by tracing its parents.
 * e.g., "root > complex_calculator > apply_step"
 */
const buildWorldPath = (graph: GraphData, worldId: string): { path: string, stack: string[] } => {
    let currentId = worldId;
    const stack: string[] = [];
    
    while (currentId && currentId !== 'root') {
        stack.push(currentId);
        const node = getRawNode(graph, currentId);
        if (!node) break; // Should not happen
        currentId = node.world;
    }
    stack.push('root');
    
    const pathStack = stack.reverse();
    const path = pathStack
        .map(id => getRawNode(graph, id)?.label || (id === 'root' ? 'root' : '...'))
        .join(' > ');
        
    return { path, stack: pathStack };
};
// --- END NEW ---


const filterWorld = (graph: GraphData, worldId: string): { nodes: Node[], edges: Edge[] } => {
    const worldNodes = graph.nodes.filter(n => 
        n.world === worldId && 
        n.type !== 'FUNCTION_DEF' && 
        n.type !== 'CLASS_DEF'
    );
    
    const nodeIds = new Set(worldNodes.map(n => n.id));
    
    // Edges *within* this world
    const worldEdges = graph.edges.filter(e => 
        nodeIds.has(e.source) && 
        nodeIds.has(e.target) &&
        e.type !== 'CLOSURE_OF' // Don't render closure edges as visible wires
    );

    const COLUMNS = 4; const X_SP = 300; const Y_SP = 200;
    return {
        nodes: worldNodes.map((n, i) => {
            // --- UPDATED: Check for exports and get full path ---
            let exportedToWorlds: { worldId: string; label: string; fullPath: string }[] = [];
            if (n.type === 'VARIABLE') {
                exportedToWorlds = graph.edges
                    .filter(e => e.source === n.id && e.type === 'CLOSURE_OF')
                    .map(e => {
                        const proxyNode = getRawNode(graph, e.target);
                        if (!proxyNode) return null;
                        const worldNode = getRawNode(graph, proxyNode.world); // This is the FUNCTION_DEF node
                        if (!worldNode) return null;
                        
                        // Get the full path for the popover
                        const { path } = buildWorldPath(graph, worldNode.id);
                        
                        return { worldId: worldNode.id, label: worldNode.label, fullPath: path };
                    })
                    .filter((item): item is { worldId: string; label: string; fullPath: string } => item !== null);
            }
            // --- END UPDATE ---

            return {
                id: n.id, 
                type: n.type,
                // Pass new `exportedToWorlds` list to the node component
                data: { ...n.data, label: n.label, type: n.type, exportedToWorlds },
                position: { x: (i % COLUMNS) * X_SP + 50, y: Math.floor(i / COLUMNS) * Y_SP + 100 }
            };
        }),
        
        edges: worldEdges.map((e, i) => {
            let targetHandle: string | null = null;
            const targetNode = getRawNode(graph, e.target);
            if (!targetNode) return { id: `e_${i}`, source: e.source, target: e.target }; 

            if (e.type === 'ARGUMENT') {
                if (targetNode.data.params) {
                    if (e.data?.keyword) {
                        targetHandle = e.data.keyword;
                    } else if (e.data?.index !== undefined && targetNode.data.params[e.data.index]) {
                        targetHandle = targetNode.data.params[e.data.index].name;
                    }
                }
            } else if (e.type === 'OPERAND') {
                targetHandle = `operand_${e.data?.index ?? 0}`;
            } else if (e.type === 'WRITES_TO') {
                targetHandle = 'input';
            } else if (e.type === 'INPUT') {
                targetHandle = 'value';
            }

            return {
                id: `e_${i}`, 
                source: e.source, 
                target: e.target, 
                targetHandle: targetHandle,
                label: e.type.toLowerCase(),
                animated: ['WRITES_TO', 'INPUT'].includes(e.type),
                style: { stroke: e.type === 'ARGUMENT' ? '#f59e0b' : '#64748b', strokeWidth: 2 }
            };
        })
    };
};

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

  // --- UPDATED: This is now a true "teleporter" ---
  goToWorld: (worldId) => {
      const { rawGraph, currentWorld } = get();
      if (currentWorld === worldId) return; // Already there

      // Rebuild the world stack from scratch
      const { stack } = buildWorldPath(rawGraph, worldId);
      
      const newWorldId = stack.pop()!; // The last item is the target world
      const newStack = stack; // The rest are the history
      
      const { nodes, edges } = filterWorld(rawGraph, newWorldId);
      set({ worldStack: newStack, currentWorld: newWorldId, nodes, edges });
  },
  // --- END UPDATE ---

  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
}));

export default useStore;