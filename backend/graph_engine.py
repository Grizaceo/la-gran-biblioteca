#!/usr/bin/env python3
"""
graph_engine.py - Versión minimalista para testing
"""

import shutil
import json
import sqlite3
from pathlib import Path
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, asdict

import os

from .constellation_layout import now_iso, suggest_constellation

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
        conn.execute('''CREATE TABLE IF NOT EXISTS constellation_prefs (
            folder_path TEXT PRIMARY KEY,
            constellation_id TEXT NOT NULL,
            status TEXT NOT NULL,
            suggested_from TEXT,
            updated_at TEXT NOT NULL
        )''')
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
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM nodes")
            conn.execute("DELETE FROM edges")
            for n in self.nodes.values():
                conn.execute(
                    "INSERT INTO nodes VALUES (?,?,?,?,?,?)",
                    (n.id, n.type, n.label, n.path, json.dumps(n.metadata),
                     json.dumps(n.position) if n.position else None),
                )
            for e in self.edges:
                conn.execute(
                    "INSERT INTO edges VALUES (?,?,?)",
                    (e.source, e.target, e.type),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        return {"nodes": [n.to_dict() for n in self.nodes.values()], "edges": [e.to_dict() for e in self.edges]}

    def rebuild_graph(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Rebuild the graph atomically with backup + transaction."""
        backup_path = self.db_path.with_suffix(".db.bak")
        if self.db_path.exists():
            shutil.copy2(self.db_path, backup_path)

        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
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

    def list_constellation_prefs(self) -> List[Dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT folder_path, constellation_id, status, suggested_from, updated_at "
            "FROM constellation_prefs ORDER BY folder_path"
        ).fetchall()
        conn.close()
        return [
            {
                "folder_path": r[0],
                "constellation_id": r[1],
                "status": r[2],
                "suggested_from": r[3],
                "updated_at": r[4],
            }
            for r in rows
        ]

    def get_constellation_pref(self, folder_path: str) -> Optional[Dict[str, Any]]:
        fp = str(Path(folder_path).resolve())
        conn = self._connect()
        row = conn.execute(
            "SELECT folder_path, constellation_id, status, suggested_from, updated_at "
            "FROM constellation_prefs WHERE folder_path = ?",
            (fp,),
        ).fetchone()
        conn.close()
        if not row:
            return None
        return {
            "folder_path": row[0],
            "constellation_id": row[1],
            "status": row[2],
            "suggested_from": row[3],
            "updated_at": row[4],
        }

    def upsert_constellation_pref(
        self,
        folder_path: str,
        constellation_id: str,
        status: str,
        suggested_from: str = "manual",
    ) -> Dict[str, Any]:
        fp = str(Path(folder_path).resolve())
        ts = now_iso()
        conn = self._connect()
        conn.execute(
            """INSERT INTO constellation_prefs (folder_path, constellation_id, status, suggested_from, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(folder_path) DO UPDATE SET
                 constellation_id = excluded.constellation_id,
                 status = excluded.status,
                 suggested_from = excluded.suggested_from,
                 updated_at = excluded.updated_at""",
            (fp, constellation_id, status, suggested_from, ts),
        )
        conn.commit()
        conn.close()
        return {
            "folder_path": fp,
            "constellation_id": constellation_id,
            "status": status,
            "suggested_from": suggested_from,
            "updated_at": ts,
        }

    def delete_constellation_pref(self, folder_path: str) -> bool:
        fp = str(Path(folder_path).resolve())
        conn = self._connect()
        cur = conn.execute("DELETE FROM constellation_prefs WHERE folder_path = ?", (fp,))
        conn.commit()
        conn.close()
        return cur.rowcount > 0

    def sync_folder_constellation_suggestions(self, graph: Dict[str, Any]) -> int:
        """Insert suggested prefs for new folder nodes without existing pref."""
        existing = {p["folder_path"] for p in self.list_constellation_prefs()}
        added = 0
        for n in graph.get("nodes", []):
            if n.get("type") != "folder":
                continue
            path = n.get("path")
            if not path:
                continue
            fp = str(Path(path).resolve())
            if fp in existing:
                continue
            cid = suggest_constellation(n.get("label") or Path(path).name)
            if not cid:
                continue
            self.upsert_constellation_pref(fp, cid, "suggested", "name_match")
            existing.add(fp)
            added += 1
        return added


if __name__ == "__main__":
    from scan_workspaces import scan_workspaces
    g = GraphEngine().build_graph(scan_workspaces())
    print(json.dumps(g, indent=2))