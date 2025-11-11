import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Box, Braces, Activity, Database, Type, Calculator, ArrowRightFromLine, ExternalLink } from 'lucide-react';

const BaseNode = memo(({ data, icon: Icon, color, isWorld = false, children }: any) => {
  return (
    <div 
      className={`
        group relative px-4 py-3 rounded-lg border-[1.5px] min-w-[180px] 
        transition-all duration-200 ease-out
        ${isWorld ? 'cursor-pointer hover:-translate-y-0.5' : ''}
      `}
      style={{ 
          borderColor: color,
          backgroundColor: '#0f172a',
          boxShadow: isWorld ? `0 4px 20px -8px ${color}50` : '0 1px 3px 0 rgb(0 0 0 / 0.1)',
          color: '#f8fafc'
      }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !border-[1.5px] transition-colors duration-200" style={{ backgroundColor: color, borderColor: '#0f172a' }} />
      
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-slate-800" style={{ backgroundColor: '#1e293b' }}>
           <Icon className="w-5 h-5" style={{ color: color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold truncate text-slate-100">{data.label}</div>
          <div className="text-[9px] font-mono font-semibold uppercase tracking-wider opacity-70 text-slate-400">{data.type}</div>
        </div>
      </div>

      {data.params && data.params.length > 0 && (
          <div className="mt-3 pt-2 border-t flex flex-wrap gap-1.5" style={{ borderColor: '#1e293b' }}>
              {data.params.map((p: string) => (
                  <span key={p} className="text-[10px] font-mono px-1.5 py-0.5 rounded-[3px] border" 
                        style={{ backgroundColor: '#1e293b', borderColor: '#334155', color: '#cbd5e1' }}>{p}</span>
              ))}
          </div>
      )}

      {children}

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !border-[1.5px] transition-colors duration-200" style={{ backgroundColor: color, borderColor: '#0f172a' }} />
    </div>
  );
});

// Special CallNode with Zoom support
export const CallNode = memo(({ data }: any) => {
    const handleZoom = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (data.target_world) {
            window.dispatchEvent(new CustomEvent('enter-world', { detail: data.target_world }));
        }
    };

    return (
        <BaseNode data={data} icon={Activity} color="#f59e0b">
             {data.target_world && (
                 <button onClick={handleZoom} className="absolute -top-2 -right-2 p-1 bg-blue-500 rounded-full hover:bg-blue-400 transition-colors shadow-sm" title="Zoom into definition">
                     <ExternalLink size={12} className="text-white" />
                 </button>
             )}
        </BaseNode>
    );
});

export const FunctionDefNode = (props: NodeProps) => <BaseNode {...props} icon={Box} color="#3b82f6" isWorld={true} />;
export const ClassDefNode = (props: NodeProps) => <BaseNode {...props} icon={Braces} color="#8b5cf6" isWorld={true} />;
export const VariableNode = (props: NodeProps) => <BaseNode {...props} icon={Database} color="#10b981" />;
export const LiteralNode = (props: NodeProps) => <BaseNode {...props} icon={Type} color="#64748b" />;
export const OperatorNode = (props: NodeProps) => <BaseNode {...props} icon={Calculator} color="#ef4444" />;
export const ReturnNode = (props: NodeProps) => <BaseNode {...props} icon={ArrowRightFromLine} color="#ec4899" />;

export const nodeTypes = {
  FUNCTION_DEF: FunctionDefNode,
  CLASS_DEF: ClassDefNode,
  CALL: CallNode,
  VARIABLE: VariableNode,
  LITERAL: LiteralNode,
  OPERATOR: OperatorNode,
  RETURN: ReturnNode,
};