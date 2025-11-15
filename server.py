from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import sys
import os
import io
import contextlib
import json
import tempfile

try:
    from engine import graph_parser
    from engine.synthesizer import Synthesizer # Ensure Synthesizer is imported
except ImportError:
    import graph_parser
    from synthesizer import Synthesizer

app = FastAPI()

# Allow CORS for frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Adjust if your Vite port differs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class InjectRequest(BaseModel):
    graph: dict
    code: str
    worldId: str

class SynthesizeRequest(BaseModel):
    graph: dict
    nodeId: str = None
    worldId: str = None

class RunRequest(BaseModel):
    graph: dict

class RemoveNodesRequest(BaseModel):
    graph: dict
    nodeIds: list[str]

class AddImportRequest(BaseModel):
    graph: dict
    code: str # e.g., "import os"

class UpdateLiteralRequest(BaseModel):
    graph: dict
    nodeId: str
    newValue: str

# --- NEW GRAPH MUTATION REQUEST MODELS ---
class AddEdgeRequest(BaseModel):
    graph: dict
    source: str
    target: str
    edgeType: str = "DATA_FLOW"
    label: str = None
    data: dict = None

class RemoveEdgeRequest(BaseModel):
    graph: dict
    source: str
    target: str
    edgeType: str = None

class UpdatePortLiteralRequest(BaseModel):
    graph: dict
    nodeId: str
    portId: str
    newValue: str

class AddListItemRequest(BaseModel):
    graph: dict
    listNodeId: str
    value: str = "''"

class UpdateListItemRequest(BaseModel):
    graph: dict
    listNodeId: str
    index: int
    newValue: str

class AddDictPairRequest(BaseModel):
    graph: dict
    dictNodeId: str
    key: str = "'new_key'"
    value: str = "''"

# --- NEW: Parse Python code to graph ---
class ParseRequest(BaseModel):
    code: str

class UpdateDictPairRequest(BaseModel):
    graph: dict
    dictNodeId: str
    index: int
    keyValue: str = None
    valueValue: str = None

@app.post("/run")
def run_code_endpoint(req: RunRequest):
    """
    Synthesizes the graph into Python code and executes it.
    Uses the graph provided in the request (with any injections/updates).
    Returns the stdout.
    """
    try:
        # Create a synthesizer instance with the provided graph
        class GraphSynthesizer(Synthesizer):
            def __init__(self, graph_data):
                self.graph = graph_data

        # 2. Synthesize code using the provided graph
        synth = GraphSynthesizer(req.graph)
        code = synth.generate_code()

        # 3. Execute and capture output
        f = io.StringIO()
        with contextlib.redirect_stdout(f):
            try:
                # Use a restricted global scope for safety if needed,
                # currently using standard globals for full functionality
                exec(code, {"__builtins__": __builtins__})
            except Exception as e:
                print(f"Runtime Error: {e}")

        return {
            "success": True,
            "output": f.getvalue(),
            "generated_code": code # Optional: return code to view debugging
        }

    except Exception as e:
        return {
            "success": False,
            "output": str(e)
        }

@app.post("/synthesize")
def synthesize_endpoint(req: SynthesizeRequest):
    """
    Synthesizes code from the graph for debugging/viewing.
    Can synthesize full code, world-specific code, or single-node code.
    """
    try:
        # Create a synthesizer instance with the provided graph
        class GraphSynthesizer(Synthesizer):
            def __init__(self, graph_data):
                self.graph = graph_data

        synth = GraphSynthesizer(req.graph)

        code = ""
        if req.nodeId:
            code = synth.generate_node_code(req.nodeId)
        elif req.worldId:
            # If worldId is provided, synthesize JUST that world (no imports, no root)
            # Unless it is root
            if req.worldId == "root":
                code = synth.generate_code()
            else:
                # Manually call internal method for world
                lines = synth._write_world(req.worldId, 0)
                code = "\n".join(lines)
        else:
            code = synth.generate_code()

        return {"success": True, "code": code}
    except Exception as e:
        return {"success": False, "code": f"# Error: {str(e)}"}

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/inject")
def inject_code_endpoint(req: InjectRequest):
    """
    Takes the current graph state and a code snippet.
    Parses the snippet and injects it into the specified world.
    Returns the updated graph.
    """
    # Create a copy of the graph to modify (or modify in place)
    # The inject_code function modifies the list in-place, so we pass the dict
    updated_graph = req.graph.copy()
    
    success, msg = graph_parser.inject_code(updated_graph, req.code, req.worldId)
    
    if not success:
        raise HTTPException(status_code=400, detail=msg)
    
    return {
        "success": True,
        "message": f"Successfully injected {msg} nodes.",
        "graph": updated_graph
    }

# --- NEW ENDPOINT: Remove Nodes ---
@app.post("/op/remove-nodes")
def remove_nodes_endpoint(req: RemoveNodesRequest):
    try:
        updated_graph = graph_parser.remove_nodes(req.graph, req.nodeIds)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW ENDPOINT: Add Import ---
@app.post("/op/add-import")
def add_import_endpoint(req: AddImportRequest):
    try:
        # Use the existing inject_code function, but target 'world_imports'
        success, _ = graph_parser.inject_code(req.graph, req.code, "world_imports")
        if not success:
            raise HTTPException(status_code=400, detail="Invalid import syntax")
        return {"success": True, "graph": req.graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW ENDPOINT: Update Literal ---
@app.post("/op/update-literal")
def update_literal_endpoint(req: UpdateLiteralRequest):
    try:
        # This is a conceptual hack. In a real system, this would be more complex.
        # This finds the *literal node* and updates its label.
        updated_graph = graph_parser.update_node_literal(req.graph, req.nodeId, req.newValue)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW GRAPH MUTATION ENDPOINTS ---

@app.post("/op/add-edge")
def add_edge_endpoint(req: AddEdgeRequest):
    try:
        updated_graph = graph_parser.add_edge(req.graph, req.source, req.target, req.edgeType, req.label, req.data)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/remove-edge")
def remove_edge_endpoint(req: RemoveEdgeRequest):
    try:
        updated_graph = graph_parser.remove_edge(req.graph, req.source, req.target, req.edgeType)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/update-port-literal")
def update_port_literal_endpoint(req: UpdatePortLiteralRequest):
    try:
        print(f"DEBUG: update_port_literal called with node_id={req.nodeId}, port_id={req.portId}, new_value={req.newValue}")
        print(f"DEBUG: Graph has {len(req.graph['nodes'])} nodes, {len(req.graph['edges'])} edges before update")

        updated_graph = graph_parser.update_port_literal(req.graph, req.nodeId, req.portId, req.newValue)

        print(f"DEBUG: update_port_literal completed, graph has {len(updated_graph['nodes'])} nodes, {len(updated_graph['edges'])} edges after update")
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        print(f"ERROR: update_port_literal failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/add-list-item")
def add_list_item_endpoint(req: AddListItemRequest):
    try:
        updated_graph = graph_parser.add_list_item(req.graph, req.listNodeId, req.value)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/update-list-item")
def update_list_item_endpoint(req: UpdateListItemRequest):
    try:
        updated_graph = graph_parser.update_list_item(req.graph, req.listNodeId, req.index, req.newValue)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/add-dict-pair")
def add_dict_pair_endpoint(req: AddDictPairRequest):
    try:
        updated_graph = graph_parser.add_dict_pair(req.graph, req.dictNodeId, req.key, req.value)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/op/update-dict-pair")
def update_dict_pair_endpoint(req: UpdateDictPairRequest):
    try:
        updated_graph = graph_parser.update_dict_pair(req.graph, req.dictNodeId, req.index, req.keyValue, req.valueValue)
        return {"success": True, "graph": updated_graph}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# --- NEW: Parse Python code into graph ---
@app.post("/parse")
def parse_code_endpoint(req: ParseRequest):
    """
    Parses a full Python file into a fresh graph.
    """
    try:
        # Start with a clean empty graph
        empty_graph = {"nodes": [], "edges": []}

        # Inject code into the root of this empty graph
        success, msg = graph_parser.inject_code(empty_graph, req.code, "root")

        if not success:
            raise HTTPException(status_code=400, detail=msg)

        return {
            "success": True,
            "message": f"Parsed {len(empty_graph['nodes'])} nodes.",
            "graph": empty_graph
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
