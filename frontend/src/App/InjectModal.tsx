import React, { useState, useEffect, useRef } from 'react';
import { X, Play } from 'lucide-react';

interface InjectModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (code: string) => void;
    position: { x: number, y: number };
}

export default function InjectModal({ isOpen, onClose, onSubmit, position }: InjectModalProps) {
    const [code, setCode] = useState('');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = () => {
        if (!code.trim()) return;
        onSubmit(code);
        setCode('');
        onClose();
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        // Submit on Ctrl+Enter
        if (e.key === 'Enter' && e.ctrlKey) {
            handleSubmit();
        }
        // Close on Escape
        if (e.key === 'Escape') {
            onClose();
        }
    };

    return (
        <div 
            className="fixed z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden w-96"
            style={{ 
                top: Math.min(position.y, window.innerHeight - 300), 
                left: Math.min(position.x, window.innerWidth - 400) 
            }}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
                <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">Inject Code</span>
                <button onClick={onClose} className="text-slate-500 hover:text-slate-300">
                    <X size={14} />
                </button>
            </div>

            {/* Input */}
            <div className="p-2 bg-slate-950">
                <textarea
                    ref={inputRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type Python code here... (Ctrl+Enter to run)"
                    className="w-full h-32 bg-transparent text-slate-300 font-mono text-xs resize-none outline-none"
                    spellCheck={false}
                />
            </div>

            {/* Footer */}
            <div className="flex justify-end px-3 py-2 bg-slate-800 border-t border-slate-700">
                <button 
                    onClick={handleSubmit}
                    className="flex items-center gap-2 px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition-colors"
                >
                    <Play size={12} />
                    Inject
                </button>
            </div>
        </div>
    );
}
