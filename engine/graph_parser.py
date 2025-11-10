import libcst as cst
import json
import os
import uuid
import sys

class WorldVisitor(cst.CSTVisitor):
    def __init__(self, start_world="root"):
        self.graph = {"nodes": [], "edges": []}
        self.active_parent_stack = []
        self.call_stack = []
        self.current_world = start_world
        self.world_stack = []
        self.in_lvalue = False
        self.ignore_next_name = False

    def _add_node(self, type, label, data=None):
        unique_id = f"{type}_{uuid.uuid4().hex[:8]}"
        self.graph["nodes"].append({
            "id": unique_id, "type": type, "label": label, 
            "world": self.current_world, "data": data or {}
        })
        if self.current_world != "root":
             # Check if we are injecting into a world that isn't our immediate parent in this partial parse
             # For now, simple CONTAINS works because we trust the target_world passed in.
             self._add_edge(self.current_world, unique_id, "CONTAINS")
        return unique_id

    def _add_edge(self, source, target, type="DATA_FLOW", label=None):
        self.graph["edges"].append({"source": source, "target": target, "type": type, "label": label})

    def _connect_to_active_parent(self, child_id):
        if self.active_parent_stack:
            parent = self.active_parent_stack[-1]
            if parent["type"] == "ARGUMENT": self._add_edge(child_id, parent["node_id"], "ARGUMENT")
            elif parent["type"] == "OPERAND": self._add_edge(child_id, parent["node_id"], "OPERAND")
            elif parent["type"] == "RETURN_VAL": self._add_edge(child_id, parent["node_id"], "INPUT")
            elif parent["type"] == "ASSIGNMENT": self._add_edge(child_id, parent["node_id"], "WRITES_TO")

    # --- VISITORS (Condensed for brevity, logic matches V4 Gold Master) ---
    def visit_FunctionDef(self, n):
        nid = self._add_node("FUNCTION_DEF", n.name.value, {"params": [p.name.value for p in n.params.params]})
        self.world_stack.append(self.current_world); self.current_world = nid
    def leave_FunctionDef(self, n): self.current_world = self.world_stack.pop()

    def visit_ClassDef(self, n):
        nid = self._add_node("CLASS_DEF", n.name.value)
        self.world_stack.append(self.current_world); self.current_world = nid
    def leave_ClassDef(self, n): self.current_world = self.world_stack.pop()

    def visit_Assign(self, n):
        if len(n.targets) == 1 and isinstance(n.targets[0].target, cst.Name):
            nid = self._add_node("VARIABLE", n.targets[0].target.value, {"mode": "write"})
            self.active_parent_stack.append({"type": "ASSIGNMENT", "node_id": nid})
    def leave_Assign(self, n): 
        if self.active_parent_stack and self.active_parent_stack[-1]["type"]=="ASSIGNMENT": self.active_parent_stack.pop()
    def visit_AssignTarget(self, n): self.in_lvalue = True
    def leave_AssignTarget(self, n): self.in_lvalue = False

    def visit_Return(self, n):
        nid = self._add_node("RETURN", "return")
        self.active_parent_stack.append({"type": "RETURN_VAL", "node_id": nid})
    def leave_Return(self, n): self.active_parent_stack.pop()

    def visit_Call(self, n):
        fname = n.func.value if isinstance(n.func, cst.Name) else "unknown"
        if isinstance(n.func, cst.Attribute): fname = f"{n.func.value.value}.{n.func.attr.value}"
        if isinstance(n.func, cst.Name): self.ignore_next_name = True
        nid = self._add_node("CALL", fname)
        self._connect_to_active_parent(nid)
        self.call_stack.append(nid)
    def leave_Call(self, n): self.call_stack.pop(); self.ignore_next_name = False
    def visit_Arg(self, n): 
        self.ignore_next_name = False
        if self.call_stack: self.active_parent_stack.append({"type": "ARGUMENT", "node_id": self.call_stack[-1]})
    def leave_Arg(self, n): 
        if self.active_parent_stack and self.active_parent_stack[-1]["type"]=="ARGUMENT": self.active_parent_stack.pop()

    def visit_BinaryOperation(self, n):
        op_map = {cst.Add: "+", cst.Subtract: "-", cst.Multiply: "*", cst.Divide: "/"}
        nid = self._add_node("OPERATOR", op_map.get(type(n.operator), "?"))
        self._connect_to_active_parent(nid)
        self.active_parent_stack.append({"type": "OPERAND", "node_id": nid})
    def leave_BinaryOperation(self, n): self.active_parent_stack.pop()

    def _atomic(self, val, type, data=None):
        if self.active_parent_stack:
             nid = self._add_node(type, str(val), data)
             self._connect_to_active_parent(nid)
    def visit_Integer(self, n): self._atomic(n.value, "LITERAL")
    def visit_Float(self, n): self._atomic(n.value, "LITERAL")
    def visit_SimpleString(self, n): self._atomic(n.value, "LITERAL")
    def visit_Name(self, n):
        if not self.ignore_next_name and not self.in_lvalue and self.active_parent_stack:
             self._atomic(n.value, "VARIABLE", {"mode": "read"})

# --- NEW INJECTION CAPABILITY ---
def inject_code(existing_graph, code_snippet, target_world="root"):
    """Parses a snippet and merges it into an existing graph at the target world."""
    try:
        tree = cst.parse_module(code_snippet)
        visitor = WorldVisitor(start_world=target_world)
        tree.visit(visitor)
        
        # Merge
        existing_graph['nodes'].extend(visitor.graph['nodes'])
        existing_graph['edges'].extend(visitor.graph['edges'])
        return True, len(visitor.graph['nodes'])
    except Exception as e:
        return False, str(e)

if __name__ == "__main__":
    # Standard CLI usage
    target = sys.argv[1] if len(sys.argv) > 1 else "target.py"
    if os.path.exists(target):
        with open(target, "r") as f: source = f.read()
        visitor = WorldVisitor()
        cst.parse_module(source).visit(visitor)
        with open("graph.json", "w") as f: json.dump(visitor.graph, f, indent=2)
        print(f"✅ Parsed {target} -> graph.json ({len(visitor.graph['nodes'])} nodes)")