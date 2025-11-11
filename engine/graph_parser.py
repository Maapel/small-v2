import libcst as cst
import json
import os
import uuid
import sys

class SymbolTable:
    def __init__(self):
        # scopes is a list of dicts.
        # Each dict maps var_name -> { "current_id": node_id, "version": int }
        self.scopes = [{}]

    def push_scope(self): self.scopes.append({})
    def pop_scope(self): self.scopes.pop()

    def define_write(self, name, node_id):
        scope = self.scopes[-1]
        if name not in scope:
            scope[name] = {"current_id": node_id, "version": 1}
        else:
            scope[name]["current_id"] = node_id
            scope[name]["version"] += 1
        return scope[name]["version"]

    def resolve(self, name):
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]["current_id"]
        return None

class WorldVisitor(cst.CSTVisitor):
    def __init__(self, start_world="root"):
        self.graph = {"nodes": [], "edges": []}
        self.active_parent_stack = []
        self.call_stack = []
        self.current_world = start_world
        self.world_stack = []
        self.in_lvalue = False
        self.ignore_next_name = False
        self.symbols = SymbolTable()
        # Track where definitions are for the linking pass
        # map[world_id] -> map[func_name] -> func_node_id
        self.world_definitions = {"root": {}}

    def _add_node(self, type, label, data=None, world=None):
        unique_id = f"{type}_{uuid.uuid4().hex[:8]}"
        w = world if world is not None else self.current_world
        self.graph["nodes"].append({
            "id": unique_id, "type": type, "label": label, 
            "world": w, "data": data or {}
        })
        # We DON'T add CONTAINS edges anymore, we rely purely on 'world' tag for hierarchy
        # to keep the edge list clean for data flow.
        return unique_id

    def _add_edge(self, source, target, type="DATA_FLOW", label=None):
        if not any(e['source'] == source and e['target'] == target and e['type'] == type for e in self.graph['edges']):
            self.graph["edges"].append({"source": source, "target": target, "type": type, "label": label})

    def _connect_to_active_parent(self, child_id, edge_type_override=None):
        if self.active_parent_stack:
            parent = self.active_parent_stack[-1]
            etype = edge_type_override or "INPUT"
            if not edge_type_override:
                if parent["type"] in ["ARGUMENT"]: etype = "ARGUMENT"
                elif parent["type"] in ["OPERAND"]: etype = "OPERAND"
                elif parent["type"] == "ASSIGNMENT": etype = "WRITES_TO"
            self._add_edge(child_id, parent["node_id"], etype)

    # --- WORLDS ---
    def visit_FunctionDef(self, n):
        params = [p.name.value for p in n.params.params]
        func_id = self._add_node("FUNCTION_DEF", n.name.value, {"params": params})
        
        # Record definition for linking
        if self.current_world not in self.world_definitions:
             self.world_definitions[self.current_world] = {}
        self.world_definitions[self.current_world][n.name.value] = func_id

        self.world_stack.append(self.current_world)
        self.current_world = func_id
        self.symbols.push_scope()
        for p in params:
            pid = self._add_node("VARIABLE", p, {"mode": "param", "version": 1})
            self.symbols.define_write(p, pid)

    def leave_FunctionDef(self, n):
        self.current_world = self.world_stack.pop()
        self.symbols.pop_scope()

    # --- DATA FLOW ---
    def visit_Assign(self, n):
        if len(n.targets) == 1 and isinstance(n.targets[0].target, cst.Name):
            var_name = n.targets[0].target.value
            var_id = self._add_node("VARIABLE", var_name, {"mode": "write"})
            self.symbols.define_write(var_name, var_id)
            self.active_parent_stack.append({"type": "ASSIGNMENT", "node_id": var_id})
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
        if isinstance(n.func, cst.Name): self.ignore_next_name = True
        # We will link this to its definition in the post-processing pass
        nid = self._add_node("CALL", fname)
        self._connect_to_active_parent(nid)
        self.call_stack.append(nid)
    def leave_Call(self, n): self.call_stack.pop(); self.ignore_next_name = False

    def visit_Arg(self, n): 
        self.ignore_next_name = False
        if self.call_stack: self.active_parent_stack.append({"type": "ARGUMENT", "node_id": self.call_stack[-1]})
    def leave_Arg(self, n): 
        if self.active_parent_stack and self.active_parent_stack[-1]["type"]=="ARGUMENT": self.active_parent_stack.pop()

    def visit_Integer(self, n): self._atomic(n.value, "LITERAL")
    def visit_Float(self, n): self._atomic(n.value, "LITERAL")
    def visit_SimpleString(self, n): self._atomic(n.value, "LITERAL")
    
    def visit_Name(self, n):
        if self.ignore_next_name: self.ignore_next_name = False; return
        if not self.in_lvalue and self.active_parent_stack:
             var_id = self.symbols.resolve(n.value)
             if var_id:
                 parent = self.active_parent_stack[-1]
                 etype = "INPUT"
                 if parent["type"] == "ARGUMENT": etype = "ARGUMENT"
                 elif parent["type"] == "OPERAND": etype = "OPERAND"
                 elif parent["type"] == "ASSIGNMENT": etype = "WRITES_TO"
                 self._add_edge(var_id, parent["node_id"], etype)

    def _atomic(self, val, type, data=None):
        if self.active_parent_stack:
             nid = self._add_node(type, str(val), data)
             self._connect_to_active_parent(nid)
             return nid
        return None
    
    # --- POST-PROCESSING: LINK CALLS ---
    def link_calls(self):
        """Finds all CALL nodes and tries to find the world_id of their definition."""
        # Simple lexical lookup: check current world, then parent world, etc.
        # We need a map of world_id -> parent_world_id for this.
        world_parents = {}
        for node in self.graph['nodes']:
             if node['type'] == 'FUNCTION_DEF':
                  # A function's world is its own ID. Its parent is the world it was defined in.
                  # Wait, our node structure stores 'world' as where it *lives*, not what it *creates*.
                  # We need to find which nodes CREATE worlds.
                  pass 
        
        # Simplified approach: Just look in global definitions for now, or build a proper scope chain.
        # Actually, we can assume unique names for a simple MVP, or just look at root.
        # Better: Re-construct the parent chain from the nodes themselves.
        
        # 1. Build world hierarchy
        world_parents = {"root": None}
        for node in self.graph['nodes']:
             if node['type'] in ['FUNCTION_DEF', 'CLASS_DEF']:
                  # This node *creates* a world with its own ID
                  # It *lives* in node['world']
                  world_parents[node['id']] = node['world']

        # 2. Link calls
        for node in self.graph['nodes']:
            if node['type'] == 'CALL':
                call_name = node['label']
                # Search up the world stack
                curr = node['world']
                target_world_id = None
                while curr is not None:
                     if curr in self.world_definitions and call_name in self.world_definitions[curr]:
                          # Found the definition node!
                          def_node_id = self.world_definitions[curr][call_name]
                          # The world it CREATES is its own ID
                          target_world_id = def_node_id
                          break
                     curr = world_parents.get(curr)
                
                if target_world_id:
                     node['data']['target_world'] = target_world_id

# --- INJECTION ---
def inject_code(existing_graph, code_snippet, target_world="root"):
    # Injection logic needs to be updated to respect the new linking if we want perfect fidelity,
    # but for now we stick to basic injection.
    try:
        tree = cst.parse_module(code_snippet)
        visitor = WorldVisitor(start_world=target_world)
        tree.visit(visitor)
        visitor.link_calls() # Run linking on the new snippet
        existing_graph['nodes'].extend(visitor.graph['nodes'])
        existing_graph['edges'].extend(visitor.graph['edges'])
        return True, len(visitor.graph['nodes'])
    except Exception as e: return False, str(e)

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "playground/target.py"
    if os.path.exists(target):
        with open(target, "r") as f: source = f.read()
        visitor = WorldVisitor()
        cst.parse_module(source).visit(visitor)
        visitor.link_calls() # <--- CRITICAL NEW STEP
        with open("graph.json", "w") as f: json.dump(visitor.graph, f, indent=2)
        print(f"✅ Parsed {target} -> graph.json ({len(visitor.graph['nodes'])} nodes)")