import json, cmd, os, uuid

class MasterDebugger(cmd.Cmd):
    intro = '🛠️ Small Graph Editor. Type ? for help.\nNavigation: ls, enter <node>, up, jump <node>\nEditing:    add <type> <label>, rm <node_id>, link <src> <tgt> <type>, unlink <idx>, save\n'
    prompt = '(root) > '
    
    def __init__(self):
        super().__init__()
        self.graph = None
        self.current_world = "root"
        self.world_stack = []
        self.current_node_id = None
        self.node_history = []
        if os.path.exists("graph.json"): self.do_load("graph.json")

    def _get_node(self, node_id):
        return next((n for n in self.graph['nodes'] if n['id'] == node_id), None)

    def _update_prompt(self):
        world_label = "root"
        if self.current_world != "root":
             wn = self._get_node(self.current_world)
             if wn: world_label = wn['label']
        
        node_part = ""
        if self.current_node_id:
             nn = self._get_node(self.current_node_id)
             if nn: node_part = f" [{nn['type']}:{nn['label']}]"

        self.prompt = f"({world_label}{node_part}) > "

    # --- FILE OPS ---
    def do_load(self, arg):
        """Load a graph JSON file: load graph.json"""
        try:
            with open(arg or "graph.json", 'r') as f: self.graph = json.load(f)
            print(f"✅ Loaded {len(self.graph['nodes'])} nodes.")
            self._update_prompt()
        except: print("❌ Load failed.")

    def do_save(self, arg):
        """Save the current graph to JSON: save [filename]"""
        if not self.graph: print("❌ No graph to save."); return
        filename = arg.strip() or "graph.json"
        try:
            with open(filename, 'w') as f: json.dump(self.graph, f, indent=2)
            print(f"💾 Saved graph to {filename}")
        except Exception as e: print(f"❌ Save failed: {e}")

    # --- EDITING COMMANDS ---
    def do_add(self, arg):
        """Add a node to the current world: add CALL print"""
        args = arg.strip().split(maxsplit=1)
        if len(args) < 2: print("Usage: add <TYPE> <LABEL> (e.g., add LITERAL 5)"); return
        ntype, label = args[0].upper(), args[1]
        
        new_id = f"{ntype}_{uuid.uuid4().hex[:8]}"
        new_node = {"id": new_id, "type": ntype, "label": label, "world": self.current_world, "data": {}}
        
        # If it's a variable, default it to write mode so it shows up in synthesis
        if ntype == 'VARIABLE': new_node['data']['mode'] = 'write'
            
        self.graph['nodes'].append(new_node)
        print(f"✨ Added node: {new_id} [{ntype}] {label}")
        # Auto-select the new node for quick linking
        self.current_node_id = new_id
        self._update_prompt()

    def do_rm(self, arg):
        """Remove a node and its edges: rm CALL_123"""
        target_id = arg.strip() or self.current_node_id
        if not target_id: print("❌ Specify node ID or select one first."); return
        
        # 1. Remove the node
        initial_len = len(self.graph['nodes'])
        self.graph['nodes'] = [n for n in self.graph['nodes'] if n['id'] != target_id]
        
        if len(self.graph['nodes']) == initial_len:
             print(f"❌ Node {target_id} not found.")
             return

        # 2. Remove associated edges
        before_edges = len(self.graph['edges'])
        self.graph['edges'] = [e for e in self.graph['edges'] if e['source'] != target_id and e['target'] != target_id]
        removed_edges = before_edges - len(self.graph['edges'])

        print(f"🗑️ Removed node {target_id} and {removed_edges} edges.")
        if self.current_node_id == target_id: 
            self.current_node_id = None
            self._update_prompt()

    def do_link(self, arg):
        """Create an edge: link <src_id> <tgt_id> <type>"""
        args = arg.strip().split()
        if len(args) < 3: print("Usage: link <source_id> <target_id> <TYPE> (Types: ARGUMENT, OPERAND, WRITES_TO, INPUT)"); return
        src, tgt, etype = args[0], args[1], args[2].upper()
        
        # Verify nodes exist
        if not self._get_node(src): print(f"❌ Source {src} not found."); return
        if not self._get_node(tgt): print(f"❌ Target {tgt} not found."); return

        self.graph['edges'].append({"source": src, "target": tgt, "type": etype, "label": None})
        print(f"🔗 Linked {src} --({etype})--> {tgt}")

    def do_unlink(self, arg):
        """Remove an edge by its index shown in 'neighbors': unlink 5"""
        try:
            idx = int(arg.strip())
            if 0 <= idx < len(self.graph['edges']):
                edge = self.graph['edges'].pop(idx)
                print(f"✂️ Unlinked {edge['source']} --({edge['type']})--> {edge['target']}")
            else: print("❌ Invalid edge index.")
        except: print("❌ Usage: unlink <numeric_index>")

    # --- NAVIGATION (Same as V4.1 Master Debugger) ---
    def do_ls(self, arg):
        print(f"\n🌎 WORLD: {self.current_world}\n" + "-"*50)
        count = 0
        for n in self.graph['nodes']:
            if n['world'] == self.current_world:
                prefix = "📦" if n['type'] in ['FUNCTION_DEF', 'CLASS_DEF'] else "  "
                pointer = "->" if n['id'] == self.current_node_id else "  "
                print(f"{pointer} {prefix} {n['id'].ljust(35)} | [{n['type']}] {n['label']}")
                count += 1
        print("-" * 50)
        print(f"Total visible: {count}")

    def do_enter(self, arg):
        target = next((n for n in self.graph['nodes'] if arg in n['id'] and n['world'] == self.current_world and n['type'] in ['FUNCTION_DEF', 'CLASS_DEF']), None)
        if target:
            self.world_stack.append(self.current_world)
            self.current_world = target['id']
            self.current_node_id = None
            self._update_prompt()
            self.do_ls("")
        else: print("❌ Cannot enter that node.")

    def do_up(self, arg):
        if self.world_stack:
            self.current_world = self.world_stack.pop()
            self.current_node_id = None
            self._update_prompt()
            self.do_ls("")
        else: print("⚠️ Already at root.")

    def do_jump(self, arg):
        target = next((n for n in self.graph['nodes'] if arg in n['id'] and n['world'] == self.current_world), None)
        if target:
            self.current_node_id = target['id']
            self._update_prompt()
            print(f"📍 Selected {target['label']}")
        else: print("❌ Node not found here.")

    def do_neighbors(self, arg):
        if not self.current_node_id: print("❌ No node selected."); return
        print(f"\n🔌 Connections for {self.current_node_id}:")
        for i, edge in enumerate(self.graph['edges']):
            if edge['target'] == self.current_node_id:
                src = self._get_node(edge['source'])
                world_info = "" if src['world'] == self.current_world else f" (from {src['world'][:8]}...)"
                print(f"[{i}] IN  --({edge['type']})--> FROM [{src['type']}] {src['label']}{world_info}")
            elif edge['source'] == self.current_node_id:
                 tgt = self._get_node(edge['target'])
                 world_info = "" if tgt['world'] == self.current_world else f" (to {tgt['world'][:8]}...)"
                 print(f"[{i}] OUT --({edge['type']})--> TO   [{tgt['type']}] {tgt['label']}{world_info}")
        print("")

    def do_exit(self, arg): return True

if __name__ == '__main__': MasterDebugger().cmdloop()