import React, { useCallback, useState, useEffect } from 'react';
import { ReactFlow, Controls, Background, MiniMap, Panel, type Node } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import useStore, { type RFState } from './store';
import { nodeTypes } from './Nodes';
import Sidebar from './Sidebar';
import '@xyflow/react/dist/style.css';
// Menu icon is no longer needed here
import { ArrowLeft, FileJson } from 'lucide-react'; 

// Selector no longer needs to pull toggleSidebar
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
  isSidebarOpen: state.isSidebarOpen, // Still needed for panel animation
});

export default function Flow() {
  const { 
    nodes, edges, onNodesChange, onEdgesChange, onConnect, 
    loadGraph, enterWorld, goUp, goToWorld, 
    currentWorld, worldStack, rawGraph,
    isSidebarOpen // We no longer get toggleSidebar here
  } = useStore(useShallow(selector));

  const [isFileLoaded, setIsFileLoaded] = useState(false);

  // LISTEN FOR ZOOM EVENTS FROM NODES
  useEffect(() => {
    const handler = (e: CustomEvent<string>) => {
        if (e.detail) {
            enterWorld(e.detail);
        }
    };
    // Cast to any for the event listener type compatibility if needed by strict TS
    window.addEventListener('enter-world', handler as EventListener);
    return () => window.removeEventListener('enter-world', handler as EventListener);
  }, [enterWorld]);

  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
      if (node.type === 'FUNCTION_DEF' || node.type === 'CLASS_DEF') {
          enterWorld(node.id);
      }
  }, [enterWorld]);

  const onDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); 
      const file = e.dataTransfer.files[0];
      if (file) {
          console.log("📂 File dropped:", file.name); 
          const reader = new FileReader();
          reader.onload = (ev) => {
              try { 
                  const json = JSON.parse(ev.target?.result as string);
                  console.log("✅ JSON parsed successfully, loading graph..."); 
                  loadGraph(json);
                  setIsFileLoaded(true);
              } catch (err) { 
                  console.error("❌ JSON Parse Error:", err); 
                  alert("Invalid graph JSON"); 
              } 
          };
          reader.readAsText(file);
      }
  }, [loadGraph]);

  const onDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  const getWorldLabel = (id: string) => {
      if (id === 'root') return 'root';
      const node = rawGraph.nodes.find(n => n.id === id);
      return node ? node.label : id.substring(0, 8);
  };
  
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
        className="fixed inset-0 w-screen h-screen bg-slate-950 flex overflow-hidden" // Added overflow-hidden
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
                {/* Breadcrumbs */}
                <div className="flex items-center gap-1 text-sm font-mono mr-2">
                    {[...worldStack, currentWorld].map((worldId, i, arr) => (
                        <React.Fragment key={worldId}>
                            <span 
                                onClick={() => goToWorld(worldId)}
                                className={`cursor-pointer px-2 py-1 rounded hover:bg-slate-800 ${i === arr.length - 1 ? 'text-blue-400 font-bold' : 'text-slate-500'}`}
                            >
                                {getWorldLabel(worldId)}
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
                
                {/* REMOVED THE DIVIDER AND MENU BUTTON */}
                
            </Panel>
            
        </ReactFlow>
      </div>
      
      {/* RIGHT SIDEBAR (NOW CHILD 2) */}
      {isFileLoaded && <Sidebar />}
    </div>
  );
}