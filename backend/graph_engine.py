#!/usr/bin/env python3
"""
graph_engine.py - Versión minimalista para testing
"""

import os
import re
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Any
from dataclasses import dataclass, asdict

WORKSPACE_ROOT = Path.home() / ".hermes" / "workspaces"
DB_PATH = Path(__file__).parent / "library.db"


@dataclass
class Node:
    id: str
    type: str
    label: str
    path: str
    metadata: Dict[str, Any]
    position: Dict[str, float] = None
    def to_dict(self):
        return asdict(self)


@dataclass  
class Edge:
    source: str
    target: str
    type: str
    def to_dict(self):
        return asdict(self)


class GraphEngine:
    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []
        self._init_db()
    
    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute('CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, path TEXT, metadata TEXT, position TEXT)')
        conn.execute('CREATE TABLE IF NOT EXISTS edges (source TEXT, target TEXT, type TEXT, PRIMARY KEY (source, target, type))')
        conn.commit()
        conn.close()
    
    def load_from_db(self) -> Dict[str, Any]:
        conn = sqlite3.connect(self.db_path)
        nodes = []
        for row in conn.execute("SELECT * FROM nodes"):
            node = Node(id=row[0], type=row[1], label=row[2], path=row[3], metadata=json.loads(row[4]), position=json.loads(row[5]) if row[5] else None)
            self.nodes[node.id] = node
            nodes.append(node.to_dict())
        for row in conn.execute("SELECT * FROM edges"):
            self.edges.append(Edge(row[0], row[1], row[2]))
        conn.close()
        return {"nodes": nodes, "edges": [e.to_dict() for e in self.edges]}
    
    def build_graph(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        for nd in raw["nodes"]:
            self.nodes[nd["id"]] = Node(id=nd["id"], type=nd["type"], label=nd["label"], path=nd["path"], metadata=dict(nd.get("metadata", {})), position=nd.get("position"))
        
        for ed in raw["edges"]:
            self.edges.append(Edge(ed["source"], ed["target"], ed["type"]))
        
        conn = sqlite3.connect(self.db_path)
        for n in self.nodes.values():
            conn.execute("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?)", (n.id, n.type, n.label, n.path, json.dumps(n.metadata), json.dumps(n.position) if n.position else None))
        for e in self.edges:
            conn.execute("INSERT OR IGNORE INTO edges VALUES (?,?,?)", (e.source, e.target, e.type))
        conn.commit()
        conn.close()
        
        return {"nodes": [n.to_dict() for n in self.nodes.values()], "edges": [e.to_dict() for e in self.edges]}


if __name__ == "__main__":
    from scan_workspaces import scan_workspaces
    g = GraphEngine().build_graph(scan_workspaces())
    print(json.dumps(g, indent=2))