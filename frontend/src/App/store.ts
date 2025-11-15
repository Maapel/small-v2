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
    params?: { name: string; optional: boolean }[];
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
        targetHandle?: string;
        sourceHandle?: string;
        port_name?: string;
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

  // Undo/Redo State
  canUndo: boolean;
  canRedo: boolean;
  history: GraphData[];
  historyIndex: number;

  // --- NEW: Code Panel State ---
  isCodeOpen: boolean;
  codeContent: string;
  toggleCode: () => void;
  fetchNodeCode: (nodeId: string) => Promise<string>;

  // Actions
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  loadGraph: (data: GraphData, applyLayout?: boolean) => void;
  enterWorld: (nodeId: string) => void;
  goUp: () => void;
  goToWorld: (worldId: string) => void;
  setLayoutedWorld: (worldId: string, newStack: string[], preservePositions?: boolean) => void; // Added helper
  // --- NEW: ACTIONS ---
  injectCode: (code: string) => Promise<void>;
  runProject: () => Promise<void>;
  removeNodes: (nodeIds: string[]) => Promise<void>;
  addImport: (code: string) => Promise<void>;
  updateNodeLiteral: (nodeId: string, newValue: string) => Promise<void>;
  // --- NEW GRAPH MUTATION ACTIONS ---
  addEdge: (source: string, target: string, edgeType?: string, label?: string, data?: any) => Promise<void>;
  removeEdge: (source: string, target: string, edgeType?: string) => Promise<void>;
  updatePortLiteral: (nodeId: string, portId: string, newValue: string) => Promise<void>;
  addListItem: (listNodeId: string, value?: string) => Promise<void>;
  updateListItem: (listNodeId: string, index: number, newValue: string) => Promise<void>;
  addDictPair: (dictNodeId: string, key?: string, value?: string) => Promise<void>;
  updateDictPair: (dictNodeId: string, index: number, keyValue?: string, valueValue?: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
  saveToHistory: () => void;
  restoreFromHistory: (index: number) => void;
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

                if (sourceNode && sourceNode.type === 'LITERAL') {
                    pairs[index].key = { isWired: false, value: sourceNode.label };
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    pairs[index].key = { isWired: true, value: "[Wired Key]" };
                }
            }
            for (const edge of valueEdges) {
                const index = edge.data?.index ?? 0;
                if (!pairs[index]) pairs[index] = {};
                const sourceNode = getRawNode(graph, edge.source);

                if (sourceNode && sourceNode.type === 'LITERAL') {
                    pairs[index].value = { isWired: false, value: sourceNode.label };
                    collapsedNodeIds.add(sourceNode.id);
                    collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                } else {
                    pairs[index].value = { isWired: true, value: "[Wired Value]" };
                }
            }
            targetNodeData.initialPairs = Object.values(pairs).map((p, arrayIndex) => ({
                key: p.key ? { ...p.key, portId: `key_${arrayIndex}` } : { isWired: false, value: '?', portId: `key_${arrayIndex}` },
                value: p.value ? { ...p.value, portId: `value_${arrayIndex}` } : { isWired: false, value: '?', portId: `value_${arrayIndex}` }
            }));
        }
        
        else {
            const incomingEdges = allEdges.filter(e => e.target === targetNode.id);
            console.log(`DEBUG: filterWorld - ${targetNode.id} has ${incomingEdges.length} incoming edges`);
            for (const edge of incomingEdges) {
                const sourceNode = getRawNode(graph, edge.source);
                console.log(`DEBUG: filterWorld - examining edge ${edge.source} -> ${edge.target} (${edge.type})`);

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
                        else if (edge.type === 'DATA_FLOW' && edge.data?.port_name) portName = edge.data.port_name;
                    }

                    console.log(`DEBUG: filterWorld - edge has port_name: ${edge.data?.port_name}, determined portName: ${portName}`);

                    if (portName) {
                        collapsedNodeIds.add(sourceNode.id);
                        collapsedEdgeIds.add(`${edge.source}-${edge.target}-${edge.type}`);
                        if (targetNodeData.port_defaults) {
                            targetNodeData.port_defaults[portName] = sourceNode.label;
                            console.log(`DEBUG: filterWorld - set port_defaults[${portName}] = "${sourceNode.label}" for ${targetNode.id}`);
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
            } else if (e.type === 'DATA_FLOW') {
                // For DATA_FLOW edges (manually connected edges), use the stored targetHandle
                targetHandle = e.data?.targetHandle || null;
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
  canUndo: false,
  canRedo: false,

  // --- NEW: Code Panel State ---
  isCodeOpen: false,
  codeContent: '',

  // History tracking - TODO: Implement later
  history: [] as GraphData[],
  historyIndex: -1,

  // Helper function to save current state to history - TODO: Implement later
  saveToHistory: () => {},

  // Helper function to restore state from history - TODO: Implement later
  restoreFromHistory: (index: number) => {},

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) as AppNode[] }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: async (connection) => {
      // Use the new backend API instead of local state manipulation
      const { addEdge } = get();
      await addEdge(connection.source, connection.target, "DATA_FLOW", undefined, {
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle
      });
  },

  loadGraph: (data, applyLayout = true) => {
      const { nodes, edges } = filterWorld(data, 'root');
      const layoutedElements = applyLayout ? getLayoutedElements(nodes, edges, 'TB') : { nodes, edges };
      set({
          rawGraph: data,
          currentWorld: 'root',
          worldStack: [],
          nodes: layoutedElements.nodes,
          edges: layoutedElements.edges,
          isSidebarOpen: true,
          outputLogs: [...get().outputLogs, `Loaded ${data.nodes.length} nodes.`]
      });
  },

  setLayoutedWorld: (worldId: string, newStack: string[], preservePositions: boolean = false) => {
      const { rawGraph } = get();
      const { nodes, edges } = filterWorld(rawGraph, worldId);

      let finalNodes = nodes;
      let finalEdges = edges;

      if (!preservePositions) {
          // Only run layout if positions should not be preserved
          const layouted = getLayoutedElements(nodes, edges, 'TB');
          finalNodes = layouted.nodes;
          finalEdges = layouted.edges;
      } else {
          // Preserve existing positions from current nodes
          const currentNodes = get().nodes;
          const positionMap = new Map(currentNodes.map(n => [n.id, n.position]));

          finalNodes = nodes.map(node => ({
              ...node,
              position: positionMap.get(node.id) || { x: 0, y: 0 }
          }));
      }

      set({ worldStack: newStack, currentWorld: worldId, nodes: finalNodes, edges: finalEdges });
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
      const { rawGraph, currentWorld, setLayoutedWorld } = get();
      try {
          // Send current graph and code to backend
          const result = await api.injectCode(rawGraph, code, currentWorld);

          // Reload the graph with the updated data from server, staying in current world
          if (result.success && result.graph) {
              // Update rawGraph first
              set({ rawGraph: result.graph });
              // Then reload the current world view, preserving positions
              setLayoutedWorld(currentWorld, get().worldStack, true);
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

  // --- NEW ACTION IMPLEMENTATIONS ---

  removeNodes: async (nodeIds: string[]) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.removeNodes(rawGraph, nodeIds);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`🗑️ Removed ${nodeIds.length} node(s)`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error removing nodes: ${error.message}`);
      }
  },

  addImport: async (code: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.addImport(rawGraph, code);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`📥 Added import: ${code}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error adding import: ${error.message}`);
      }
  },

  updateNodeLiteral: async (nodeId: string, newValue: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          // Note: This API only works if the source is a LITERAL.
          // We need to find the *source* literal node.
          const { edges } = get();
          const edge = edges.find(e => e.target === nodeId); // Simplified: finds first

          if (!edge) {
             // This is likely an "in-port literal" on a CALL node etc.
             // This logic needs to be much smarter, finding the *implied* literal.
             // For now, we'll log a placeholder.
             console.warn("updateNodeLiteral needs complex logic to find/create the literal node");
             addOutputLog(`(DUMMY) ✏️ Updated literal for ${nodeId}`);
             return;
          }

          // If a literal is wired, update *that* node
          const sourceNodeId = edge.source;
          const result = await api.updateNodeLiteral(rawGraph, sourceNodeId, newValue);

          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`✏️ Updated literal ${sourceNodeId} to ${newValue}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error updating literal: ${error.message}`);
      }
  },

  // --- NEW GRAPH MUTATION ACTION IMPLEMENTATIONS ---

  addEdge: async (source: string, target: string, edgeType: string = "DATA_FLOW", label?: string, data?: any) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.addEdge(rawGraph, source, target, edgeType, label, data);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`🔗 Added edge ${source} -> ${target}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error adding edge: ${error.message}`);
      }
  },

  removeEdge: async (source: string, target: string, edgeType?: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.removeEdge(rawGraph, source, target, edgeType);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`🔌 Removed edge ${source} -> ${target}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error removing edge: ${error.message}`);
      }
  },

  updatePortLiteral: async (nodeId: string, portId: string, newValue: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          console.log(`DEBUG: updatePortLiteral called with nodeId=${nodeId}, portId=${portId}, newValue=${newValue}`);
          console.log(`DEBUG: Current graph has ${rawGraph.nodes.length} nodes, ${rawGraph.edges.length} edges`);

          const result = await api.updatePortLiteral(rawGraph, nodeId, portId, newValue);

          if (result.success) {
              console.log(`DEBUG: updatePortLiteral API call successful`);
              console.log(`DEBUG: Updated graph has ${result.graph.nodes.length} nodes, ${result.graph.edges.length} edges`);

              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`✏️ Updated port ${portId} on ${nodeId} to ${newValue}`);
          } else {
              console.log(`DEBUG: updatePortLiteral API call failed: ${result.error}`);
          }
      } catch (error: any) {
          console.log(`DEBUG: updatePortLiteral exception: ${error.message}`);
          addOutputLog(`❌ Error updating port literal: ${error.message}`);
      }
  },

  addListItem: async (listNodeId: string, value: string = "''") => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.addListItem(rawGraph, listNodeId, value);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`➕ Added list item to ${listNodeId}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error adding list item: ${error.message}`);
      }
  },

  updateListItem: async (listNodeId: string, index: number, newValue: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.updateListItem(rawGraph, listNodeId, index, newValue);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`✏️ Updated list item ${index} in ${listNodeId} to ${newValue}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error updating list item: ${error.message}`);
      }
  },

  addDictPair: async (dictNodeId: string, key: string = "'new_key'", value: string = "''") => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.addDictPair(rawGraph, dictNodeId, key, value);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              addOutputLog(`➕ Added dict pair to ${dictNodeId}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error adding dict pair: ${error.message}`);
      }
  },

  updateDictPair: async (dictNodeId: string, index: number, keyValue?: string, valueValue?: string) => {
      const { rawGraph, currentWorld, setLayoutedWorld, addOutputLog } = get();
      try {
          const result = await api.updateDictPair(rawGraph, dictNodeId, index, keyValue, valueValue);
          if (result.success) {
              // Update rawGraph and reload current world view, preserving positions
              set({ rawGraph: result.graph });
              setLayoutedWorld(currentWorld, get().worldStack, true);
              const changes = [];
              if (keyValue !== undefined) changes.push(`key=${keyValue}`);
              if (valueValue !== undefined) changes.push(`value=${valueValue}`);
              addOutputLog(`✏️ Updated dict pair ${index} in ${dictNodeId}: ${changes.join(', ')}`);
          }
      } catch (error: any) {
          addOutputLog(`❌ Error updating dict pair: ${error.message}`);
      }
  },

  // --- NEW: Code Panel Actions ---
  toggleCode: () => {
      const { isCodeOpen } = get();
      if (!isCodeOpen) {
          // Switching TO Code Panel: Fetch code for current world
          const { rawGraph, currentWorld } = get();
          // Use setStateApproximation to set code content
          (async () => {
              try {
                  const result = await api.synthesize(rawGraph, undefined, currentWorld);
                  if (result.success) {
                      set({ isCodeOpen: true, codeContent: result.code });
                  }
              } catch (e) {
                  console.error(e);
                  set({ isCodeOpen: true, codeContent: "# Error fetching code" });
              }
          })();
      } else {
          // Switching OFF Code Panel
          set({ isCodeOpen: false });
      }
  },

  fetchNodeCode: async (nodeId: string) => {
      const { rawGraph } = get();
      try {
          const result = await api.synthesize(rawGraph, nodeId);
          return result.success ? result.code : "# Error";
      } catch (e) {
          return "# Error";
      }
  },

  undo: () => {
    // TODO: Implement Undo functionality later
    console.log('Undo clicked - TODO: Implement later');
  },

  redo: () => {
    // TODO: Implement Redo functionality later
    console.log('Redo clicked - TODO: Implement later');
  },

}));

export default useStore;
