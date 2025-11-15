import React, { memo, useState, useCallback, useMemo } from 'react';
import { Handle, Position, type NodeProps, useReactFlow, type Edge } from '@xyflow/react';
import useStore, { type RFState } from './store'; // Import the full store
import { 
    Box, Braces, Activity, Database, Type, Calculator, 
    ArrowRightFromLine, ExternalLink, ChevronDown, ChevronRight, 
    Share, CornerUpLeft, // Standard Icons
    
    // --- NEW ICONS ---
    Repeat,         // for FOR_BLOCK
    Repeat1,        // for WHILE_BLOCK
    GitBranch,      // for IF_BLOCK
    ShieldAlert,    // for TRY_BLOCK
    Square,         // for LIST_CONSTRUCTOR
    Dot,            // for ATTRIBUTE
    Combine,        // for ACCESSOR
    Shield,         // for EXCEPT_BLOCK
    Waypoints,      // for ELIF_BLOCK
    ShieldOff,      // for ELSE_BLOCK
    FileText,       // for IMPORT (in sidebar)
    Plus            // for Add button
} from 'lucide-react';

// --- Custom Event Dispatcher ---
const dispatchGraphUpdate = (action: string, payload: any) => {
    console.warn(`EVENT: ${action}`, payload);
    const store = useStore.getState();

    switch (action) {
        case 'UPDATE_PORT_LITERAL':
            store.updatePortLiteral(payload.nodeId, payload.portId, payload.newValue);
            break;
        case 'ADD_LIST_ITEM':
            store.addListItem(payload.nodeId, payload.value);
            break;
        case 'ADD_DICT_PAIR':
            store.addDictPair(payload.nodeId, payload.key, payload.value);
            break;
        default:
            console.warn(`Unknown action: ${action}`);
    }
};


// --- UPDATED: "In-Port Literal" Component ---
const Port = memo(({ 
    label, 
    id, 
    nodeId,
    hardcodedValue,
    isConnected,
    isOptional = false,
}: { 
    label: string, 
    id: string, 
    nodeId: string,
    hardcodedValue?: string,
    isConnected: boolean,
    isOptional?: boolean,
}) => {
    
    const [currentValue, setCurrentValue] = useState(hardcodedValue ?? '');
    const [inputWidth, setInputWidth] = useState(0);
    const spanRef = React.useRef<HTMLSpanElement>(null);

    // Update currentValue when hardcodedValue changes (e.g., after backend update)
    React.useEffect(() => {
        console.log(`DEBUG: Port useEffect for ${nodeId}:${id} - isConnected=${isConnected}, hardcodedValue=${hardcodedValue}, currentValue=${currentValue}`);
        if (!isConnected && hardcodedValue !== undefined) {
            console.log(`DEBUG: Port updating currentValue from ${currentValue} to ${hardcodedValue}`);
            setCurrentValue(hardcodedValue);
        }
    }, [hardcodedValue, isConnected]);

    React.useEffect(() => {
        if (spanRef.current) {
            setInputWidth(spanRef.current.scrollWidth + 2); // Add some padding
        }
    }, [currentValue]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') e.currentTarget.blur();
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        const newValue = e.currentTarget.value;
        console.log(`DEBUG: Port handleBlur called for nodeId=${nodeId}, portId=${id}, newValue="${newValue}", hardcodedValue="${hardcodedValue}"`);
        setCurrentValue(newValue);
        if (newValue !== (hardcodedValue ?? '')) {
            console.log(`DEBUG: Port value changed, dispatching UPDATE_PORT_LITERAL`);
            dispatchGraphUpdate('UPDATE_PORT_LITERAL', { nodeId, portId: id, newValue });
        } else {
            console.log(`DEBUG: Port value unchanged, not dispatching`);
        }
    };
    
    return (
        <div className="relative flex items-center h-7 px-3 group">
            <Handle 
                type="target" 
                position={Position.Left} 
                id={id}
                className={`
                    !w-3 !h-3 !border-2 !bg-slate-700 !border-slate-500 
                    hover:!bg-blue-500
                    ${isConnected ? '!bg-blue-500 !opacity-100' : 'opacity-30 group-hover:opacity-100'}
                `}
                style={{ left: '-6px', zIndex: 10 }}
            />
            
            {/* --- UPDATED: Input is always rendered --- */}
            <span ref={spanRef} className="absolute invisible text-xs font-mono whitespace-pre">{currentValue || label}</span>
            <input
                type="text"
                className={`
                    absolute left-2.5
                    bg-slate-700/50 rounded-sm px-1 py-0.5 text-xs font-mono
                    outline-none border border-transparent
                    ${isConnected
                        ? 'text-slate-500 italic'
                        : 'text-cyan-300 focus:border-cyan-500 focus:bg-slate-700'
                    }
                `}
                style={{ zIndex: 5, width: `${inputWidth+8}px` }}
                value={isConnected ? '[Wired Input]' : currentValue}
                onChange={(e) => setCurrentValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                placeholder={label}
                disabled={isConnected} // --- Input is disabled when wired ---
            />
        </div>
    );
});

// --- Base Node (for most nodes) ---
const BlenderNode = memo((props: { id: string, data: any, icon: React.ElementType, color: string, children?: React.ReactNode, hasOutput?: boolean, outputLabel?: string }) => {
    const { id: nodeId, data, icon: Icon, color, children, hasOutput = true, outputLabel = "value" } = props;
    const [isExpanded, setIsExpanded] = useState(false);
    const [showUsages, setShowUsages] = useState(false);
    
    const { getEdges } = useReactFlow();

    const portDefaults = data.port_defaults || {};
    
    const connectedTargetHandles = useMemo(() => new Set(
        getEdges()
            .filter(e => e.target === nodeId)
            .map(e => e.targetHandle)
            .filter(Boolean)
    ), [getEdges, nodeId]);
    
    const params = data.params || [];
    const requiredParams = params.filter((p: any) => !p.optional);
    const optionalParams = params.filter((p: any) => p.optional);
    const hasOptional = optionalParams.length > 0;

    const handleUsageJump = (worldId: string) => {
        window.dispatchEvent(new CustomEvent('go-to-world', { detail: worldId }));
        setShowUsages(false); 
    };
    
    const renderPort = (p: any) => (
        <Port 
            key={p.name} 
            label={p.name} 
            id={p.name} 
            isOptional={p.optional}
            isConnected={connectedTargetHandles.has(p.name)}
            hardcodedValue={portDefaults[p.name]}
            nodeId={nodeId}
        />
    );

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
                <div className="py-2 space-y-1">
                    {requiredParams.map(renderPort)}
                    {isExpanded && optionalParams.map(renderPort)}
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


// --- Standard Concrete Nodes (unchanged, just passing ID) ---
// ... (FunctionDefNode, CallNode, VariableNode, OperatorNode, etc. are identical to previous)

export const FunctionDefNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={Box} color="#3b82f6" hasOutput={false} />
);

export const CallNode = memo((props: NodeProps) => {
    const { data, id } = props;
    const handleZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (data.target_world) {
            window.dispatchEvent(new CustomEvent('enter-world', { detail: data.target_world }));
        }
    };
    const params: any[] = Array.isArray(data.params) ? [...data.params] : [];
    if (data.is_method) {
        params.unshift({ name: "attribute_value", optional: false });
    }
    return (
        <BlenderNode {...props} id={id} icon={Activity} color="#f59e0b" outputLabel="return" data={{...data, params}}>
             {data.target_world && (
                 <button
                    onClick={handleZoom}
                    className="ml-auto p-1 text-slate-500 hover:text-blue-400"
                    title="Zoom into definition"
                ><ExternalLink size={12} /></button>
             )}
        </BlenderNode>
    );
});
export const VariableNode = (props: NodeProps) => {
    const { data, id } = props;
    const isClosure = data.mode === 'closure_read';
    const color = isClosure ? "#22d3ee" : "#10b981";
    const icon = isClosure ? Share : Database;
    const inputParams = data.mode === 'write' ? [{ name: "input", optional: false }] : [];
    const hasOutput = true; 
    const handleJump = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (data.origin_world) {
            window.dispatchEvent(new CustomEvent('go-to-world', { detail: data.origin_world }));
        }
    };
    return (
        <BlenderNode {...props} id={id} icon={icon} color={color} hasOutput={hasOutput} data={{...data, params: inputParams}} outputLabel="value">
            {isClosure && (
                 <button 
                    onClick={handleJump} 
                    className="ml-auto p-1 text-slate-500 hover:text-cyan-400" 
                    title="Go to original definition"
                ><CornerUpLeft size={12} /></button>
             )}
        </BlenderNode>
    );
};
export const LiteralNode = (props: NodeProps) => (
    // This node is now *only* rendered if it's not collapsed, or if it's orphaned.
    <BlenderNode {...props} id={props.id} icon={Type} color="#64748b" data={{...props.data, params: []}} outputLabel="value" />
);
export const OperatorNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={Calculator} color="#ef4444" outputLabel="result" data={{ ...props.data, params: [{ name: "operand_0", optional: false },{ name: "operand_1", optional: false },]}} />
);
export const ReturnNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={ArrowRightFromLine} color="#ec4899" hasOutput={false} data={{ ...props.data, params: [{ name: "value", optional: false }]}} />
);
export const ClassDefNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={Braces} color="#8b5cf6" hasOutput={false} />
);
const ContainerNode = (props: NodeProps & { icon: React.ElementType, color: string }) => {
    const { data, id } = props;
    const handleZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('enter-world', { detail: id }));
    };
    return (
        <BlenderNode {...props} id={id} hasOutput={false}>
            <button 
                onClick={handleZoom} 
                className="ml-auto p-1 text-slate-500 hover:text-blue-400" 
                title="Zoom into block"
            ><ExternalLink size={12} /></button>
        </BlenderNode>
    );
}
export const ForBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={Repeat} color="#e11d48" data={{ ...props.data, params: [{ name: "iterates_on", optional: false }]}} />
);
export const WhileBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={Repeat1} color="#e11d48" data={{ ...props.data, params: [{ name: "value", optional: false }]}} />
);
export const IfBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={GitBranch} color="#f97316" data={{ ...props.data, params: [{ name: "value", optional: false }]}} />
);
export const ElifBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={Waypoints} color="#f97316" data={{ ...props.data, params: [{ name: "value", optional: false }]}} />
);
export const ElseBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={ShieldOff} color="#f97316" data={{ ...props.data, params: [] }} />
);
export const TryBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={ShieldAlert} color="#0ea5e9" data={{ ...props.data, params: [] }} />
);
export const ExceptBlockNode = (props: NodeProps) => (
    <ContainerNode {...props} icon={Shield} color="#0ea5e9" data={{ ...props.data, params: [{ name: "value", optional: false }]}} />
);
export const AccessorNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={Combine} color="#14b8a6" outputLabel="value" data={{ ...props.data, params: [{ name: "access_value", optional: false },{ name: "access_key", optional: false },]}} />
);
export const AttributeNode = (props: NodeProps) => (
    <BlenderNode {...props} id={props.id} icon={Dot} color="#14b8a6" outputLabel="value" data={{ ...props.data, params: [{ name: "attribute_value", optional: false },]}} />
);


// --- NEW: Custom ListConstructorNode (implements your UI spec) ---
export const ListConstructorNode = memo((props: NodeProps) => {
    const { id: nodeId, data } = props;

    // Get the initial items pre-processed by the store
    // This array now contains objects for *both* literals and wired inputs
    const initialItems: {isWired: boolean, value: string, portId: string}[] = (data as any).initialItems || [];
    
    const handleAddItem = () => {
        dispatchGraphUpdate('ADD_LIST_ITEM', { nodeId, value: "''" });
    };

    return (
        <div 
          className="bg-slate-800/80 backdrop-blur-md rounded-md border border-fuchsia-600 shadow-xl min-w-[220px]"
          style={{ color: '#f8fafc' }}
        >
            <div className="flex items-center gap-2 p-2 border-b border-fuchsia-600">
                <Square className="w-4 h-4 text-fuchsia-500" />
                <span className="text-sm font-bold truncate text-slate-100">{data.label}</span>
            </div>

            <div className="flex justify-between">
                {/* Left side: Dynamic list editor */}
                <div className="py-2 space-y-1 min-w-0 flex-1">
                    {initialItems.map((item, i) => (
                        <Port
                            key={item.portId}
                            label={item.portId}
                            id={item.portId}
                            nodeId={nodeId}
                            isConnected={item.isWired}
                            hardcodedValue={item.isWired ? '' : item.value}
                        />
                    ))}
                    <button 
                        onClick={handleAddItem}
                        className="flex items-center gap-2 w-full px-3 py-1 text-slate-500 hover:text-green-400"
                    >
                        <Plus size={14} />
                        <span className="text-xs font-mono">Add item</span>
                    </button>
                </div>

                {/* Right side: Output port */}
                <div className="p-2 flex items-center relative">
                    <label className="text-xs font-mono text-slate-300 mr-5">list</label>
                    <Handle 
                        type="source" 
                        position={Position.Right} 
                        id="output"
                        className="!w-3 !h-3 !border-2 !bg-slate-700 !border-slate-500 hover:!bg-green-500"
                        style={{ right: '-6px' }}
                    />
                </div>
            </div>
        </div>
    );
});

// --- NEW: Custom DictConstructorNode (implements your UI spec) ---
export const DictConstructorNode = memo((props: NodeProps) => {
    const { id: nodeId, data } = props;

    // Get the initial pairs pre-processed by the store
    const initialPairs: {
        key: {isWired: boolean, value: string, portId: string},
        value: {isWired: boolean, value: string, portId: string}
    }[] = (data as any).initialPairs || [];
    
    const handleAddPair = () => {
        dispatchGraphUpdate('ADD_DICT_PAIR', { nodeId, key: "'new_key'", value: "''" });
    };

    return (
        <div 
          className="bg-slate-800/80 backdrop-blur-md rounded-md border border-fuchsia-600 shadow-xl min-w-[240px]"
          style={{ color: '#f8fafc' }}
        >
            <div className="flex items-center gap-2 p-2 border-b border-fuchsia-600">
                <Braces className="w-4 h-4 text-fuchsia-500" />
                <span className="text-sm font-bold truncate text-slate-100">{data.label}</span>
            </div>

            <div className="flex justify-between">
                {/* Left side: Dynamic key/value grid editor */}
                <div className="py-2 space-y-1 min-w-0 flex-1">
                    {initialPairs.map((pair, i) => (
                        <div key={i} className="flex border-b border-slate-700/50">
                            {/* Key Port */}
                            <Port
                                label={pair.key.portId}
                                id={pair.key.portId}
                                nodeId={nodeId}
                                isConnected={pair.key.isWired}
                                hardcodedValue={pair.key.isWired ? '' : pair.key.value}
                            />
                            {/* Value Port */}
                            <Port
                                label={pair.value.portId}
                                id={pair.value.portId}
                                nodeId={nodeId}
                                isConnected={pair.value.isWired}
                                hardcodedValue={pair.value.isWired ? '' : pair.value.value}
                            />
                        </div>
                    ))}
                    <button 
                        onClick={handleAddPair}
                        className="flex items-center gap-2 w-full px-3 py-1 text-slate-500 hover:text-green-400"
                    >
                        <Plus size={14} />
                        <span className="text-xs font-mono">Add pair</span>
                    </button>
                </div>

                {/* Right side: Output port */}
                <div className="p-2 flex items-center relative">
                    <label className="text-xs font-mono text-slate-300 mr-5">dict</label>
                    <Handle 
                        type="source" 
                        position={Position.Right} 
                        id="output"
                        className="!w-3 !h-3 !border-2 !bg-slate-700 !border-slate-500 hover:!bg-green-500"
                        style={{ right: '-6px' }}
                    />
                </div>
            </div>
        </div>
    );
});


// --- UPDATED NODE TYPE MAP ---
export const nodeTypes = {
  FUNCTION_DEF: FunctionDefNode,
  CLASS_DEF: ClassDefNode,
  CALL: CallNode,
  VARIABLE: VariableNode,
  LITERAL: LiteralNode, // Still needed for the store's "collapse" logic
  OPERATOR: OperatorNode,
  RETURN: ReturnNode,
  
  // New Containers
  FOR_BLOCK: ForBlockNode,
  WHILE_BLOCK: WhileBlockNode,
  IF_BLOCK: IfBlockNode,
  ELIF_BLOCK: ElifBlockNode,
  ELSE_BLOCK: ElseBlockNode,
  TRY_BLOCK: TryBlockNode,
  EXCEPT_BLOCK: ExceptBlockNode,
  
  // New Data Structures (now with custom UI)
  LIST_CONSTRUCTOR: ListConstructorNode,
  DICT_CONSTRUCTOR: DictConstructorNode,
  ACCESSOR: AccessorNode,
  ATTRIBUTE: AttributeNode,
};
