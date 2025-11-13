import { Box, Braces, ChevronLeft, ChevronRight, X, FileText, Plus, Trash2 } from 'lucide-react'; // Add Plus, Trash2
import React, { useState } from 'react'; // Import useState
import { useShallow } from 'zustand/react/shallow';
import useStore, { type RFState } from './store';

const selector = (state: RFState) => ({
  rawGraph: state.rawGraph,
  currentWorld: state.currentWorld,
  enterWorld: state.enterWorld,
  isOpen: state.isSidebarOpen,
  toggle: state.toggleSidebar,
  addImport: state.addImport, // <-- NEW
  removeNodes: state.removeNodes, // <-- NEW
});

// --- Selector for imports ---
const importSelector = (state: RFState) => state.rawGraph.nodes.filter(n => n.type === 'IMPORT');

export default function Sidebar() {
  const { rawGraph, currentWorld, enterWorld, isOpen, toggle, addImport, removeNodes } = useStore(useShallow(selector));
  
  // --- FIX: Wrap the selector in useShallow ---
  // This prevents re-renders if the array contents are the same
  const importNodes = useStore(useShallow(importSelector)); 
  
  // --- NEW STATE for import input ---
  const [importCode, setImportCode] = useState('');

  const handleAddImport = () => {
      if (importCode.trim()) {
          addImport(importCode.trim());
          setImportCode(''); // Clear input
      }
  };

  const handleImportKeydown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          handleAddImport();
      }
  };

  const definitions = rawGraph.nodes.filter(
    (n) => n.world === currentWorld && ['FUNCTION_DEF', 'CLASS_DEF'].includes(n.type)
  );

  return (
    // 1. This is the flex-item container that animates its width
    <div 
        className={`
            relative h-full transition-all duration-300 ease-in-out
            flex-shrink-0
            ${isOpen ? 'w-72' : 'w-0'}
        `}
    >
      {/* 2. This is the button, positioned relative to the container above */}
      {/* It's -left-6 to hang off the edge. When parent is w-0, it's at -left-6 */}
      
      <button
        onClick={toggle}
        className={`
            absolute top-1/2 -translate-y-1/2 -translate-x-4/4 z-50
            w-6 h-16 bg-sky-500 hover:bg-sky-700 border border-slate-700
            rounded-l-md flex items-center justify-center text-slate-300
            transition-all hover:shadow-lg
        `}
        title={isOpen ? "Collapse Panel" : "Expand Panel"}
      >
        {/* Icon changes based on state */}
        {isOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
      </button>
      
      {/* 3. This is the panel content, which is a fixed width */}
      {/* It gets *clipped* by its parent (the w-0 div) when closed */}
      <div className="w-72 h-full bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden">
        {/* --- Header --- */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between shrink-0">
          <button onClick={toggle} className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors">
              <X size={18} />
          </button>
          
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              Definitions
              <Box size={16} className="text-blue-400" />
          </h2>
        </div>
        
        {/* --- List (Definitions) --- */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {definitions.length === 0 ? (
              <div className="p-4 text-slate-600 text-sm font-mono italic text-center">
                  No local definitions
              </div>
          ) : definitions.map((node) => {
            const isFunc = node.type === 'FUNCTION_DEF';
            const Icon = isFunc ? Box : Braces;
            const color = isFunc ? 'text-blue-400' : 'text-purple-400';

            return (
              <button
                key={node.id}
                onClick={() => enterWorld(node.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-slate-800/50 border border-transparent hover:border-slate-700 transition-all group text-left"
              >
                <ChevronLeft size={14} className="text-slate-600 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all shrink-0" />
                <div className="flex-1 min-w-0 text-right">
                    <div className="text-slate-200 text-sm font-medium truncate">
                        {node.label}
                    </div>
                    {node.data.params && (
                        <div className="text-slate-500 text-[10px] truncate font-mono mt-0.5">
                            ({(node.data.params as any[]).map(p => p.name).join(', ')})
                        </div>
                    )}
                </div>
                <div className={`p-1.5 rounded-md bg-slate-950 ${color} shrink-0`}>
                    <Icon size={16} />
                </div>
              </button>
            );
          })}
        </div>
        
        {/* --- NEW: Imports Panel --- */}
        <div className="shrink-0 border-t border-slate-800 flex flex-col min-h-0">
            <h2 className="p-4 text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2 shrink-0">
                Imports
                <FileText size={16} className="text-slate-500" />
            </h2>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0 bg-slate-950/50">
                {importNodes.length === 0 ? (
                    <div className="p-4 text-slate-600 text-sm font-mono italic text-center">
                        No imports
                    </div>
                ) : importNodes.map((node) => (
                    <div
                        key={node.id}
                        className="group flex items-center justify-between px-3 py-2 text-slate-400 font-mono text-xs hover:bg-slate-800/50 transition-colors rounded"
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <FileText size={14} className="shrink-0" />
                            <span className="truncate" title={node.label}>{node.label}</span>
                        </div>

                        {/* Delete Button - Visible on Hover */}
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                if(confirm(`Remove ${node.label}?`)) {
                                    removeNodes([node.id]);
                                }
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-red-400 transition-all"
                            title="Remove Import"
                        >
                            <Trash2 size={12} />
                        </button>
                    </div>
                ))}
            </div>
            {/* --- NEW: Add Import Input --- */}
            <div className="p-2 border-t border-slate-800 flex gap-2">
                <input
                    type="text"
                    placeholder="import os"
                    className="flex-1 bg-slate-800 rounded px-2 py-1 text-xs font-mono text-slate-300 outline-none border border-slate-700 focus:border-blue-500"
                    value={importCode}
                    onChange={(e) => setImportCode(e.target.value)}
                    onKeyDown={handleImportKeydown}
                />
                <button 
                    onClick={handleAddImport}
                    className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded"
                    title="Add Import"
                >
                    <Plus size={16} />
                </button>
            </div>
        </div>
        {/* --- END NEW --- */}
        
      </div>
    </div>
  );
}
