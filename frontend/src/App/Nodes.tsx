import React, { memo, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { 
    Box, Braces, Activity, Database, Type, Calculator, 
    ArrowRightFromLine, ExternalLink, ChevronDown, ChevronRight, 
    Share, CornerUpLeft // New Icons
} from 'lucide-react';

// --- Reusable Port Component ---
const Port = memo(({ label, id, isOptional = false }: { label: string, id: string, isOptional?: boolean }) => (
    <div className="relative flex items-center h-7 px-3">
        <Handle 
            type="target" 
            position={Position.Left} 
            id={id}
            className="!w-3 !h-3 !border-2 !bg-slate-700 !border-slate-500 hover:!bg-blue-500"
            style={{ left: '-6px' }}
        />
        <label className={`text-xs font-mono truncate ${isOptional ? 'text-slate-500' : 'text-slate-300'}`}>
            {label}
        </label>
    </div>
));

// --- Blender-Style Base Node ---
const BlenderNode = memo(({ data, icon: Icon, color, children, hasOutput = true, outputLabel = "value" }: any) => {
    const [isExpanded, setIsExpanded] = useState(false);
    // NEW: State for the usages popover
    const [showUsages, setShowUsages] = useState(false);
    
    const params = data.params || [];
    const requiredParams = params.filter((p: any) => !p.optional);
    const optionalParams = params.filter((p: any) => p.optional);
    const hasOptional = optionalParams.length > 0;

    // NEW: Handler for jumping to a usage
    const handleUsageJump = (worldId: string) => {
        window.dispatchEvent(new CustomEvent('go-to-world', { detail: worldId }));
        setShowUsages(false); // Close popover on click
    };

    return (
        <div 
          className="bg-slate-800/80 backdrop-blur-md rounded-md border border-slate-700 shadow-xl min-w-[220px]"
          style={{ borderColor: color, color: '#f8fafc' }}
        >
            <div className="flex items-center gap-2 p-2 border-b" style={{ borderColor: color }}>
                <Icon className="w-4 h-4" style={{ color: color }} />
                <span className="text-sm font-bold truncate text-slate-100">{data.label}</span>
                {children} 
            </div>

            <div className="flex justify-between">
                <div className="py-2 space-y-1 min-w-0">
                    {requiredParams.map((p: any) => 
                        <Port key={p.name} label={p.name} id={p.name} />
                    )}
                    
                    {isExpanded && optionalParams.map((p: any) => 
                        <Port key={p.name} label={p.name} id={p.name} isOptional={true} />
                    )}
                </div>

                {hasOutput && (
                    <div className="p-2 flex items-center relative">
                        {data.exportedToWorlds && data.exportedToWorlds.length > 0 && (
                            <button 
                                onClick={() => setShowUsages(s => !s)} 
                                className="text-cyan-400 absolute -left-1 top-2.5 p-0.5 rounded-full hover:bg-slate-700" 
                                title="Value is used in a child world. Click to see usages."
                            >
                                <Share size={12} />
                            </button>
                        )}
                        <label className="text-xs font-mono text-slate-300 mr-5">{outputLabel}</label>
                        <Handle 
                            type="source" 
                            position={Position.Right} 
                            id="output"
                            className="!w-3 !h-3 !border-2 !bg-slate-700 !border-slate-500 hover:!bg-green-500"
                            style={{ right: '-6px' }}
                        />
                        
                        {/* UPDATED: Usages Popover now shows full path */}
                        {showUsages && data.exportedToWorlds && (
                            <div className="absolute top-full right-0 mt-2 w-56 bg-slate-900 border border-slate-700 rounded-md shadow-lg z-10 p-1">
                                <div className="text-xs font-bold text-slate-400 px-2 py-1 border-b border-slate-800">Used In:</div>
                                {data.exportedToWorlds.map((world: any) => (
                                    <button 
                                        key={world.worldId} 
                                        onClick={() => handleUsageJump(world.worldId)}
                                        className="w-full text-left text-xs text-cyan-400 hover:bg-slate-800 rounded px-2 py-1 font-mono truncate"
                                        title={world.fullPath}
                                    >
                                        {/* Show the full path */}
                                        {world.fullPath}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {hasOptional && (
                <button 
                    onClick={() => setIsExpanded(prev => !prev)}
                    className="w-full flex items-center justify-center p-1 border-t border-slate-700 text-slate-500 hover:text-slate-300 hover:bg-slate-700/50"
                >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="text-xs ml-1 font-mono">{isExpanded ? 'Collapse' : 'Expand Options'}</span>
                </button>
            )}
        </div>
    );
});

// --- Concrete Nodes ---

export const FunctionDefNode = (props: NodeProps) => (
    <BlenderNode {...props} icon={Box} color="#3b82f6" hasOutput={false} />
);

export const CallNode = memo((props: NodeProps) => {
    const { data } = props;
    const handleZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (data.target_world) {
            // Fire event that App.tsx is listening for
            window.dispatchEvent(new CustomEvent('enter-world', { detail: data.target_world }));
        }
    };

    return (
        <BlenderNode {...props} icon={Activity} color="#f59e0b" outputLabel="return">
             {data.target_world && (
                 <button 
                    onClick={handleZoom} 
                    className="ml-auto p-1 text-slate-500 hover:text-blue-400" 
                    title="Zoom into definition"
                >
                     <ExternalLink size={12} />
                 </button>
             )}
        </BlenderNode>
    );
});

export const VariableNode = (props: NodeProps) => {
    const { data } = props;
    const isClosure = data.mode === 'closure_read';
    
    const color = isClosure ? "#22d3ee" : "#10b981"; // Cyan for closure
    const icon = isClosure ? Share : Database; // Share icon for closure
    
    const inputParams = data.mode === 'write' ? [{ name: "input", optional: false }] : [];
    const hasOutput = true; 

    const handleJump = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (data.origin_world) {
            // Fire event that App.tsx is listening for
            window.dispatchEvent(new CustomEvent('go-to-world', { detail: data.origin_world }));
        }
    };

    return (
        <BlenderNode 
            {...props} 
            icon={icon} 
            color={color} 
            hasOutput={hasOutput}
            data={{...data, params: inputParams}}
            outputLabel="value"
        >
            {isClosure && (
                 <button 
                    onClick={handleJump} 
                    className="ml-auto p-1 text-slate-500 hover:text-cyan-400" 
                    title="Go to original definition"
                >
                     <CornerUpLeft size={12} />
                 </button>
             )}
        </BlenderNode>
    );
};

export const LiteralNode = (props: NodeProps) => (
    <BlenderNode {...props} icon={Type} color="#64748b" 
        data={{...props.data, params: []}}
        outputLabel="value" 
    />
);

export const OperatorNode = (props: NodeProps) => (
    <BlenderNode 
        {...props} 
        icon={Calculator} 
        color="#ef4444"
        outputLabel="result"
        // Overwrite data to create fixed operand ports
        data={{
            ...props.data,
            params: [
                { name: "operand_0", optional: false },
                { name: "operand_1", optional: false },
            ]
        }}
    />
);

export const ReturnNode = (props: NodeProps) => (
    <BlenderNode 
        {...props} 
        icon={ArrowRightFromLine} 
        color="#ec4899" 
        hasOutput={false} // Return node is a final sink
        data={{
            ...props.data,
            params: [{ name: "value", optional: false }]
        }}
    />
);

export const ClassDefNode = (props: NodeProps) => (
    <BlenderNode {...props} icon={Braces} color="#8b5cf6" hasOutput={false} />
);

export const nodeTypes = {
  FUNCTION_DEF: FunctionDefNode,
  CLASS_DEF: ClassDefNode,
  CALL: CallNode,
  VARIABLE: VariableNode,
  LITERAL: LiteralNode,
  OPERATOR: OperatorNode,
  RETURN: ReturnNode,
};