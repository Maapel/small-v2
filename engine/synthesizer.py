import json, os, sys

class Synthesizer:
    def __init__(self, graph_file):
        with open(graph_file, 'r') as f: self.graph = json.load(f)

    def _get_node(self, nid): return next((n for n in self.graph['nodes'] if n['id'] == nid), None)

    # Helper to get inputs based on allowed edge types
    def _get_inputs(self, nid, edge_types):
        return [e['source'] for e in self.graph['edges'] if e['target'] == nid and e['type'] in edge_types]

    def _synth_expr(self, nid):
        node = self._get_node(nid)
        if not node: return "None"
        if node['type'] == 'LITERAL': return node['label']
        elif node['type'] == 'VARIABLE': return node['label']
        elif node['type'] == 'OPERATOR':
            inputs = self._get_inputs(nid, ["OPERAND"])
            return f"({self._synth_expr(inputs[0])} {node['label']} {self._synth_expr(inputs[1])})" if len(inputs) >= 2 else "Error"
        elif node['type'] == 'CALL':
            args = [self._synth_expr(i) for i in self._get_inputs(nid, ["ARGUMENT"])]
            return f"{node['label']}({', '.join(args)})"
        return "pass"

    def _write_world(self, world_id="root", indent=0):
        lines = []
        pre = "    " * indent
        world_nodes = [n for n in self.graph['nodes'] if n['world'] == world_id]

        for node in world_nodes:
            if node['type'] == 'FUNCTION_DEF':
                params = node['data'].get('params', [])
                lines.append(f"\n{pre}def {node['label']}({', '.join(params)}):")
                body = self._write_world(node['id'], indent + 1)
                lines.extend(body if body else [f"{pre}    pass"])
            elif node['type'] == 'VARIABLE' and node['data'].get('mode') == 'write':
                inputs = self._get_inputs(node['id'], ["WRITES_TO"])
                if inputs: lines.append(f"{pre}{node['label']} = {self._synth_expr(inputs[0])}")
            elif node['type'] == 'CALL':
                 # Only write calls that aren't inputs to something else
                 is_nested = any(e['source'] == node['id'] and e['type'] in ['ARGUMENT', 'OPERAND', 'WRITES_TO', 'INPUT'] for e in self.graph['edges'])
                 if not is_nested: lines.append(f"{pre}{self._synth_expr(node['id'])}")
            elif node['type'] == 'RETURN':
                inputs = self._get_inputs(node['id'], ["INPUT"])
                lines.append(f"{pre}return {self._synth_expr(inputs[0])}" if inputs else f"{pre}return")
        return lines

    def generate_code(self):
        return "\n".join(self._write_world("root"))

    
    def run(self):
        code = self.generate_code()
        print("🏗️ Synthesized Code:\n" + "-"*40 + "\n" + code + "\n" + "-"*40)
        print("🚀 Executing...")
        try: exec(code, {"__builtins__": __builtins__})
        except Exception as e: print(f"❌ Runtime Error: {e}")

if __name__ == "__main__":
    if os.path.exists("graph.json"): Synthesizer("graph.json").run()
    else: print("❌ graph.json not found. Run xray.py first.")