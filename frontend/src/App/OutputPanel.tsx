import React, { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useStore, { type RFState } from './store';
import { Terminal, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

const selector = (state: RFState) => ({
  isOpen: state.isOutputOpen,
  toggle: state.toggleOutput,
  logs: state.outputLogs,
  clear: state.clearOutput,
});

export default function OutputPanel() {
  const { isOpen, toggle, logs, clear } = useStore(useShallow(selector));
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when logs change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isOpen]);

  return (
    <div 
        className={`
            flex flex-col bg-slate-900 border-t border-slate-800 transition-all duration-300 ease-in-out
            ${isOpen ? 'h-64' : 'h-9'}
        `}
    >
        {/* Header / Toolbar */}
        <div 
            className="flex items-center justify-between px-4 h-9 bg-slate-800/50 cursor-pointer hover:bg-slate-800 transition-colors"
            onClick={toggle}
        >
            <div className="flex items-center gap-2 text-slate-300 text-xs font-bold uppercase tracking-wider">
                <Terminal size={14} className="text-blue-400" />
                Output
                {logs.length > 0 && (
                    <span className="ml-2 px-1.5 py-0.5 bg-slate-700 rounded-full text-[10px] text-slate-400">
                        {logs.length}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-1">
                <button 
                    onClick={(e) => { e.stopPropagation(); clear(); }}
                    className="p-1 text-slate-500 hover:text-red-400 rounded hover:bg-slate-700/50 transition-colors"
                    title="Clear Output"
                >
                    <Trash2 size={14} />
                </button>
                <div className="w-px h-4 bg-slate-700 mx-1" />
                <button className="p-1 text-slate-500 hover:text-slate-300">
                    {isOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                </button>
            </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden relative">
            <div 
                ref={scrollRef}
                className="absolute inset-0 overflow-y-auto p-3 font-mono text-xs space-y-1"
            >
                {logs.length === 0 ? (
                    <div className="text-slate-600 italic select-none">No output generated.</div>
                ) : (
                    logs.map((log, i) => (
                        <div key={i} className="text-slate-300 border-b border-slate-800/50 pb-1 last:border-0">
                            <span className="text-slate-600 mr-2 select-none">
                                {new Date().toLocaleTimeString()} $
                            </span>
                            {log}
                        </div>
                    ))
                )}
            </div>
        </div>
    </div>
  );
}