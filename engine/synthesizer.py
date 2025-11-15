import json, os, sys

class Synthesizer:
    def __init__(self, graph_file):
        with open(graph_file, 'r') as f: self.graph = json.load(f)

    def _get_node(self, nid): return next((n for n in self.graph['nodes'] if n['id'] == nid), None)

    # Helper to get inputs based on allowed edge types, sorted by index
    def _get_inputs(self, nid, edge_types, sort_key='index'):
        edges = [e for e in self.graph['edges'] if e['target'] == nid and e['type'] in edge_types]
        if sort_key:
            edges.sort(key=lambda e: (e['data'].get(sort_key) if e.get('data') else 0) or 0)
        return [e['source'] for e in edges]
        
    def _get_outputs(self, nid, edge_types, sort_key='index'):
        edges = [e for e in self.graph['edges'] if e['source'] == nid and e['type'] in edge_types]
        if sort_key:
            edges.sort(key=lambda e: (e['data'].get(sort_key) if e.get('data') else 0) or 0)
        return [e['target'] for e in edges]

    def _synth_expr(self, nid):
        node = self._get_node(nid)
        if not node:
            print(f"DEBUG: _synth_expr called with invalid node ID: {nid}")
            return "None"

        ntype = node['type']
        print(f"DEBUG: Synthesizing {ntype} node {nid} with label '{node.get('label', 'N/A')}'")

        # Get port defaults if they exist
        port_defaults = node.get('data', {}).get('port_defaults', {})
        print(f"DEBUG: Port defaults for {nid}: {port_defaults}")

        if ntype == 'LITERAL':
            label = node['label']
            # Add quotes around strings
            if isinstance(label, str) and not (label.startswith('"') or label.startswith("'")):
                # Check if it's a number
                try:
                    float(label)
                    result = label  # It's a number, don't quote
                except ValueError:
                    result = f'"{label}"'  # It's a string, add quotes
            else:
                result = label
            print(f"DEBUG: LITERAL {nid} -> {result}")
            return result
        elif ntype == 'VARIABLE':
            result = node['label']
            print(f"DEBUG: VARIABLE {nid} -> {result}")
            return result
        elif ntype == 'OPERATOR':
            inputs = self._get_inputs(nid, ["OPERAND"])
            print(f"DEBUG: OPERATOR {nid} inputs: {[inp for inp in inputs]}")

            op0 = port_defaults.get('operand_0', None)
            op1 = port_defaults.get('operand_1', None)
            print(f"DEBUG: OPERATOR {nid} port_defaults: op0={op0}, op1={op1}")

            op0_str = op0 if op0 is not None else (self._synth_expr(inputs[0]) if len(inputs) > 0 else "None")
            op1_str = op1 if op1 is not None else (self._synth_expr(inputs[1]) if len(inputs) > 1 else "None")

            result = f"({op0_str} {node['label']} {op1_str})"
            print(f"DEBUG: OPERATOR {nid} -> {result}")
            return result
            
        elif ntype == 'CALL':
            params = node.get('data', {}).get('params', [])
            wired_args = {e['data'].get('keyword') or e['data'].get('index'): e['source']
                          for e in self.graph['edges']
                          if e['target'] == nid and e['type'] == 'ARGUMENT'}

            # Also check for DATA_FLOW edges with port_name (from port literals)
            port_literal_args = {}
            for edge in self.graph['edges']:
                if (edge['target'] == nid and edge['type'] == 'DATA_FLOW' and
                    edge.get('data', {}).get('port_name')):
                    port_literal_args[edge['data']['port_name']] = edge['source']

            print(f"DEBUG: CALL {nid} wired_args: {wired_args}")
            print(f"DEBUG: CALL {nid} port_literal_args: {port_literal_args}")
            print(f"DEBUG: CALL {nid} port_defaults: {port_defaults}")

            arg_strs = []

            # Build argument list, respecting parameters, defaults, wires, and port literals
            for i, param in enumerate(params):
                port_name = param.get('name')
                port_key_kw = port_name
                port_key_idx = i

                if port_name in port_defaults:
                    arg_strs.append(f"{port_name}={port_defaults[port_name]}")
                elif port_name in port_literal_args:
                    arg_strs.append(f"{port_name}={self._synth_expr(port_literal_args[port_name])}")
                elif port_key_kw in wired_args:
                    arg_strs.append(f"{port_name}={self._synth_expr(wired_args[port_key_kw])}")
                elif port_key_idx in wired_args:
                    arg_strs.append(self._synth_expr(wired_args[port_key_idx]))
                elif port_name in port_defaults:
                    # Handle positional arguments with port defaults
                    arg_strs.append(port_defaults[port_name])
                else:
                    # For unlinked parameters, use None or default
                    arg_strs.append("None")

            call_str = f"{node['label']}({', '.join(arg_strs)})"

            # Handle method calls
            if node['data'].get('is_method'):
                obj_id_list = self._get_inputs(nid, ["ATTRIBUTE_VALUE"])
                obj_str = port_defaults.get('attribute_value', None)
                
                if obj_str is None and obj_id_list:
                    obj_str = self._synth_expr(obj_id_list[0])
                
                if obj_str:
                    return f"{obj_str}.{call_str}"
                
            return call_str
        
        # --- RENAMED DATA STRUCTURES ---
        elif ntype == 'LIST_CONSTRUCTOR':
            items = [self._synth_expr(i) for i in self._get_inputs(nid, ["LIST_ELEMENT"])]
            return f"[{', '.join(items)}]"
        elif ntype == 'DICT_CONSTRUCTOR':
            keys = self._get_inputs(nid, ["DICT_KEY"])
            values = self._get_inputs(nid, ["DICT_VALUE"])
            # Only create pairs for the minimum available keys/values
            min_len = min(len(keys), len(values))
            pairs = [f"{self._synth_expr(keys[i])}: {self._synth_expr(values[i])}" for i in range(min_len)]
            return f"{{{', '.join(pairs)}}}"
        elif ntype == 'ACCESSOR':
            val_id_list = self._get_inputs(nid, ["ACCESS_VALUE"])
            key_id_list = self._get_inputs(nid, ["ACCESS_KEY"])

            val_str = port_defaults.get('access_value', None)
            key_str = port_defaults.get('access_key', None)
            
            if val_str is None and val_id_list: val_str = self._synth_expr(val_id_list[0])
            if key_str is None and key_id_list: key_str = self._synth_expr(key_id_list[0])

            return f"{val_str}[{key_str}]"
            
        elif ntype == 'ATTRIBUTE':
            val_id_list = self._get_inputs(nid, ["ATTRIBUTE_VALUE"])
            val_str = port_defaults.get('attribute_value', None)
            
            if val_str is None and val_id_list: val_str = self._synth_expr(val_id_list[0])

            return f"{val_str}.{node['label']}"
            
        return "pass"

    # --- _write_world and other functions (Unchanged from previous) ---

    def _synth_if_chain(self, node, indent, processed_ids):
        lines = []
        pre = "    " * indent
        processed_ids.add(node['id'])
        
        test_str = "True" # Default
        test_input = self._get_inputs(node['id'], ["INPUT"])
        if test_input:
            test_str = self._synth_expr(test_input[0])
        
        if node['type'] == 'IF_BLOCK':
            lines.append(f"\n{pre}if {test_str}:")
        elif node['type'] == 'ELIF_BLOCK':
            lines.append(f"{pre}elif {test_str}:")
        elif node['type'] == 'ELSE_BLOCK':
            lines.append(f"{pre}else:")
        
        body = self._write_world(node['id'], indent + 1, processed_ids)
        lines.extend(body if body else [f"{pre}    pass"])
        
        # Follow the chain
        next_ids = self._get_outputs(node['id'], ["NEXT_CLAUSE"])
        if next_ids:
            next_node = self._get_node(next_ids[0])
            if next_node:
                lines.extend(self._synth_if_chain(next_node, indent, processed_ids))
        return lines

    # --- NEW: Extracted Node Writer ---
    def _write_node(self, node, indent, processed_ids):
        lines = []
        pre = "    " * indent
        ntype = node['type']

        if ntype == 'IMPORT':
            lines.append(f"{pre}{node['label']}")
        elif ntype == 'FUNCTION_DEF':
            params = node['data'].get('params', [])
            param_names = [p['name'] for p in params]
            lines.append(f"\n{pre}def {node['label']}({', '.join(param_names)}):")
            body = self._write_world(node['id'], indent + 1)
            lines.extend(body if body else [f"{pre}    pass"])
        elif ntype == 'CLASS_DEF':  # Added Class Support
            lines.append(f"\n{pre}class {node['label']}:")
            body = self._write_world(node['id'], indent + 1)
            lines.extend(body if body else [f"{pre}    pass"])
        elif ntype == 'VARIABLE' and node['data'].get('mode') == 'write':
            inputs = self._get_inputs(node['id'], ["WRITES_TO"])
            if inputs: lines.append(f"{pre}{node['label']} = {self._synth_expr(inputs[0])}")
        elif ntype == 'CALL':
            is_nested = any(e['source'] == node['id'] and e['type'] not in ['CLOSURE_OF', 'NEXT_CLAUSE'] for e in self.graph['edges'])
            if not is_nested: lines.append(f"{pre}{self._synth_expr(node['id'])}")
        elif ntype == 'RETURN':
            inputs = self._get_inputs(node['id'], ["INPUT"])
            lines.append(f"{pre}return {self._synth_expr(inputs[0])}" if inputs else f"{pre}return")

        # Control Flow
        elif ntype == 'IF_BLOCK':
            lines.extend(self._synth_if_chain(node, indent, processed_ids))
        elif ntype in ['ELIF_BLOCK', 'ELSE_BLOCK']:
            pass  # Handled by chain

        elif ntype == 'FOR_BLOCK':
            iter_str = self._synth_expr(self._get_inputs(node['id'], ["ITERATES_ON"])[0])
            target_str = node['data']['target']
            lines.append(f"\n{pre}for {target_str} in {iter_str}:")
            body = self._write_world(node['id'], indent + 1)
            lines.extend(body if body else [f"{pre}    pass"])
        elif ntype == 'WHILE_BLOCK':
            test_str = self._synth_expr(self._get_inputs(node['id'], ["INPUT"])[0])
            lines.append(f"\n{pre}while {test_str}:")
            body = self._write_world(node['id'], indent + 1)
            lines.extend(body if body else [f"{pre}    pass"])
        elif ntype == 'TRY_BLOCK':
            lines.append(f"\n{pre}try:")
            body = self._write_world(node['id'], indent + 1)
            lines.extend(body if body else [f"{pre}    pass"])

            except_ids = self._get_outputs(node['id'], ["NEXT_CLAUSE"])
            for ex_id in except_ids:
                ex_node = self._get_node(ex_id)
                processed_ids.add(ex_id)
                lines.append(f"{pre}{ex_node['label']}:")
                ex_body = self._write_world(ex_id, indent + 1)
                lines.extend(ex_body if ex_body else [f"{pre}    pass"])

        return lines

    def _write_world(self, world_id="root", indent=0, processed_ids=None):
        lines = []
        world_nodes = [n for n in self.graph['nodes'] if n['world'] == world_id]

        # Sort nodes to ensure proper execution order in function bodies
        if world_id != 'root':
            # In function worlds, put executable statements (CALL) before control flow (RETURN)
            def sort_key(node):
                priority = {
                    'CALL': 1,      # Executable statements first
                    'VARIABLE': 2,  # Variable assignments second
                    'RETURN': 3,    # Return last
                    'OTHER': 4      # Everything else
                }
                return priority.get(node['type'], priority['OTHER'])

            world_nodes.sort(key=sort_key)
            print(f"DEBUG: _write_world({world_id}, indent={indent}) - found {len(world_nodes)} nodes (sorted for execution order)")

        print(f"DEBUG: _write_world({world_id}, indent={indent}) - processing {len(world_nodes)} nodes")

        if processed_ids is None:
            processed_ids = set()

        for node in world_nodes:
            if node['id'] in processed_ids:
                print(f"DEBUG: Skipping already processed node {node['id']}")
                continue

            processed_ids.add(node['id'])
            lines.extend(self._write_node(node, indent, processed_ids))

        print(f"DEBUG: _write_world({world_id}) returning {len(lines)} lines")
        return lines

    # --- NEW: Public method for single node ---
    def generate_node_code(self, node_id):
        node = self._get_node(node_id)
        if not node: return f"# Node {node_id} not found"
        processed_ids = set()
        lines = self._write_node(node, 0, processed_ids)
        return "\n".join(lines)

    # --- UPDATED: generate_code ---
    def generate_code(self):
        # Process imports first, then the root
        processed_ids = set()
        
        # 1. Synthesize imports
        import_lines = self._write_world("world_imports", 0, processed_ids)
        
        # 2. Synthesize main code
        root_lines = self._write_world("root", 0, processed_ids)
        
        # 3. Combine them
        return "\n".join(import_lines) + "\n\n" + "\n".join(root_lines)

    
    def run(self):
        code = self.generate_code()
        print("🏗️ Synthesized Code:\n" + "-"*40 + "\n" + code + "\n" + "-"*40)
        print("🚀 Executing...")
        try: exec(code, {"__builtins__": __builtins__})
        except Exception as e: print(f"❌ Runtime Error: {e}")

if __name__ == "__main__":
    if os.path.exists("graph.json"): Synthesizer("graph.json").run()
    else: print("❌ graph.json not found. Run xray.py first.")
