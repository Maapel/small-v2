import libcst as cst
import json
import os
import uuid
import sys

class WorldVisitor(cst.CSTVisitor):
    def __init__(self):
        self.graph = {"nodes": [], "edges": []}
        self.active_parent_stack = []
        self.call_stack = []
        self.current_world = "root"
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
             self._add_edge(self.current_world, unique_id, "CONTAINS")
        return unique_id

    def _add_edge(self, source, target, type="DATA_FLOW", label=None):
        self.graph["edges"].append({"source": source, "target": target, "type": type, "label": label})

    def _connect_to_active_parent(self, child_id):
        if self.active_parent_stack:
            parent = self.active_parent_stack[-1]
            # Use specific edge types for clearer debugging and synthesis
            if parent["type"] == "ARGUMENT":
                 self._add_edge(child_id, parent["node_id"], "ARGUMENT")
            elif parent["type"] == "OPERAND":
                 self._add_edge(child_id, parent["node_id"], "OPERAND")
            elif parent["type"] == "RETURN_VAL":
                 self._add_edge(child_id, parent["node_id"], "INPUT")
            elif parent["type"] == "ASSIGNMENT":
                 self._add_edge(child_id, parent["node_id"], "WRITES_TO")

    # --- WORLDS ---
    def visit_FunctionDef(self, node: cst.FunctionDef) -> None:
        params = [param.name.value for param in node.params.params]
        func_node_id = self._add_node("FUNCTION_DEF", node.name.value, {"params": params})
        self.world_stack.append(self.current_world)
        self.current_world = func_node_id
    def leave_FunctionDef(self, original_node: cst.FunctionDef) -> None:
        self.current_world = self.world_stack.pop()

    def visit_ClassDef(self, node: cst.ClassDef) -> None:
        class_id = self._add_node("CLASS_DEF", node.name.value)
        self.world_stack.append(self.current_world)
        self.current_world = class_id
    def leave_ClassDef(self, original_node: cst.ClassDef) -> None:
        self.current_world = self.world_stack.pop()

    # --- DATA FLOW ---
    def visit_Assign(self, node: cst.Assign) -> None:
        if len(node.targets) == 1 and isinstance(node.targets[0].target, cst.Name):
            var_id = self._add_node("VARIABLE", node.targets[0].target.value, {"mode": "write"})
            self.active_parent_stack.append({"type": "ASSIGNMENT", "node_id": var_id})
    def leave_Assign(self, original_node: cst.Assign) -> None:
        if self.active_parent_stack and self.active_parent_stack[-1]["type"] == "ASSIGNMENT": self.active_parent_stack.pop()
    def visit_AssignTarget(self, node: cst.AssignTarget) -> None: self.in_lvalue = True
    def leave_AssignTarget(self, original_node: cst.AssignTarget) -> None: self.in_lvalue = False

    def visit_Return(self, node: cst.Return) -> None:
        ret_id = self._add_node("RETURN", "return")
        self.active_parent_stack.append({"type": "RETURN_VAL", "node_id": ret_id})
    def leave_Return(self, original_node: cst.Return) -> None: self.active_parent_stack.pop()

    def visit_BinaryOperation(self, node: cst.BinaryOperation) -> None:
        op_map = {cst.Add: "+", cst.Subtract: "-", cst.Multiply: "*", cst.Divide: "/"}
        op_id = self._add_node("OPERATOR", op_map.get(type(node.operator), "?"))
        self._connect_to_active_parent(op_id)
        self.active_parent_stack.append({"type": "OPERAND", "node_id": op_id})
    def leave_BinaryOperation(self, original_node: cst.BinaryOperation) -> None: self.active_parent_stack.pop()

    def visit_Call(self, node: cst.Call) -> None:
        func_name = node.func.value if isinstance(node.func, cst.Name) else "unknown"
        if isinstance(node.func, cst.Attribute): func_name = f"{node.func.value.value}.{node.func.attr.value}"
        # If it's a simple name call, ignore it when visit_Name runs next so we don't treat it as a variable read
        if isinstance(node.func, cst.Name): self.ignore_next_name = True
        call_id = self._add_node("CALL", func_name)
        self._connect_to_active_parent(call_id)
        self.call_stack.append(call_id)
    def leave_Call(self, original_node: cst.Call) -> None:
        self.call_stack.pop(); self.ignore_next_name = False

    def visit_Arg(self, node: cst.Arg) -> None:
        # CRITICAL FIX: Once we are inside an argument, we are definitely NOT looking at the function name anymore.
        self.ignore_next_name = False 
        if self.call_stack: self.active_parent_stack.append({"type": "ARGUMENT", "node_id": self.call_stack[-1]})
    def leave_Arg(self, original_node: cst.Arg) -> None:
        if self.active_parent_stack and self.active_parent_stack[-1]["type"] == "ARGUMENT": self.active_parent_stack.pop()

    # --- ATOMICS ---
    def _handle_atomic(self, label, type, data=None):
        if self.active_parent_stack:
             node_id = self._add_node(type, str(label), data)
             self._connect_to_active_parent(node_id)
    def visit_Integer(self, node: cst.Integer) -> None: self._handle_atomic(node.value, "LITERAL")
    def visit_Float(self, node: cst.Float) -> None: self._handle_atomic(node.value, "LITERAL")
    def visit_SimpleString(self, node: cst.SimpleString) -> None: self._handle_atomic(node.value, "LITERAL")
    def visit_Name(self, node: cst.Name) -> None:
        if self.ignore_next_name:
             self.ignore_next_name = False
             return
        if not self.in_lvalue and self.active_parent_stack:
             self._handle_atomic(node.value, "VARIABLE", {"mode": "read"})

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "target.py"
    if not os.path.exists(target): print(f"❌ Target file {target} not found."); sys.exit(1)
    with open(target, "r") as f: source = f.read()
    visitor = WorldVisitor()
    cst.parse_module(source).visit(visitor)
    with open("graph.json", "w") as f: json.dump(visitor.graph, f, indent=2)
    print(f"✅ Parsed {target} -> graph.json ({len(visitor.graph['nodes'])} nodes)")