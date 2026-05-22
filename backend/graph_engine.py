#!/usr/bin/env python3
"""
graph_engine.py - Versión minimalista para testing
"""

import shutil
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Any
from dataclasses import dataclass, asdict

import os

WORKSPACE_ROOT = Path.home() / ".hermes" / "workspaces"
_DB_DEFAULT = str(Path(__file__).parent / "library.db")
DB_PATH = Path(os.environ.get("DB_PATH", _DB_DEFAULT))


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
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute('CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, path TEXT, metadata TEXT, position TEXT)')
        conn.execute('CREATE TABLE IF NOT EXISTS edges (source TEXT, target TEXT, type TEXT, PRIMARY KEY (source, target, type))')
        conn.commit()
        conn.close()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL")
        return conn
    
    def load_from_db(self) -> Dict[str, Any]:
        conn = self._connect()
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
        self.nodes.clear()
        self.edges.clear()

        for nd in raw["nodes"]:
            self.nodes[nd["id"]] = Node(id=nd["id"], type=nd["type"], label=nd["label"], path=nd["path"], metadata=dict(nd.get("metadata", {})), position=nd.get("position"))

        for ed in raw["edges"]:
            self.edges.append(Edge(ed["source"], ed["target"], ed["type"]))

        conn = self._connect()
        for n in self.nodes.values():
            conn.execute("INSERT OR REPLACE INTO nodes VALUES (?,?,?,?,?,?)", (n.id, n.type, n.label, n.path, json.dumps(n.metadata), json.dumps(n.position) if n.position else None))
        for e in self.edges:
            conn.execute("INSERT OR IGNORE INTO edges VALUES (?,?,?)", (e.source, e.target, e.type))
        conn.commit()
        conn.close()

        return {"nodes": [n.to_dict() for n in self.nodes.values()], "edges": [e.to_dict() for e in self.edges]}

    def rebuild_graph(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Rebuild the graph atomically with backup + transaction."""
        backup_path = self.db_path.with_suffix(".db.bak")
        if self.db_path.exists():
            shutil.copy2(self.db_path, backup_path)

        conn = self._connect()
        try:
            conn.execute("BEGIN EXCLUSIVE")
            conn.execute("DELETE FROM nodes")
            conn.execute("DELETE FROM edges")

            self.nodes.clear()
            self.edges.clear()

            for nd in raw["nodes"]:
                node = Node(
                    id=nd["id"], type=nd["type"], label=nd["label"],
                    path=nd["path"], metadata=dict(nd.get("metadata", {})),
                    position=nd.get("position")
                )
                self.nodes[node.id] = node
                conn.execute(
                    "INSERT INTO nodes VALUES (?,?,?,?,?,?)",
                    (node.id, node.type, node.label, node.path,
                     json.dumps(node.metadata), json.dumps(node.position) if node.position else None)
                )

            for ed in raw["edges"]:
                edge = Edge(ed["source"], ed["target"], ed["type"])
                self.edges.append(edge)
                conn.execute(
                    "INSERT INTO edges VALUES (?,?,?)",
                    (edge.source, edge.target, edge.type)
                )

            conn.commit()
        except Exception:
            conn.rollback()
            conn.close()
            if backup_path.exists():
                shutil.copy2(backup_path, self.db_path)
            raise
        finally:
            if conn:
                conn.close()

        return {"nodes": [n.to_dict() for n in self.nodes.values()], "edges": [e.to_dict() for e in self.edges]}

    def restore_backup(self) -> bool:
        """Restore database from .db.bak if it exists."""
        backup_path = self.db_path.with_suffix(".db.bak")
        if backup_path.exists():
            shutil.copy2(backup_path, self.db_path)
            return True
        return False

    def update_node_metadata(self, node_id: str, metadata: Dict[str, Any]) -> None:
        conn = self._connect()
        conn.execute("UPDATE nodes SET metadata = ? WHERE id = ?", (json.dumps(metadata), node_id))
        conn.commit()
        conn.close()
        if node_id in self.nodes:
            self.nodes[node_id].metadata = metadata


if __name__ == "__main__":
    from scan_workspaces import scan_workspaces
    g = GraphEngine().build_graph(scan_workspaces())
    print(json.dumps(g, indent=2))