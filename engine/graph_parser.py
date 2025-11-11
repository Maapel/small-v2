import libcst as cst
import json
import os
import uuid
import sys

class SymbolTable:
    """
    Manages variable versions across nested scopes (Worlds).
    """
    def __init__(self):
        # scopes is a list of dicts.
        # Each dict maps var_name -> { "current_id": node_id, "version": int, "world": world_id }
        self.scopes = [{}] # Start with global scope

    def push_scope(self):
        self.scopes.append({})

    def pop_scope(self):
        if len(self.scopes) > 1:
            self.scopes.pop()

    def define_write(self, name, node_id, world_id):
        """
        A variable is written (assigned). This creates a NEW version.
        """
        scope = self.scopes[-1]
        version = scope.get(name, {}).get("version", 0) + 1
        scope[name] = {
            "current_id": node_id, 
            "version": version, 
            "world": world_id
        }
        return version

    def resolve_read(self, name):
        """
        A variable is read. Find the most recent definition
        by searching from the innermost scope outwards.
        Returns: (node_id, world_id)
        """
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]["current_id"], scope[name]["world"]
        return None, None # Not found (e.g., builtin)

class WorldVisitor(cst.CSTVisitor):
    def __init__(self, start_world="root"):
        self.graph = {"nodes": [], "edges": []}
        self.active_parent_stack = []
        self.call_stack = []
        self.current_world = start_world
        self.world_stack = [start_world] # Keep track of parent worlds
        self.in_lvalue = False
        self.ignore_next_name = False
        self.symbols = SymbolTable()
        self.world_definitions = {start_world: {}}
        self.current_arg_index = 0
        # Tracks proxies to avoid duplicates: proxy_cache[world_id][original_var_id] -> proxy_node_id
        self.proxy_cache = {}

    def _add_node(self, type, label, data=None, world=None):
        unique_id = f"{type}_{uuid.uuid4().hex[:8]}"
        w = world if world is not None else self.current_world
        self.graph["nodes"].append({
            "id": unique_id, "type": type, "label": label, 
            "world": w, "data": data or {}
        })
        return unique_id

    def _add_edge(self, source, target, etype="DATA_FLOW", label=None, data=None):    
        if not any(e['source'] == source and e['target'] == target and e['type'] == etype for e in self.graph["edges"]):
            self.graph["edges"].append({"source": source, "target": target, "type": etype, "label": label, "data": data or {}})

    def _connect_to_active_parent(self, child_id):
        if self.active_parent_stack:
            parent = self.active_parent_stack[-1]
            etype = "INPUT"
            edge_data = None
            if parent["type"] == "ARGUMENT":
                etype = "ARGUMENT"
                edge_data = { "index": parent.get("index"), "keyword": parent.get("keyword") }
            elif parent["type"] == "OPERAND": 
                etype = "OPERAND"
                edge_data = {"index": parent.get("index", 0)}
            elif parent["type"] == "ASSIGNMENT": etype = "WRITES_TO"
            
            self._add_edge(child_id, parent["node_id"], etype, data=edge_data)

    # --- WORLDS ---
    def visit_FunctionDef(self, n):
        params_list = []
        for param in n.params.params:
            params_list.append({ "name": param.name.value, "optional": param.default is not None })
        
        # 1. Add FunctionDef node to the *current* world
        func_id = self._add_node("FUNCTION_DEF", n.name.value, {"params": params_list})
        
        # 2. Register definition
        if self.current_world not in self.world_definitions:
             self.world_definitions[self.current_world] = {}
        self.world_definitions[self.current_world][n.name.value] = func_id

        # 3. Push new world and scope
        self.world_stack.append(self.current_world)
        self.current_world = func_id
        self.symbols.push_scope()
        self.proxy_cache[self.current_world] = {} # Init proxy cache for this new world
        
        # 4. Add parameters as the FIRST version of variables in this new scope
        for p_obj in params_list:
            pid = self._add_node("VARIABLE", p_obj["name"], {"mode": "param", "version": 1, "optional": p_obj["optional"]}, world=self.current_world)
            self.symbols.define_write(p_obj["name"], pid, self.current_world)

    def leave_FunctionDef(self, n):
        self.current_world = self.world_stack.pop()
        self.symbols.pop_scope()

    def visit_ClassDef(self, n):
        cid = self._add_node("CLASS_DEF", n.name.value)
        if self.current_world not in self.world_definitions: self.world_definitions[self.current_world] = {}
        self.world_definitions[self.current_world][n.name.value] = cid
        self.world_stack.append(self.current_world); self.current_world = cid; self.symbols.push_scope()
    def leave_ClassDef(self, n):
        self.current_world = self.world_stack.pop(); self.symbols.pop_scope()

    # --- DATA FLOW ---
    def visit_Assign(self, n):
        if len(n.targets) == 1 and isinstance(n.targets[0].target, cst.Name):
            var_name = n.targets[0].target.value
            var_id = self._add_node("VARIABLE", var_name, {"mode": "write"})
            version = self.symbols.define_write(var_name, var_id, self.current_world)
            self.graph["nodes"][-1]["data"]["version"] = version
            if version > 1: self.graph["nodes"][-1]["label"] = f"{var_name}_v{version}"
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
        if isinstance(n.func, cst.Attribute): fname = f"{n.func.value.value}.{n.func.attr.value}"
        if isinstance(n.func, cst.Name): self.ignore_next_name = True
        nid = self._add_node("CALL", fname)
        self._connect_to_active_parent(nid)
        self.call_stack.append(nid)
        self.current_arg_index = 0
    def leave_Call(self, n): 
        self.call_stack.pop(); self.ignore_next_name = False; self.current_arg_index = 0

    def visit_Arg(self, n): 
        self.ignore_next_name = False
        keyword = n.keyword.value if n.keyword else None
        if self.call_stack: 
            self.active_parent_stack.append({
                "type": "ARGUMENT", "node_id": self.call_stack[-1],
                "keyword": keyword, "index": None if keyword else self.current_arg_index
            })
        if not keyword: self.current_arg_index += 1
    def leave_Arg(self, n): 
        if self.active_parent_stack and self.active_parent_stack[-1]["type"]=="ARGUMENT": self.active_parent_stack.pop()

    def visit_BinaryOperation(self, n):
        op_map = {cst.Add: "+", cst.Subtract: "-", cst.Multiply: "*", cst.Divide: "/"}
        nid = self._add_node("OPERATOR", op_map.get(type(n.operator), "?"))
        self._connect_to_active_parent(nid)
        self.active_parent_stack.append({"type": "OPERAND", "node_id": nid, "index": 0})
    def visit_BinaryOperation_left(self, n):
        if self.active_parent_stack and self.active_parent_stack[-1]["type"] == "OPERAND":
            self.active_parent_stack[-1]["index"] = 0
    def visit_BinaryOperation_right(self, n):
        if self.active_parent_stack and self.active_parent_stack[-1]["type"] == "OPERAND":
            self.active_parent_stack[-1]["index"] = 1
    def leave_BinaryOperation(self, n): 
        if self.active_parent_stack and self.active_parent_stack[-1]["type"]=="OPERAND": self.active_parent_stack.pop()

    def _atomic(self, val, type, data=None):
        if self.active_parent_stack:
             nid = self._add_node(type, str(val), data)
             self._connect_to_active_parent(nid)
             return nid
        return None
    def visit_Integer(self, n): self._atomic(n.value, "LITERAL")
    def visit_Float(self, n): self._atomic(n.value, "LITERAL")
    def visit_SimpleString(self, n): self._atomic(n.value, "LITERAL")
    
    # --- MAJORLY UPDATED ---
    def visit_Name(self, n):
        if self.ignore_next_name: self.ignore_next_name = False; return
        if not self.in_lvalue and self.active_parent_stack:
             # This is a READ operation
             var_name = n.value
             # Find the current version of this variable
             original_var_id, var_world = self.symbols.resolve_read(var_name)
             
             if not original_var_id: return # Not found, likely builtin

             source_id_to_link = original_var_id

             # --- NEW PROXY LOGIC ---
             if var_world != self.current_world:
                 # It's a closure read! We MUST create a proxy.
                 world_proxies = self.proxy_cache.setdefault(self.current_world, {})
                 
                 if original_var_id not in world_proxies:
                     # Create a new proxy node IN THE CURRENT WORLD
                     proxy_id = self._add_node("VARIABLE", var_name, {
                         "mode": "closure_read", 
                         "origin_id": original_var_id,
                         "origin_world": var_world
                     })
                     world_proxies[original_var_id] = proxy_id
                     source_id_to_link = proxy_id
                     # Add a "portal" edge from the original to the proxy
                     self._add_edge(original_var_id, proxy_id, "CLOSURE_OF")
                 else:
                     source_id_to_link = world_proxies[original_var_id]
             # --- END PROXY LOGIC ---

             # Now, link from the correct source (original OR proxy) to the parent
             parent = self.active_parent_stack[-1]
             etype = "INPUT"
             edge_data = None
             if parent["type"] == "ARGUMENT": 
                 etype = "ARGUMENT"
                 edge_data = {"index": parent.get("index"), "keyword": parent.get("keyword")}
             elif parent["type"] == "OPERAND": 
                 etype = "OPERAND"
                 edge_data = {"index": parent.get("index")}
             elif parent["type"] == "ASSIGNMENT": etype = "WRITES_TO"
             
             self._add_edge(source_id_to_link, parent["node_id"], etype, data=edge_data)

    def link_calls(self):
        world_parents = {"root": None}
        all_defs = {} 
        for node in self.graph['nodes']:
             if node['type'] in ['FUNCTION_DEF', 'CLASS_DEF']:
                  world_parents[node['id']] = node['world']
                  all_defs[node['id']] = node
                  
        for node in self.graph['nodes']:
            if node['type'] == 'CALL':
                call_name = node['label']
                curr = node['world']
                target_def_id = None
                while curr is not None:
                     if curr in self.world_definitions and call_name in self.world_definitions[curr]:
                          target_def_id = self.world_definitions[curr][call_name]
                          break
                     curr = world_parents.get(curr)
                
                if target_def_id:
                     node['data']['target_world'] = target_def_id
                     target_def_node = all_defs.get(target_def_id)
                     if target_def_node:
                         node['data']['params'] = target_def_node['data'].get('params', [])

    def hydrate_unlinked_calls(self):
        for node in self.graph['nodes']:
            if node['type'] == 'CALL' and not node['data'].get('target_world') and not node['data'].get('params'):
                incoming_args = [e for e in self.graph['edges'] if e['target'] == node['id'] and e['type'] == 'ARGUMENT']
                if not incoming_args: continue
                params_list = []
                for edge in incoming_args:
                    if edge['data'] and edge['data'].get('keyword'):
                        params_list.append({"name": edge['data']['keyword'], "optional": False })
                
                max_index = -1
                for edge in incoming_args:
                     if edge['data'] and edge['data'].get('index') is not None:
                         max_index = max(max_index, edge['data']['index'])
                
                positional_args = [None] * (max_index + 1)
                for edge in incoming_args:
                    if edge['data'] and edge['data'].get('index') is not None:
                        positional_args[edge['data']['index']] = {"name": f"arg{edge['data']['index']}", "optional": False }
                
                params_list = [p for p in positional_args if p] + params_list
                node['data']['params'] = params_list

# --- INJECTION ---
def inject_code(existing_graph, code_snippet, target_world="root"):
    try:
        tree = cst.parse_module(code_snippet)
        visitor = WorldVisitor(start_world=target_world)
        # TODO: Symbol table must be pre-populated from existing_graph for injection to link correctly
        tree.visit(visitor)
        visitor.link_calls()
        visitor.hydrate_unlinked_calls() 
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
        visitor.link_calls()
        visitor.hydrate_unlinked_calls()
        with open("graph.json", "w") as f: json.dump(visitor.graph, f, indent=2)
        print(f"✅ Parsed {target} -> graph.json ({len(visitor.graph['nodes'])} nodes)")
    else:
        print(f"❌ Target file not found: {target}")