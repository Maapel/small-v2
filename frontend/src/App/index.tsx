import React, { useCallback, useState, useEffect } from 'react';
import { ReactFlow, Controls, Background, MiniMap, Panel, type Node } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import useStore, { type RFState } from './store';
import { nodeTypes } from './Nodes';
import Sidebar from './Sidebar';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, FileJson, Menu } from 'lucide-react';

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
});

// --- NEW: Helper function to build breadcrumb paths ---
const buildBreadcrumbPath = (graph: RFState['rawGraph'], worldStack: string[], currentWorld: string) => {
    const path = [...worldStack, currentWorld];
    return path.map(worldId => {
        if (worldId === 'root') return { id: 'root', label: 'root' };
        const node = graph.nodes.find(n => n.id === worldId);
        return { id: worldId, label: node?.label || '...' };
    });
};
// --- END NEW ---

export default function Flow() {
  const { 
    nodes, edges, onNodesChange, onEdgesChange, onConnect, 
    loadGraph, enterWorld, goUp, goToWorld, 
    currentWorld, worldStack, rawGraph,
    isSidebarOpen, toggleSidebar
  } = useStore(useShallow(selector));

  const [isFileLoaded, setIsFileLoaded] = useState(false);

  // --- UPDATED: Listen for BOTH world-changing events ---
  useEffect(() => {
    const handleEnter = (e: any) => enterWorld(e.detail);
    const handleGoTo = (e: any) => goToWorld(e.detail); // <--- This now works
    
    window.addEventListener('enter-world', handleEnter);
    window.addEventListener('go-to-world', handleGoTo); // <-- NEW LISTENER
    
    return () => {
        window.removeEventListener('enter-world', handleEnter);
        window.removeEventListener('go-to-world', handleGoTo); // <-- NEW CLEANUP
    };
  }, [enterWorld, goToWorld]); // Add goToWorld to dependency array

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
      // This is now a fallback, as CALL nodes use the button
      if (node.type === 'FUNCTION_DEF' || node.type === 'CLASS_DEF') {
          enterWorld(node.id);
      }
  }, [enterWorld]);

  const onDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); 
      const file = e.dataTransfer.files[0];
      if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
              try { 
                  loadGraph(JSON.parse(ev.target?.result as string));
                  setIsFileLoaded(true);
              } catch (err) { alert("Invalid graph JSON"); }
          };
          reader.readAsText(file);
      }
  }, [loadGraph]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  // --- REMOVED getWorldLabel, replaced by buildBreadcrumbPath ---

  // --- CENTERED DROPZONE LOGIC ---
  if (!isFileLoaded) {
    return (
        <div 
            className="fixed inset-0 w-screen h-screen bg-slate-950 flex flex-col items-center justify-center pointer-events-auto text-slate-600 z-50" 
            onDrop={onDrop} 
            onDragOver={onDragOver}
        >
            <FileJson size={48} className="mb-4 opacity-50" />
            <p className="text-xl font-medium">Drop graph.json here</p>
        </div>
    );
  }

  // --- MAIN APP (FILE LOADED) ---
  return (
    <div 
        className="fixed inset-0 w-screen h-screen bg-slate-950 flex overflow-hidden" 
        style={{ width: '100%', height: '100%' }} 
        onDrop={onDrop} 
        onDragOver={onDragOver}
    >
      {/* MAIN CANVAS AREA (NOW CHILD 1) */}
      <div className="flex-1 relative h-full min-w-0">
        <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeDoubleClick={onNodeDoubleClick}
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
                    return '#334155';
                }}
                maskColor="rgba(15, 23, 42, 0.6)" 
                className="!bg-slate-900" 
            />
            
            {/* UPDATED NAVIGATION PANEL */}
            <Panel 
                position="top-right" 
                className={`
                    flex items-center gap-3 p-2 bg-slate-900/90 backdrop-blur-md rounded-xl border border-slate-800 m-4 
                    transition-all duration-300 ease-in-out
                    ${isSidebarOpen && isFileLoaded ? 'mr-72' : ''} 
                `}
            >
                {/* UPDATED: Breadcrumbs now show full path */}
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
                
                {/* Back Button */}
                <button 
                    onClick={goUp} 
                    disabled={worldStack.length === 0}
                    className="p-2 rounded-lg hover:bg-slate-800 disabled:opacity-30 text-slate-400 transition-colors"
                >
                    <ArrowLeft size={20} />
                </button>
                
                <div className="h-6 w-px bg-slate-800" />
                
                {/* Sidebar Toggle Button */}
                <button 
                    onClick={toggleSidebar} 
                    className={`p-2 rounded-lg hover:bg-slate-800 text-slate-400 transition-colors ${!isSidebarOpen ? 'text-blue-400' : ''}`}
                    title="Toggle Definitions"
                >
                    <Menu size={20} />
                </button>
            </Panel>
            
        </ReactFlow>
      </div>
      
      {/* RIGHT SIDEBAR (NOW CHILD 2) */}
      {isFileLoaded && <Sidebar />}
    </div>
  );
}
