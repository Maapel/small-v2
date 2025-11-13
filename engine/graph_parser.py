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
        self.world_definitions = {start_world: {}, "world_imports": {}} # Add world_imports
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
            
            # Determine edge type based on parent
            if parent["type"] == "ARGUMENT":
                etype = "ARGUMENT"
                edge_data = { "index": parent.get("index"), "keyword": parent.get("keyword") }
            elif parent["type"] == "OPERAND": 
                etype = "OPERAND"
                edge_data = {"index": parent.get("index", 0)}
            elif parent["type"] == "ASSIGNMENT": etype = "WRITES_TO"
            elif parent["type"] == "LIST_ELEMENT":
                etype = "LIST_ELEMENT"
                edge_data = {"index": parent.get("index", 0)}
            elif parent["type"] == "DICT_KEY":
                etype = "DICT_KEY"
                edge_data = {"index": parent.get("index", 0)}
            elif parent["type"] == "DICT_VALUE":
                etype = "DICT_VALUE"
                edge_data = {"index": parent.get("index", 0)}
            elif parent["type"] == "ACCESS_VALUE": etype = "ACCESS_VALUE"
            elif parent["type"] == "ACCESS_KEY": etype = "ACCESS_KEY"
            elif parent["type"] == "ATTRIBUTE_VALUE": etype = "ATTRIBUTE_VALUE"
            elif parent["type"] == "ITERATES_ON": etype = "ITERATES_ON"
            
            self._add_edge(child_id, parent["node_id"], etype, data=edge_data)

    # --- IMPORTS (NEW) ---
    def visit_Import(self, n):
        self._add_node("IMPORT", cst.Module(n).code_for_node(n), world="world_imports")
        return False # Do not visit children

    def visit_ImportFrom(self, n):
        self._add_node("IMPORT", cst.Module(n).code_for_node(n), world="world_imports")
        return False # Do not visit children

    # --- WORLDS / CONTAINERS ---
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

    # --- CONTROL FLOW (NEW) ---
    def visit_For(self, n):
        iter_str = cst.Module(n.iter).code_for_node(n.iter)
        target_str = cst.Module(n.target).code_for_node(n.target)
        label = f"for {target_str} in {iter_str}"
        loop_id = self._add_node("FOR_BLOCK", label, {"target": target_str, "iter": iter_str})
        
        # Parse the iterator expression
        self.active_parent_stack.append({"type": "ITERATES_ON", "node_id": loop_id})
        n.iter.visit(self)
        self.active_parent_stack.pop()

        # Push new world for loop body
        self.world_stack.append(self.current_world)
        self.current_world = loop_id
        self.symbols.push_scope()
        
        # Add loop variable(s) to the new scope
        pid = self._add_node("VARIABLE", target_str, {"mode": "param", "version": 1}, world=self.current_world)
        self.symbols.define_write(target_str, pid, self.current_world)
        
        n.body.visit(self) # Visit body
        return False # We handled the body
    
    def leave_For(self, n):
        self.current_world = self.world_stack.pop()
        self.symbols.pop_scope()

    def visit_While(self, n):
        test_str = cst.Module(n.test).code_for_node(n.test)
        loop_id = self._add_node("WHILE_BLOCK", f"while {test_str}", {"test": test_str})
        
        self.active_parent_stack.append({"type": "INPUT", "node_id": loop_id})
        n.test.visit(self)
        self.active_parent_stack.pop()

        self.world_stack.append(self.current_world)
        self.current_world = loop_id
        self.symbols.push_scope()
        n.body.visit(self)
        return False

    def leave_While(self, n):
        self.current_world = self.world_stack.pop()
        self.symbols.pop_scope()

    def visit_If(self, n):
        test_str = cst.Module(n.test).code_for_node(n.test)
        if_id = self._add_node("IF_BLOCK", f"if {test_str}", {"test": test_str})
        
        self.active_parent_stack.append({"type": "INPUT", "node_id": if_id})
        n.test.visit(self)
        self.active_parent_stack.pop()

        # Handle 'if' body
        self.world_stack.append(self.current_world)
        self.current_world = if_id
        self.symbols.push_scope()
        n.body.visit(self)
        self.symbols.pop_scope()
        self.current_world = self.world_stack.pop()

        # Handle 'orelse' (elif or else)
        if n.orelse:
            self.active_parent_stack.append({"type": "NEXT_CLAUSE", "node_id": if_id})
            
            if isinstance(n.orelse, cst.If):
                # This is an 'elif'
                test_str = cst.Module(n.orelse.test).code_for_node(n.orelse.test)
                elif_id = self._add_node("ELIF_BLOCK", f"elif {test_str}", {"test": test_str})
                self._connect_to_active_parent(elif_id)
                
                # Visit the 'elif' as if it's a new 'If'
                n.orelse.visit(self)
                
            elif isinstance(n.orelse, cst.SimpleBlock):
                # This is an 'else'
                else_id = self._add_node("ELSE_BLOCK", "else")
                self._connect_to_active_parent(else_id)
                
                self.world_stack.append(self.current_world)
                self.current_world = else_id
                self.symbols.push_scope()
                n.orelse.visit(self)
                self.symbols.pop_scope()
                self.current_world = self.world_stack.pop()

            self.active_parent_stack.pop()

        return False # We handled all children

    def visit_Try(self, n):
        try_id = self._add_node("TRY_BLOCK", "try")
        self.world_stack.append(self.current_world)
        self.current_world = try_id
        self.symbols.push_scope()
        n.body.visit(self)
        self.symbols.pop_scope()
        self.current_world = self.world_stack.pop()
        
        for i, handler in enumerate(n.handlers):
            self.active_parent_stack.append({"type": "NEXT_CLAUSE", "node_id": try_id, "index": i})
            handler.visit(self)
            self.active_parent_stack.pop()
            
        return False # Handled children

    def visit_ExceptHandler(self, n):
        label = "except"
        if n.type: label += f" {cst.Module(n.type).code_for_node(n.type)}"
        if n.name: label += f" as {n.name.value}"
        
        except_id = self._add_node("EXCEPT_BLOCK", label)
        self._connect_to_active_parent(except_id)
        
        if n.type:
            self.active_parent_stack.append({"type": "INPUT", "node_id": except_id})
            n.type.visit(self)
            self.active_parent_stack.pop()

        self.world_stack.append(self.current_world)
        self.current_world = except_id
        self.symbols.push_scope()
        
        if n.name:
            pid = self._add_node("VARIABLE", n.name.value, {"mode": "param"}, world=self.current_world)
            self.symbols.define_write(n.name.value, pid, self.current_world)
            
        n.body.visit(self)
        self.symbols.pop_scope()
        self.current_world = self.world_stack.pop()
        return False

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
        fname = "unknown"
        if isinstance(n.func, cst.Name):
            fname = n.func.value
            self.ignore_next_name = True
        elif isinstance(n.func, cst.Attribute):
            # This will create an ATTRIBUTE node, just get the full code
            fname = cst.Module(n.func).code_for_node(n.func)
        
        nid = self._add_node("CALL", fname)
        self._connect_to_active_parent(nid)
        
        # If it's an attribute, parse the object it's being called on
        if isinstance(n.func, cst.Attribute):
             self.active_parent_stack.append({"type": "ATTRIBUTE_VALUE", "node_id": nid})
             n.func.value.visit(self)
             self.active_parent_stack.pop()
             # Update node label to just the method name
             self.graph['nodes'][-1]['label'] = n.func.attr.value
             self.graph['nodes'][-1]['data']['is_method'] = True
        
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
    
    # --- DATA STRUCTURES (FIXED) ---
    
    def visit_List(self, n):
        nid = self._add_node("LIST_CONSTRUCTOR", "[]")
        self._connect_to_active_parent(nid)
        
        # Manually visit each element with the correct index
        for i, el in enumerate(n.elements):
            self.active_parent_stack.append({"type": "LIST_ELEMENT", "node_id": nid, "index": i})
            el.value.visit(self) # Visit the cst.ListElement's value
            self.active_parent_stack.pop()
            
        return False # We handled all children
    
    def leave_List(self, n):
        pass # No-op, stack was handled inside visit_List

    def visit_ListElement(self, n):
        # This should never be called now
        return False

    def visit_Dict(self, n):
        nid = self._add_node("DICT_CONSTRUCTOR", "{}")
        self._connect_to_active_parent(nid)
        
        for i, el in enumerate(n.elements):
            if isinstance(el, cst.DictElement):
                # Push for KEY
                self.active_parent_stack.append({"type": "DICT_KEY", "node_id": nid, "index": i})
                el.key.visit(self)
                self.active_parent_stack.pop()
                
                # Push for VALUE
                self.active_parent_stack.append({"type": "DICT_VALUE", "node_id": nid, "index": i})
                el.value.visit(self)
                self.active_parent_stack.pop()
        
        return False # We handled all children

    def leave_Dict(self, n):
        pass # No-op

    def visit_DictElement(self, n):
        # This should never be called now
        return False

    def visit_Subscript(self, n):
        nid = self._add_node("ACCESSOR", "[]")
        self._connect_to_active_parent(nid)
        
        # Push for the value (e.g., 'my_list')
        self.active_parent_stack.append({"type": "ACCESS_VALUE", "node_id": nid})
        n.value.visit(self)
        self.active_parent_stack.pop()
        
        # Push for the key (e.g., '0')
        self.active_parent_stack.append({"type": "ACCESS_KEY", "node_id": nid})
        for slice_node in n.slice:
             slice_node.slice.visit(self) # Visit the cst.Index's value
        self.active_parent_stack.pop()
        
        return False # We visited children
        
    def visit_Attribute(self, n):
        nid = self._add_node("ATTRIBUTE", n.attr.value)
        self._connect_to_active_parent(nid)
        
        # Push for the value (e.g., 'self')
        self.active_parent_stack.append({"type": "ATTRIBUTE_VALUE", "node_id": nid})
        n.value.visit(self)
        self.active_parent_stack.pop()
        return False # We visited children

    # --- VARIABLE READS (UPDATED) ---
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

             self._connect_to_active_parent(source_id_to_link)

    def link_calls(self):
        world_parents = {"root": None}
        all_defs = {} 
        for node in self.graph['nodes']:
             if node['type'] in ['FUNCTION_DEF', 'CLASS_DEF']:
                  world_parents[node['id']] = node['world']
                  all_defs[node['id']] = node
                  
        for node in self.graph['nodes']:
            if node['type'] == 'CALL' and not node['data'].get('is_method'):
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

# --- NEW HELPER: Remove Nodes ---
def remove_nodes(graph: dict, node_ids: list[str]) -> dict:
    """
    Removes a list of nodes and their connected edges from the graph.
    """
    print(f"DEBUG: remove_nodes called with node_ids: {node_ids}")
    print(f"DEBUG: Initial graph has {len(graph.get('nodes', []))} nodes and {len(graph.get('edges', []))} edges.")

    node_id_set = set(node_ids)
    
    # Filter nodes
    initial_node_count = len(graph.get('nodes', []))
    graph['nodes'] = [n for n in graph['nodes'] if n['id'] not in node_id_set]
    final_node_count = len(graph['nodes'])
    print(f"DEBUG: Nodes filtered. Before: {initial_node_count}, After: {final_node_count}")

    # Filter edges
    initial_edge_count = len(graph.get('edges', []))
    graph['edges'] = [
        e for e in graph['edges'] 
        if e['source'] not in node_id_set and e['target'] not in node_id_set
    ]
    final_edge_count = len(graph['edges'])
    print(f"DEBUG: Edges filtered. Before: {initial_edge_count}, After: {final_edge_count}")
    
    return graph

# --- NEW HELPER: Update Literal ---
def update_node_literal(graph: dict, node_id: str, new_label: str) -> dict:
    """
    Finds a node and updates its label.
    This is for simple LITERAL nodes.
    """
    for node in graph['nodes']:
        if node['id'] == node_id:
            if node['type'] == 'LITERAL':
                node['label'] = new_label
                break
    return graph

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
