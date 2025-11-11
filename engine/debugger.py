import json, cmd, os, uuid, sys

# --- PATH SETUP ---
# Ensure we can find graph.json in the parent directory if running from engine/
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(CURRENT_DIR)
DEFAULT_GRAPH = os.path.join(ROOT_DIR, "graph.json")

# --- IMPORT PARSER ---
# We try to import the parser. 
# If you kept it as 'parser.py' (risky), change this line to: import parser as graph_parser
try:
    import graph_parser
except ImportError:
    # Fallback in case you run it from root as 'python -m engine.debugger'
    from . import graph_parser

class MasterDebugger(cmd.Cmd):
    intro = '🛠️ Small Master Debugger. Type ? for help.\n'
    prompt = '(root) > '
    
    def __init__(self):
        super().__init__()
        self.graph = {"nodes": [], "edges": []}
        self.current_world = "root"
        self.world_stack = []
        self.current_node_id = None
        # Auto-load from the standard root location
        if os.path.exists(DEFAULT_GRAPH): self.do_load(DEFAULT_GRAPH)

    def _get_node(self, nid): return next((n for n in self.graph['nodes'] if n['id'] == nid), None)

    def _update_prompt(self):
        w_label = "root"
        if self.current_world != "root" and self.current_world != "world_imports":
             wn = self._get_node(self.current_world)
             if wn: w_label = wn['label']
             elif self.current_world == "world_imports": w_label = "imports"
        n_label = f" [{self._get_node(self.current_node_id)['label']}]" if self.current_node_id else ""
        self.prompt = f"({w_label}{n_label}) > "

    # --- FILES ---
    def do_load(self, arg):
        # Use user arg, or default to the root graph.json
        target = arg.strip() or DEFAULT_GRAPH
        try:
            with open(target, 'r') as f: self.graph = json.load(f)
            print(f"✅ Loaded {len(self.graph['nodes'])} nodes from {os.path.basename(target)}")
            self.current_world = "root"
            self.world_stack = []
            self.current_node_id = None
            self._update_prompt()
        except: print(f"❌ Load failed for {target}")

    def do_save(self, arg):
        target = arg.strip() or DEFAULT_GRAPH
        with open(target, 'w') as f: json.dump(self.graph, f, indent=2)
        print(f"💾 Saved to {os.path.basename(target)}")

    # --- EDITING ---
    def do_add(self, arg):
        args = arg.strip().split(maxsplit=1)
        if len(args) < 2: print("Usage: add <TYPE> <LABEL>"); return
        ntype, label = args[0].upper(), args[1]
        nid = f"{ntype}_{uuid.uuid4().hex[:8]}"
        self.graph['nodes'].append({"id": nid, "type": ntype, "label": label, "world": self.current_world, "data": {}})
        if ntype == 'VARIABLE': self.graph['nodes'][-1]['data']['mode'] = 'write'
        print(f"✨ Added {nid}"); self.current_node_id = nid; self._update_prompt()

    def do_rm(self, arg):
        tgt = arg.strip() or self.current_node_id
        if not tgt: print("❌ Select node first."); return
        self.graph['nodes'] = [n for n in self.graph['nodes'] if n['id'] != tgt]
        self.graph['edges'] = [e for e in self.graph['edges'] if e['source'] != tgt and e['target'] != tgt]
        print(f"🗑️ Removed {tgt}"); self.current_node_id = None if self.current_node_id == tgt else self.current_node_id; self._update_prompt()

    def do_link(self, arg):
        args = arg.strip().split()
        if len(args) < 3: print("Usage: link <src> <tgt> <TYPE>"); return
        self.graph['edges'].append({"source": args[0], "target": args[1], "type": args[2].upper()})
        print(f"🔗 Linked.")

    def do_unlink(self, arg):
        if not self.current_node_id: print("❌ Select node first."); return
        try:
            idx = int(arg.strip())
            relevant_edges = []
            for i, edge in enumerate(self.graph['edges']):
                if edge['target'] == self.current_node_id or edge['source'] == self.current_node_id:
                    relevant_edges.append(i)
            if 0 <= idx < len(relevant_edges):
                removed = self.graph['edges'].pop(relevant_edges[idx])
                print(f"✂️ Unlinked {removed['source']} -[{removed['type']}]-> {removed['target']}")
            else: print("❌ Invalid neighbor index.")
        except: print("Usage: unlink <number>")

    def do_inject(self, arg):
        parts = arg.strip().split(maxsplit=1)
        filepath = parts[0]
        target_world = parts[1] if len(parts) > 1 else self.current_world
        
        if not os.path.exists(filepath): print(f"❌ File {filepath} not found."); return
        with open(filepath, 'r') as f: snippet = f.read()
        
        # Use the imported graph_parser to inject
        success, msg = graph_parser.inject_code(self.graph, snippet, target_world)
        print(f"✨ Injected {msg} nodes into {target_world}." if success else f"❌ Failed: {msg}")
        if success: self.do_ls("")

    # --- NAVIGATION ---
    def do_ls(self, arg):
        print(f"\n🌎 WORLD: {self.current_world}\n" + "-"*50)
        for n in self.graph['nodes']:
            if n['world'] == self.current_world:
                pre = "  "
                if n['type'] in ['FUNCTION_DEF','CLASS_DEF']: pre = "📦"
                elif n['type'] in ['IF_BLOCK', 'FOR_BLOCK', 'WHILE_BLOCK', 'TRY_BLOCK', 'EXCEPT_BLOCK']: pre = "🌀"
                elif n['type'] == 'IMPORT': pre = "📥"
                
                ptr = "->" if n['id'] == self.current_node_id else "  "
                print(f"{ptr} {pre} {n['id'].ljust(35)} | [{n['type']}] {n['label']}")
        print("-" * 50)

    def do_enter(self, arg):
        # Updated to include control flow blocks
        ENTERABLE_TYPES = [
            'FUNCTION_DEF', 'CLASS_DEF', 
            'IF_BLOCK', 'ELIF_BLOCK', 'ELSE_BLOCK',
            'FOR_BLOCK', 'WHILE_BLOCK', 
            'TRY_BLOCK', 'EXCEPT_BLOCK'
        ]
        t = next((n for n in self.graph['nodes'] if arg in n['id'] and n['world'] == self.current_world and n['type'] in ENTERABLE_TYPES), None)
        if t: self.world_stack.append(self.current_world); self.current_world = t['id']; self.current_node_id = None; self._update_prompt(); self.do_ls("")
        else: print("❌ Cannot enter.")

    def do_up(self, arg):
        if self.world_stack: self.current_world = self.world_stack.pop(); self.current_node_id = None; self._update_prompt(); self.do_ls("")
        else: print("⚠️ At root.")

    def do_jump(self, arg):
        t = next((n for n in self.graph['nodes'] if arg in n['id'] and n['world'] == self.current_world), None)
        if t: self.current_node_id = t['id']; self._update_prompt(); print(f"📍 Selected {t['label']}")
        else: print("❌ Not found.")

    def do_worlds(self, arg):
        """(NEW) List all available worlds."""
        worlds = set(n['world'] for n in self.graph['nodes'])
        print("🌎 Available Worlds:")
        for w in sorted(list(worlds)):
            ptr = "->" if w == self.current_world else "  "
            label = w
            if w != 'root' and w != 'world_imports':
                n = self._get_node(w)
                label = f"{n['label']} ({w[:8]}...)"
            print(f"{ptr} {label}")
            
    def do_goto(self, arg):
        """(NEW) Jump to a specific world by name or ID."""
        target = arg.strip()
        worlds = set(n['world'] for n in self.graph['nodes'])
        
        if target in worlds:
            self.world_stack.append(self.current_world)
            self.current_world = target
            self.current_node_id = None
            self._update_prompt()
            self.do_ls("")
        else:
            print(f"❌ World '{target}' not found. Use 'worlds' to list.")

    def do_neighbors(self, arg):
        if not self.current_node_id: print("❌ No node selected."); return
        print(f"\n🔌 Connections for {self.current_node_id}:")
        count = 0
        for edge in self.graph['edges']:
            if edge['target'] == self.current_node_id:
                src = self._get_node(edge['source'])
                winf = "" if src['world'] == self.current_world else f" (from {src['world'][:8]}...)"
                print(f"[{count}] IN  --({edge['type']})--> FROM [{src['type']}] {src['label']}{winf}")
                count += 1
            elif edge['source'] == self.current_node_id:
                 tgt = self._get_node(edge['target'])
                 winf = "" if tgt['world'] == self.current_world else f" (to {tgt['world'][:8]}...)"
                 print(f"[{count}] OUT --({edge['type']})--> TO   [{tgt['type']}] {tgt['label']}{winf}")
                 count += 1
        print("")

    def do_follow(self, arg):
        if not self.current_node_id: print("❌ Select node first."); return
        try:
            idx = int(arg.strip())
            rel = [e for e in self.graph['edges'] if e['target'] == self.current_node_id or e['source'] == self.current_node_id]
            if 0 <= idx < len(rel):
                edge = rel[idx]
                next_id = edge['source'] if edge['target'] == self.current_node_id else edge['target']
                next_n = self._get_node(next_id)
                if next_n['world'] != self.current_world:
                     print(f"🚀 Warp to world: {next_n['world']}")
                     self.world_stack.append(self.current_world); self.current_world = next_n['world']
                self.current_node_id = next_id; self._update_prompt(); self.do_neighbors("")
            else: print("❌ Invalid index.")
        except: print("Usage: follow <number>")

    def do_exit(self, arg): return True

if __name__ == '__main__': MasterDebugger().cmdloop()