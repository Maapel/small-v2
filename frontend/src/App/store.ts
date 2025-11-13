import {
  type Edge,
  type Node,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Position, // --- 1. Imported Position ---
} from '@xyflow/react';
import { create } from 'zustand';
import dagre from 'dagre'; // --- 2. Imported Dagre ---
import { api } from './api';

// --- 3. Custom Types for Type Safety ---
type CustomNodeData = {
    label: string;
    type: string;
    exportedToWorlds?: { worldId: string; label: string; fullPath: string }[];
    initialItems?: {isWired: boolean, value: string, portId: string}[];
    initialPairs?: {
        key: {isWired: boolean, value: string, portId: string},
        value: {isWired: boolean, value: string, portId: string}
    }[];
    port_defaults?: { [key: string]: string };
    [key: string]: any; 
};

type AppNode = Node<CustomNodeData>;

// --- 4. Layout Helper ---
const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const NODE_WIDTH = 250;
const NODE_HEIGHT = 150; 

const getLayoutedElements = (nodes: AppNode[], edges: Edge[], direction = 'TB') => {
  const isHorizontal = direction === 'LR';
  dagreGraph.setGraph({ rankdir: direction, nodesep: 100, ranksep: 100 });

  nodes.forEach((node) => {
    let height = NODE_HEIGHT;
    if (node.type === 'LIST_CONSTRUCTOR' && node.data.initialItems) {
      height = 60 + node.data.initialItems.length * 32 + 30; 
    } else if (node.type === 'DICT_CONSTRUCTOR' && node.data.initialPairs) {
      height = 60 + node.data.initialPairs.length * 32 + 30;
    }
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  nodes.forEach((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.targetPosition = isHorizontal ? Position.Left : Position.Top;
    node.sourcePosition = isHorizontal ? Position.Right : Position.Bottom;

    node.position = {
      x: nodeWithPosition.x - NODE_WIDTH / 2,
      y: nodeWithPosition.y - (dagreGraph.node(node.id).height) / 2,
    };
  });

  return { nodes, edges };
};

// --- Engine Types ---
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
  nodes: AppNode[]; 
  edges: Edge[];
  rawGraph: GraphData;
  currentWorld: string;
  worldStack: string[];
  
  // Sidebar State
  isSidebarOpen: boolean;
  toggleSidebar: () => void;

  // Output Panel State
  isOutputOpen: boolean;
  outputLogs: string[];
  toggleOutput: () => void;
  addOutputLog: (log: string) => void;
  clearOutput: () => void;

  // Actions
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  loadGraph: (data: GraphData) => void;
  enterWorld: (nodeId: string) => void;
  goUp: () => void;
  goToWorld: (worldId: string) => void;
  setLayoutedWorld: (worldId: string, newStack: string[]) => void; // Added helper
  // --- NEW: ACTIONS ---
  injectCode: (code: string) => Promise<void>;
  runProject: () => Promise<void>;
};

const getRawNode = (graph: GraphData, nodeId: string) => graph.nodes.find(n => n.id === nodeId);

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

const filterWorld = (graph: GraphData, worldId: string): { nodes: AppNode[], edges: Edge[] } => {
    const worldNodes = graph.nodes.filter(n => 
        n.world === worldId && 
        n.type !== 'FUNCTION_DEF' && 
        n.type !== 'CLASS_DEF' &&
        n.type !== 'IMPORT'
    );
    
    const worldNodeMap = new Map(worldNodes.map(n => [n.id, n]));
    const allEdges = graph.edges;
    
    const collapsedNodeIds = new Set<string>();
    const collapsedEdgeIds = new Set<string>();
    
    const processedNodeData = new Map<string, CustomNodeData>();
    worldNodes.forEach(node => {
        processedNodeData.set(node.id, { 
            ...node.data, 
            label: node.label, 
            type: node.type,
            port_defaults: {} 
        });
    });

    for (const targetNode of worldNodes) {
        const targetNodeData = processedNodeData.get(targetNode.id)!;
        
        if (targetNode.type === 'LIST_CONSTRUCTOR') {
            const itemEdges = allEdges
                .filter(e => e.target === targetNode.id && e.type === 'LIST_ELEMENT')
                .sort((a, b) => (a.data?.index ?? 0) - (b.data?.index ?? 0));
                
            const initialItems: any[] = []; 
            for (const edge of itemEdges) {
                const sourceNode = getRawNode(graph, edge.source);
                const portId = `item_${edge.data?.index ?? 0}`;
                
                if (sourceNode && sourceNode.type === 'LITERAL') {
                    initialItems.push({ isWired: false, value: sourceNode.label, portId });
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    initialItems.push({ isWired: true, value: `[Wired Input]`, portId });
                }
            }
            targetNodeData.initialItems = initialItems;
        }
        
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
                        if (targetNodeData.port_defaults) {
                            targetNodeData.port_defaults[portName] = sourceNode.label;
                        }
                    }
                }
            }
        }
    }

    const finalWorldNodes = worldNodes.filter(n => !collapsedNodeIds.has(n.id));
    const nodeIds = new Set(finalWorldNodes.map(n => n.id));
    
    const worldEdges = allEdges.filter(e => 
        (nodeIds.has(e.source) && nodeIds.has(e.target)) && 
        e.type !== 'CLOSURE_OF' &&
        // --- FIXED LINE BELOW: Use correct variable name interpolation ---
        !collapsedEdgeIds.has(`${e.source}-${e.target}-${e.type}`)
    );

    return {
        nodes: finalWorldNodes.map((n, i): AppNode => {
            const nodeData = processedNodeData.get(n.id)!;
            
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
            nodeData.exportedToWorlds = exportedToWorlds;

            return {
                id: n.id, 
                type: n.type,
                data: nodeData,
                position: { x: 0, y: 0 } 
            };
        }),
        
        edges: worldEdges.map((e, i) => {
            let targetHandle: string | null = null;
            let label: string | undefined = undefined;
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
                label = `${e.data?.index ?? 0}`;
            } else if (e.type === 'DICT_KEY') {
                targetHandle = `key_${e.data?.index ?? 0}`;
                label = `K${e.data?.index ?? 0}`;
            } else if (e.type === 'DICT_VALUE') {
                targetHandle = `value_${e.data?.index ?? 0}`;
                label = `V${e.data?.index ?? 0}`;
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
                label: label,
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
  isOutputOpen: true, 
  outputLogs: ["System ready."], 

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as AppNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (connection) => set({ edges: addEdge(connection, get().edges) }),
  
  loadGraph: (data) => {
      const { nodes, edges } = filterWorld(data, 'root');
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges, 'TB');
      set({ 
          rawGraph: data, 
          currentWorld: 'root', 
          worldStack: [], 
          nodes: layoutedNodes, 
          edges: layoutedEdges, 
          isSidebarOpen: true,
          outputLogs: [...get().outputLogs, `Loaded ${data.nodes.length} nodes.`]
      });
  },

  setLayoutedWorld: (worldId: string, newStack: string[]) => {
      const { rawGraph } = get();
      const { nodes, edges } = filterWorld(rawGraph, worldId);
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges, 'TB');
      set({ worldStack: newStack, currentWorld: worldId, nodes: layoutedNodes, edges: layoutedEdges });
  },

  enterWorld: (nodeId) => {
      const { currentWorld, worldStack } = get();
      if (currentWorld === nodeId) return;
      const newStack = [...worldStack, currentWorld];
      get().setLayoutedWorld(nodeId, newStack);
  },

  goUp: () => {
      const { worldStack } = get();
      if (worldStack.length === 0) return;
      const newStack = [...worldStack];
      const prevWorld = newStack.pop()!;
      get().setLayoutedWorld(prevWorld, newStack);
  },

  goToWorld: (worldId) => {
      const { rawGraph, currentWorld } = get();
      if (currentWorld === worldId) return; 
      const { stack } = buildWorldPath(rawGraph, worldId);
      const newWorldId = stack.pop()!; 
      const newStack = stack; 
      get().setLayoutedWorld(newWorldId, newStack);
  },
  
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  toggleOutput: () => set((state) => ({ isOutputOpen: !state.isOutputOpen })),
  addOutputLog: (log) => set((state) => ({ outputLogs: [...state.outputLogs, log] })),
  clearOutput: () => set({ outputLogs: [] }),

  injectCode: async (code: string) => {
      const { rawGraph, currentWorld, loadGraph } = get();
      try {
          // Send current graph and code to backend
          const result = await api.injectCode(rawGraph, code, currentWorld);
          
          // Reload the graph with the updated data from server
          if (result.success && result.graph) {
              loadGraph(result.graph);
              // Optionally log to output panel
              get().addOutputLog(`✨ Injected code into ${currentWorld}`);
          }
      } catch (error: any) {
          get().addOutputLog(`❌ Injection error: ${error.message}`);
          console.error(error);
      }
  },

  runProject: async () => {
      const { rawGraph, addOutputLog, toggleOutput } = get();
      try {
          addOutputLog("🚀 Compiling and running...");
          
          // If output panel is closed, open it
          if (!get().isOutputOpen) toggleOutput();

          const result = await api.runGraph(rawGraph);
          
          if (result.success) {
              // Split output by lines and add to logs
              const lines = result.output.split('\n');
              lines.forEach((line: string) => {
                  if (line) addOutputLog(line);
              });
              addOutputLog("✅ Execution finished.");
          } else {
              addOutputLog(`❌ Execution failed: ${result.output}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ System Error: ${error.message}`);
      }
  },
}));

export default useStore;
