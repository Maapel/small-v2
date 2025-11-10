import json, cmd, os

class MasterDebugger(cmd.Cmd):
    intro = '🔭 Small Master Debugger. Type ? for help.\nTop-level commands: ls, enter <node>, up\nNode-level commands: jump <node>, neighbors, follow <edge>'
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

    def do_load(self, arg):
        """load graph.json"""
        try:
            with open(arg or "graph.json", 'r') as f: self.graph = json.load(f)
            print(f"✅ Loaded {len(self.graph['nodes'])} nodes.")
        except: print("❌ Load failed.")

    # --- WORLD NAVIGATION ---
    def do_ls(self, arg):
        """List nodes in current world"""
        print(f"\n🌎 WORLD: {self.current_world}\n" + "-"*50)
        count = 0
        for n in self.graph['nodes']:
            if n['world'] == self.current_world:
                prefix = "📦" if n['type'] in ['FUNCTION_DEF', 'CLASS_DEF'] else "  "
                # Highlight current node if selected
                pointer = "->" if n['id'] == self.current_node_id else "  "
                print(f"{pointer} {prefix} {n['id'].ljust(35)} | [{n['type']}] {n['label']}")
                count += 1
        print("-" * 50)
        print(f"Total visible: {count}")

    def do_enter(self, arg):
        """Zoom into a world: enter FUNCTION_DEF_123"""
        target = next((n for n in self.graph['nodes'] 
                       if arg in n['id'] and n['world'] == self.current_world 
                       and n['type'] in ['FUNCTION_DEF', 'CLASS_DEF']), None)
        if target:
            self.world_stack.append(self.current_world)
            self.current_world = target['id']
            # When entering a world, clear specific node selection
            self.current_node_id = None
            self._update_prompt()
            self.do_ls("")
        else: print("❌ Cannot enter that node.")

    def do_up(self, arg):
        """Zoom out to parent world"""
        if self.world_stack:
            self.current_world = self.world_stack.pop()
            self.current_node_id = None
            self._update_prompt()
            self.do_ls("")
        else: print("⚠️ Already at root.")

    # --- NODE/EDGE NAVIGATION ---
    def do_jump(self, arg):
        """Select a specific node in the current world: jump CALL_123"""
        target = next((n for n in self.graph['nodes'] 
                       if arg in n['id'] and n['world'] == self.current_world), None)
        if target:
            self.current_node_id = target['id']
            self._update_prompt()
            print(f"📍 Selected {target['label']}")
        else: print("❌ Node not found in this world.")

    def do_neighbors(self, arg):
        """Show wires connected to the selected node"""
        if not self.current_node_id:
            print("❌ No node selected. Use 'jump <id>' first.")
            return

        print(f"\n🔌 Connections for {self.current_node_id}:")
        incoming = []
        outgoing = []
        
        for i, edge in enumerate(self.graph['edges']):
            if edge['target'] == self.current_node_id:
                src = self._get_node(edge['source'])
                # Show if it crosses worlds
                world_info = "" if src['world'] == self.current_world else f" (from world {src['world'][:8]}...)"
                incoming.append(f"[{i}] --({edge['type']})--> FROM [{src['type']}] {src['label']}{world_info}")
            elif edge['source'] == self.current_node_id:
                 tgt = self._get_node(edge['target'])
                 world_info = "" if tgt['world'] == self.current_world else f" (to world {tgt['world'][:8]}...)"
                 outgoing.append(f"[{i}] --({edge['type']})--> TO   [{tgt['type']}] {tgt['label']}{world_info}")

        print("\n📥 INCOMING:")
        for item in incoming: print(item)
        print("\n📤 OUTGOING:")
        for item in outgoing: print(item)
        print("")

    def do_follow(self, arg):
        """Follow a wire index: follow 5"""
        try:
            idx = int(arg.strip())
            edge = self.graph['edges'][idx]
            # Determine which end is new
            next_id = edge['source'] if edge['target'] == self.current_node_id else edge['target']
            next_node = self._get_node(next_id)
            
            # If wire crosses worlds, switch worlds automatically
            if next_node['world'] != self.current_world:
                print(f"🚀 Warp to world: {next_node['world']}")
                # For simplicity in this MVP, we just hard switch without tracking stack perfectly
                # A full version would need smarter stack management for cross-world jumps
                self.world_stack.append(self.current_world) 
                self.current_world = next_node['world']

            self.current_node_id = next_id
            self._update_prompt()
            self.do_neighbors("")
        except: print("❌ Invalid edge.")

    def do_exit(self, arg): return True

if __name__ == '__main__': MasterDebugger().cmdloop()