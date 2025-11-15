import React, { useCallback, useState, useEffect } from 'react';
import { ReactFlow, Controls, Background, MiniMap, Panel, type Node, useReactFlow } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import useStore, { type RFState } from './store';
import { nodeTypes } from './Nodes';
import Sidebar from './Sidebar';
import OutputPanel from './OutputPanel'; // --- NEW IMPORT ---
import '@xyflow/react/dist/style.css';
import { ArrowLeft, FileJson, Menu, FileText, Terminal, Play, Undo, Redo, Code, FilePlus, Save, Download } from 'lucide-react'; // Added File, Save, Download
import InjectModal from './InjectModal';
import { api } from './api'; // Import api for file operations

const selector = (state: RFState) => ({
  nodes: state.nodes,
  edges: state.edges,
  onNodesChange: state.onNodesChange,
  onEdgesChange: state.onEdgesChange,
  onConnect: state.onConnect,
  loadGraph: state.loadGraph,
  enterWorld: state.enterWorld,
  goUp: state.goUp,
  goToWorld: state.goToWorld,
  currentWorld: state.currentWorld,
  worldStack: state.worldStack,
  rawGraph: state.rawGraph,
  isSidebarOpen: state.isSidebarOpen,
  toggleSidebar: state.toggleSidebar,
  toggleOutput: state.toggleOutput, // --- NEW ---
  isOutputOpen: state.isOutputOpen, // --- NEW ---
  // --- NEW: Code Panel ---
  isCodeOpen: state.isCodeOpen,
  codeContent: state.codeContent,
  toggleCode: state.toggleCode,
  // --- NEW: File Actions ---
  resetGraph: state.resetGraph,
  loadGraphFromPy: state.loadGraphFromPy,
  saveGraph: state.saveGraph,
  injectCode: state.injectCode,
  runProject: state.runProject,
  removeNodes: state.removeNodes,
  removeEdge: state.removeEdge,
  undo: state.undo,
  redo: state.redo,
});

// --- Helper function to build breadcrumb paths ---
const buildBreadcrumbPath = (graph: RFState['rawGraph'], worldStack: string[], currentWorld: string) => {
    const path = [...worldStack, currentWorld];
    return path.map(worldId => {
        if (worldId === 'root') return { id: 'root', label: 'root' };
        if (worldId === 'world_imports') return { id: 'world_imports', label: 'imports' };
        const node = graph.nodes.find(n => n.id === worldId);
        return { id: worldId, label: node?.label || '...' };
    });
};

const ZOOMABLE_NODE_TYPES = [
    'FUNCTION_DEF', 'CLASS_DEF',
    'FOR_BLOCK', 'WHILE_BLOCK', 'IF_BLOCK',
    'ELIF_BLOCK', 'ELSE_BLOCK',
    'TRY_BLOCK', 'EXCEPT_BLOCK'
];

export default function Flow() {
  const {
    nodes, edges, onNodesChange, onEdgesChange, onConnect,
    loadGraph, enterWorld, goUp, goToWorld,
    currentWorld, worldStack, rawGraph,
    isSidebarOpen, toggleSidebar,
    toggleOutput, isOutputOpen,
    // --- NEW: Code Panel ---
    isCodeOpen, toggleCode, codeContent,
    // --- NEW: File Actions ---
    resetGraph, loadGraphFromPy, saveGraph,
    injectCode,
    runProject,
    removeNodes,
    removeEdge,
    undo,
    redo
  } = useStore(useShallow(selector));
  const { getNodes } = useReactFlow();

  // --- NEW STATE ---
  const [modalState, setModalState] = useState({ isOpen: false, x: 0, y: 0 });

  // --- NEW HANDLER ---
  const onPaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent<Element, MouseEvent>) => {
      event.preventDefault();
      setModalState({
          isOpen: true,
          x: event.clientX,
          y: event.clientY,
      });
  }, []);

  const handleInject = (code: string) => {
      injectCode(code);
  };

  const [isFileLoaded, setIsFileLoaded] = useState(false);

  useEffect(() => {
    const handleEnter = (e: any) => enterWorld(e.detail);
    const handleGoTo = (e: any) => goToWorld(e.detail);

    window.addEventListener('enter-world', handleEnter);
    window.addEventListener('go-to-world', handleGoTo);

    return () => {
        window.removeEventListener('enter-world', handleEnter);
        window.removeEventListener('go-to-world', handleGoTo);
    };
  }, [enterWorld, goToWorld]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
      if (node.type && ZOOMABLE_NODE_TYPES.includes(node.type)) {
          enterWorld(node.id);
      }
  }, [enterWorld]);

  const onDrop = useCallback(async (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation();
      const file = e.dataTransfer.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              const text = ev.target?.result as string;

              if (file.name.endsWith('.json')) {
                  try {
                      loadGraph(JSON.parse(text));
                      setIsFileLoaded(true);
                  } catch (err) { alert("Invalid graph JSON"); }
              } else if (file.name.endsWith('.py')) {
                  try {
                      loadGraphFromPy(text);
                      setIsFileLoaded(true);
                  } catch (err: any) {
                      alert(`Failed to parse Python: ${err.message}`);
                  }
              } else {
                  alert("Please drop a .json or .py file");
              }
          };
          reader.readAsText(file);
      }
  }, [loadGraph, loadGraphFromPy]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  // --- NEW HANDLER for Deletion ---
  const onNodesDelete = useCallback((changes: any[]) => {
      const nodeIds = changes.map(c => c.id);
      removeNodes(nodeIds);
  }, [removeNodes]);

  // --- NEW HANDLER for Edge Deletion ---
  const onEdgesDelete = useCallback((changes: any[]) => {
      // Remove edges one by one
      changes.forEach(edge => {
        removeEdge(edge.source, edge.target, edge.type);
      });
  }, [removeEdge]);

  if (!isFileLoaded) {
    return (
        <div
            className="fixed inset-0 w-screen h-screen bg-slate-950 flex flex-col items-center justify-center pointer-events-auto text-slate-600 z-50"
            onDrop={onDrop}
            onDragOver={onDragOver}
        >
            <FileJson size={48} className="mb-4 opacity-50" />
            <p className="text-xl font-medium mb-6">Drop .json or .py file here</p>

            <div className="flex gap-4">
                <button
                    onClick={() => {
                        resetGraph();
                        setIsFileLoaded(true);
                    }}
                    className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors"
                >
                    Create New Project
                </button>
            </div>
        </div>
    );
  }

  return (
    <div
        className="fixed inset-0 w-screen h-screen bg-slate-950 flex overflow-hidden"
        style={{ width: '100%', height: '100%' }}
        onDrop={onDrop}
        onDragOver={onDragOver}
    >
      {/* MAIN LEFT COLUMN (Canvas + Output) */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">

        {/* CANVAS/CODE AREA (Switch between graph and code) */}
        <div className="flex-1 relative min-h-0">
            {isCodeOpen ? (
                // --- CODE EDITOR VIEW: Replaces canvas entirely ---
                <div className="h-full bg-[#1e293b]">
                    {/* Mini toolbar for code view */}
                    <div className="flex items-center justify-between p-2 bg-slate-800 border-b border-slate-700">
                        <div className="flex items-center gap-4">
                            {/* World breadcrumb */}
                            <div className="flex items-center gap-1 text-xs font-mono">
                                {buildBreadcrumbPath(rawGraph, worldStack, currentWorld).map((world, i, arr) => (
                                    <React.Fragment key={world.id}>
                                        <span className={i === arr.length - 1 ? 'text-blue-300 font-bold' : 'text-slate-400'}>
                                            {world.label}
                                        </span>
                                        {i < arr.length - 1 && <span className="text-slate-600">/</span>}
                                    </React.Fragment>
                                ))}
                            </div>
                            <span className="text-slate-400 text-xs">Code Editor</span>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500 mr-2">Graph:</span>
                            <button
                                onClick={toggleCode}
                                className="flex items-center gap-2 px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-slate-300 hover:text-white transition-colors"
                                title="Switch back to Graph View"
                            >
                                <ArrowLeft size={14} />
                                <span>Graph</span>
                            </button>
                        </div>
                    </div>

                    {/* Code Editor Area */}
                    <pre className="font-mono text-sm text-green-400 whitespace-pre-wrap p-4 h-full overflow-auto leading-relaxed">
                        {codeContent || "# No code content available"}
                    </pre>
                </div>
            ) : (
                // --- VISUAL GRAPH VIEW ---
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onEdgesDelete={onEdgesDelete}
                    nodeTypes={nodeTypes}
                    onNodeDoubleClick={onNodeDoubleClick}
                    onPaneContextMenu={onPaneContextMenu}
                    onNodesDelete={onNodesDelete}
                    deleteKeyCode={['Backspace', 'Delete']}
                    fitView
                    minZoom={0.1}
                    className="bg-slate-950 h-full"
                >
                    <Background color="#1e293b" gap={16} />
                    <Controls className="!bg-slate-800 !border-slate-700 [&>button]:!fill-slate-400" />
                    <MiniMap
                        nodeColor={(n) => {
                            if (n.type === 'FUNCTION_DEF') return '#3b82f6';
                            if (n.type === 'CLASS_DEF') return '#8b5cf6';
                            if (n.type && n.type.endsWith('_BLOCK')) return '#f97316';
                            return '#334155';
                        }}
                        maskColor="rgba(15, 23, 42, 0.6)"
                        className="!bg-slate-900"
                    />

                    {/* FLOATING TOOLBAR */}
                    <Panel
                        position="top-right"
                        className={`
                            flex items-center gap-3 p-2 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 m-4
                            transition-all duration-300 ease-in-out
                            ${isSidebarOpen && isFileLoaded ? 'mr-72' : ''}
                        `}
                    >
                        {/* File Operations */}
                        <div className="flex items-center gap-1 mr-4 border-r border-slate-700 pr-4">
                            <button
                                onClick={resetGraph}
                                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
                                title="New Empty Graph"
                            >
                                <FilePlus size={20} />
                            </button>

                            <button
                                onClick={() => saveGraph()}
                                className="p-2 text-slate-400 hover:text-blue-400 hover:bg-slate-800 rounded"
                                title="Save Graph (JSON)"
                            >
                                <Save size={20} />
                            </button>

                            <button
                                onClick={async () => {
                                    try {
                                        const result = await api.synthesize(rawGraph);
                                        if (result.success) {
                                            const blob = new Blob([result.code], { type: 'text/plain' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            a.download = 'script.py';
                                            a.click();
                                            URL.revokeObjectURL(url);
                                        }
                                    } catch (e) { alert("Export failed"); }
                                }}
                                className="p-2 text-slate-400 hover:text-green-400 hover:bg-slate-800 rounded"
                                title="Export Python Code"
                            >
                                <Download size={20} />
                            </button>
                        </div>

                        {/* World Navigation */}
                        <div className="flex items-center gap-1 text-sm font-mono mr-2">
                            {buildBreadcrumbPath(rawGraph, worldStack, currentWorld).map((world, i, arr) => (
                                <React.Fragment key={world.id}>
                                    <span
                                        onClick={() => goToWorld(world.id)}
                                        className={`cursor-pointer px-2 py-1 rounded hover:bg-slate-800 ${i === arr.length - 1 ? 'text-blue-400 font-bold' : 'text-slate-500'}`}
                                    >
                                        {world.label}
                                    </span>
                                    {i < arr.length - 1 && <span className="text-slate-700">/</span>}
                                </React.Fragment>
                            ))}
                        </div>

                        <button
                            onClick={goUp}
                            disabled={worldStack.length === 0}
                            className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-400 transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>

                        <div className="h-6 w-px bg-slate-800" />

                        <button
                            onClick={() => goToWorld('world_imports')}
                            className={`p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors ${currentWorld === 'world_imports' ? 'text-blue-400' : ''}`}
                            title="Go to Imports"
                        >
                            <FileText size={20} />
                        </button>

                        {/* --- NEW: Toggle Output Button --- */}
                        <button
                            onClick={toggleOutput}
                            className={`p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors ${isOutputOpen ? 'text-blue-400' : ''}`}
                            title="Toggle Output Panel"
                        >
                            <Terminal size={20} />
                        </button>

                        <div className="h-6 w-px bg-slate-800" />

                        <button
                            onClick={undo}
                            disabled={true}
                            className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-400 transition-colors"
                            title="Undo (TODO: Implement later)"
                        >
                            <Undo size={20} />
                        </button>

                        <button
                            onClick={redo}
                            disabled={true}
                            className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-400 transition-colors"
                            title="Redo (TODO: Implement later)"
                        >
                            <Redo size={20} />
                        </button>

                        <div className="h-6 w-px bg-slate-800" />

                        <button
                            onClick={runProject}
                            className="p-2 rounded-lg hover:bg-slate-800 text-green-400 hover:text-green-300 transition-colors"
                            title="Run Project"
                        >
                            <Play size={20} />
                        </button>

                        <div className="h-6 w-px bg-slate-800" />

                        {/* --- NEW: Toggle Code View Button --- */}
                        <button
                            onClick={toggleCode}
                            className={`p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors ${isCodeOpen ? 'text-slate-400' : ''}`}
                            title={isCodeOpen ? "Switch to Code View" : "Switch to Graph View"}
                        >
                            <Code size={20} />
                        </button>

                        <div className="h-6 w-px bg-slate-800" />

                        <button
                            onClick={toggleSidebar}
                            className={`p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors ${!isSidebarOpen ? 'text-blue-400' : ''}`}
                            title="Toggle Definitions"
                        >
                            <Menu size={20} />
                        </button>
                    </Panel>

                </ReactFlow>
            )}
        </div>

        {/* OUTPUT PANEL (At Bottom of Left Column) */}
        {isFileLoaded && <OutputPanel />}

      </div>

      {/* RIGHT SIDEBAR (Child 2) */}
      {isFileLoaded && <Sidebar />}

      {/* --- NEW: MODAL COMPONENT --- */}
      <InjectModal
          isOpen={modalState.isOpen}
          onClose={() => setModalState(prev => ({ ...prev, isOpen: false }))}
          onSubmit={handleInject}
          position={{ x: modalState.x, y: modalState.y }}
      />
    </div>
  );
}
