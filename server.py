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
from engine.synthesizer import Synthesizer

# Ensure engine modules can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from engine import graph_parser
except ImportError:
    # Fallback if running from different context
    import graph_parser

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

class RunRequest(BaseModel):
    graph: dict

@app.post("/run")
def run_code_endpoint(req: RunRequest):
    """
    Synthesizes the graph into Python code and executes it.
    Returns the stdout.
    """
    try:
        # 1. Save graph to a temporary file for the Synthesizer
        with tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.json') as tmp:
            json.dump(req.graph, tmp)
            tmp_path = tmp.name

        # 2. Synthesize code
        synth = Synthesizer(tmp_path)
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
        
        # Cleanup
        os.remove(tmp_path)
        
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

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
