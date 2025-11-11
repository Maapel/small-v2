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

type EngineNode = { id: string; type: string; label: string; world: string; data: any };
type EngineEdge = { source: string; target: string; type: string; label?: string };
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

// Helper to filter the raw graph for the current world view
const filterWorld = (graph: GraphData, worldId: string): { nodes: Node[], edges: Edge[] } => {
    // Filter for nodes that are in this world AND are NOT definitions (they go in sidebar)
    const worldNodes = graph.nodes.filter(n => 
        n.world === worldId && 
        n.type !== 'FUNCTION_DEF' && 
        n.type !== 'CLASS_DEF'
    );
    
    const nodeIds = new Set(worldNodes.map(n => n.id));
    // Only show edges where BOTH ends are in the visible set
    const worldEdges = graph.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

    // Simple grid layout to prevent nodes from stacking
    const COLUMNS = 4; const X_SP = 250; const Y_SP = 150;
    return {
        nodes: worldNodes.map((n, i) => ({
            id: n.id, 
            type: n.type, // Matches keys in nodeTypes
            data: { ...n.data, label: n.label, type: n.type },
            position: { x: (i % COLUMNS) * X_SP + 50, y: Math.floor(i / COLUMNS) * Y_SP + 100 }
        })),
        edges: worldEdges.map((e, i) => ({
            id: `e_${i}`, 
            source: e.source, 
            target: e.target, 
            label: e.type !== 'DATA_FLOW' ? e.type.toLowerCase() : undefined,
            animated: ['WRITES_TO', 'INPUT'].includes(e.type),
            style: { stroke: e.type === 'ARGUMENT' ? '#f59e0b' : '#64748b', strokeWidth: 2 }
        }))
    };
};

const useStore = create<RFState>((set, get) => ({
  nodes: [], edges: [], rawGraph: { nodes: [], edges: [] },
  currentWorld: 'root', worldStack: [], 
  isSidebarOpen: true, // Default to open

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges) }),

  loadGraph: (data) => {
      console.log("📥 Loading graph with", data.nodes.length, "nodes");
      const { nodes, edges } = filterWorld(data, 'root');
      set({ rawGraph: data, currentWorld: 'root', worldStack: [], nodes, edges, isSidebarOpen: true });
  },

  enterWorld: (nodeId) => {
      const { rawGraph, currentWorld, worldStack } = get();
      // Prevent re-entering the same world if already there (avoids duplicate stack entries)
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
      const { rawGraph, worldStack, currentWorld } = get();
      // If already at target, do nothing
      if (currentWorld === worldId) return;

      const fullHistory = [...worldStack, currentWorld];
      const targetIndex = fullHistory.indexOf(worldId);
      
      if (targetIndex !== -1) {
          const newStack = fullHistory.slice(0, targetIndex);
          const { nodes, edges } = filterWorld(rawGraph, worldId);
          set({ worldStack: newStack, currentWorld: worldId, nodes, edges });
      }
  },

  toggleSidebar: () => {set((state) => ({ isSidebarOpen: !state.isSidebarOpen }))
},
}));

export default useStore;