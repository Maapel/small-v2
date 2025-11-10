import { ReactFlow, Controls, Panel, type NodeOrigin } from '@xyflow/react';
import { shallow } from 'zustand/shallow';
 
import useStore, { type RFState } from './store';
 
// we have to import the React Flow styles for it to work
import '@xyflow/react/dist/style.css';
 
const selector = (state: RFState) => ({
  nodes: state.nodes,
  edges: state.edges,
  onNodesChange: state.onNodesChange,
  onEdgesChange: state.onEdgesChange,
});
 
// this places the node origin in the center of a node
const nodeOrigin: NodeOrigin = [0.5, 0.5];
 
function Flow() {
  // whenever you use multiple values, you should use shallow to make sure the component only re-renders when one of the values changes
  const { nodes, edges, onNodesChange, onEdgesChange } = useStore(selector, shallow);
 
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeOrigin={nodeOrigin}
      fitView
    >
      <Controls showInteractive={false} />
      <Panel position="top-left">React Flow Mind Map</Panel>
    </ReactFlow>
  );
}
 
export default Flow;