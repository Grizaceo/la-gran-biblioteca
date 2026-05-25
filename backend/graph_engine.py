#!/usr/bin/env python3
"""
graph_engine.py - Versión minimalista para testing
"""

import json
import sqlite3
import shutil
import hashlib
import logging
from pathlib import Path
from typing import Dict, List, Any, Optional, Callable
from dataclasses import dataclass, asdict

import os

from .constellation_layout import (
    GENERIC_FOLDER_NAMES,
    now_iso,
    suggest_constellation,
    _normalize_name,
)

_SUGGEST_MAX_DEPTH = 1
_SUGGEST_THRESHOLD = 0.85

_DB_DEFAULT = Path(__file__).parent / "library.db"
DB_PATH = Path(os.environ.get("DB_PATH", str(_DB_DEFAULT)))
logger = logging.getLogger(__name__)


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
    def __init__(self, db_path: Path | None = None):
        self.db_path = Path(db_path) if db_path is not None else Path(os.environ.get("DB_PATH", str(_DB_DEFAULT)))
        self.nodes: Dict[str, Node] = {}
        self.edges: List[Edge] = []
        self._fts_enabled = False
        self._init_db()
    
    def _init_db(self):
        conn = sqlite3.connect(self.db_path)
        self._enable_wal(conn)
        conn.execute('CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, type TEXT, label TEXT, path TEXT, metadata TEXT, position TEXT)')
        conn.execute('CREATE TABLE IF NOT EXISTS edges (source TEXT, target TEXT, type TEXT, PRIMARY KEY (source, target, type))')
        conn.execute(
            'CREATE TABLE IF NOT EXISTS node_search ('
            'node_id TEXT PRIMARY KEY, label TEXT, path TEXT, title TEXT, tags TEXT, topics TEXT, search_blob TEXT)'
        )
        conn.execute('''CREATE TABLE IF NOT EXISTS constellation_prefs (
            folder_path TEXT PRIMARY KEY,
            constellation_id TEXT NOT NULL,
            status TEXT NOT NULL,
            suggested_from TEXT,
            updated_at TEXT NOT NULL
        )''')
        conn.execute('''CREATE TABLE IF NOT EXISTS exploration_tours (
            workspace TEXT PRIMARY KEY,
            steps TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )''')
        self._ensure_node_fingerprint_columns(conn)
        self._ensure_fts(conn)
        conn.commit()
        conn.close()

    def _ensure_node_fingerprint_columns(self, conn: sqlite3.Connection) -> None:
        cols = {row[1] for row in conn.execute("PRAGMA table_info(nodes)")}
        if "content_hash" not in cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN content_hash TEXT")
        if "mtime" not in cols:
            conn.execute("ALTER TABLE nodes ADD COLUMN mtime REAL")

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        self._enable_wal(conn)
        return conn

    def _enable_wal(self, conn: sqlite3.Connection) -> None:
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.OperationalError:
            # Another process may temporarily hold a lock on the shared DB.
            pass

    def _ensure_fts(self, conn: sqlite3.Connection) -> None:
        try:
            conn.execute(
                "CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5("
                "node_id UNINDEXED, label, path, title, tags, topics)"
            )
            self._fts_enabled = True
        except sqlite3.OperationalError:
            self._fts_enabled = False

    def _search_row_for_node(self, node: Node) -> tuple[str, str, str, str, str, str, str]:
        meta = node.metadata or {}
        frontmatter = meta.get("frontmatter") or {}
        title = str(frontmatter.get("title") or node.label or "")
        tags = " ".join(str(tag) for tag in meta.get("tags") or [])
        topics = " ".join(str(topic) for topic in meta.get("topics") or [])
        search_blob = " ".join(part for part in [node.label, node.path, title, tags, topics] if part)
        return (node.id, node.label, node.path, title, tags, topics, search_blob)

    def _rebuild_search_index(self, conn: sqlite3.Connection) -> None:
        conn.execute("DELETE FROM node_search")
        if self._fts_enabled:
            conn.execute("DELETE FROM nodes_fts")
        for node in self.nodes.values():
            row = self._search_row_for_node(node)
            conn.execute(
                "INSERT INTO node_search (node_id, label, path, title, tags, topics, search_blob) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                row,
            )
            if self._fts_enabled:
                conn.execute(
                    "INSERT INTO nodes_fts (node_id, label, path, title, tags, topics) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    row[:6],
                )
    
    @staticmethod
    def file_fingerprint(path: Path) -> tuple[str, float]:
        """Return (content_hash, mtime) for incremental scan."""
        try:
            st = path.stat()
        except OSError:
            return "", 0.0
        mtime = float(st.st_mtime_ns)
        if path.is_file() and st.st_size <= 256 * 1024:
            try:
                digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
            except OSError:
                digest = f"{st.st_size}:{int(st.st_mtime)}"
        else:
            digest = f"{st.st_size}:{int(st.st_mtime)}"
        return digest, mtime

    def _stored_fingerprints(self, conn: sqlite3.Connection) -> dict[str, tuple[str, float]]:
        try:
            rows = conn.execute(
                "SELECT id, path, content_hash, mtime FROM nodes WHERE path != ''"
            ).fetchall()
        except sqlite3.OperationalError:
            rows = conn.execute("SELECT id, path FROM nodes WHERE path != ''").fetchall()
            return {r[0]: ("", 0.0) for r in rows}
        out: dict[str, tuple[str, float]] = {}
        for row in rows:
            out[row[0]] = (row[2] or "", float(row[3] or 0.0))
        return out

    def scan_incremental(
        self,
        root: Path,
        scan_fn: Callable[..., Dict[str, Any]],
        *,
        max_files: int,
        max_children: int,
    ) -> tuple[Dict[str, Any], dict[str, Any]]:
        """
        Skip full filesystem parse when no vault files changed (fingerprints match).
        """
        from .scan.walker import should_scan
        from .constants import get_exclude_dirs, is_archive_dir_name, get_archive_policy

        conn = self._connect()
        stored = self._stored_fingerprints(conn)
        conn.close()

        if not stored:
            raw = scan_fn(root, max_files=max_files, max_children=max_children)
            return raw, {"incremental": False, "reason": "empty_db"}

        exclude = get_exclude_dirs()
        current_paths: dict[str, tuple[str, float]] = {}

        def walk_dir(directory: Path) -> None:
            if len(current_paths) >= max_files * 2:
                return
            try:
                entries = list(directory.iterdir())
            except OSError:
                return
            for entry in entries:
                if not should_scan(entry):
                    continue
                if entry.is_dir():
                    if entry.name in exclude:
                        continue
                    if is_archive_dir_name(entry.name) and get_archive_policy() == "exclude":
                        continue
                    walk_dir(entry)
                elif entry.is_file():
                    try:
                        rel = entry.resolve().relative_to(root.resolve()).as_posix()
                    except ValueError:
                        continue
                    from .scan.layout import file_node_id
                    nid = file_node_id(rel)
                    current_paths[nid] = self.file_fingerprint(entry)

        walk_dir(root)

        changed: list[str] = []
        removed: list[str] = []
        for nid, fp in current_paths.items():
            old = stored.get(nid)
            if old is None or old != fp:
                changed.append(nid)
        for nid in stored:
            if nid not in current_paths and nid.startswith("file_"):
                removed.append(nid)

        if not changed and not removed:
            logger.info("Incremental scan: no file changes, reusing DB graph")
            raw = self.load_from_db()
            return raw, {
                "incremental": True,
                "skipped_full_scan": True,
                "changed_files": 0,
                "removed_files": 0,
            }

        raw = scan_fn(root, max_files=max_files, max_children=max_children)
        return raw, {
            "incremental": True,
            "skipped_full_scan": False,
            "changed_files": len(changed),
            "removed_files": len(removed),
        }

    def load_from_db(self) -> Dict[str, Any]:
        conn = self._connect()
        self.nodes.clear()
        self.edges.clear()
        nodes = []
        for row in conn.execute("SELECT * FROM nodes"):
            node = Node(
                id=row[0], type=row[1], label=row[2], path=row[3],
                metadata=json.loads(row[4]),
                position=json.loads(row[5]) if row[5] else None,
            )
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
                ch, mt = ("", 0.0)
                if n.path:
                    try:
                        ch, mt = self.file_fingerprint(Path(n.path))
                    except OSError:
                        pass
                conn.execute(
                    "INSERT INTO nodes (id, type, label, path, metadata, position, content_hash, mtime) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (n.id, n.type, n.label, n.path, json.dumps(n.metadata),
                     json.dumps(n.position) if n.position else None, ch, mt),
                )
            for e in self.edges:
                conn.execute(
                    "INSERT INTO edges VALUES (?,?,?)",
                    (e.source, e.target, e.type),
                )
            self._rebuild_search_index(conn)
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
                ch, mt = ("", 0.0)
                if node.path:
                    try:
                        ch, mt = self.file_fingerprint(Path(node.path))
                    except OSError:
                        pass
                conn.execute(
                    "INSERT INTO nodes (id, type, label, path, metadata, position, content_hash, mtime) "
                    "VALUES (?,?,?,?,?,?,?,?)",
                    (node.id, node.type, node.label, node.path,
                     json.dumps(node.metadata), json.dumps(node.position) if node.position else None,
                     ch, mt),
                )

            for ed in raw["edges"]:
                edge = Edge(ed["source"], ed["target"], ed["type"])
                self.edges.append(edge)
                conn.execute(
                    "INSERT INTO edges VALUES (?,?,?)",
                    (edge.source, edge.target, edge.type)
                )

            self._rebuild_search_index(conn)
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
        if node_id in self.nodes:
            temp_node = Node(
                id=node_id,
                type=self.nodes[node_id].type,
                label=self.nodes[node_id].label,
                path=self.nodes[node_id].path,
                metadata=metadata,
                position=self.nodes[node_id].position,
            )
            row = self._search_row_for_node(temp_node)
            conn.execute(
                "INSERT INTO node_search (node_id, label, path, title, tags, topics, search_blob) "
                "VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(node_id) DO UPDATE SET "
                "label = excluded.label, path = excluded.path, title = excluded.title, "
                "tags = excluded.tags, topics = excluded.topics, search_blob = excluded.search_blob",
                row,
            )
            if self._fts_enabled:
                conn.execute("DELETE FROM nodes_fts WHERE node_id = ?", (node_id,))
                conn.execute(
                    "INSERT INTO nodes_fts (node_id, label, path, title, tags, topics) VALUES (?, ?, ?, ?, ?, ?)",
                    row[:6],
                )
        conn.commit()
        conn.close()
        if node_id in self.nodes:
            self.nodes[node_id].metadata = metadata

    def search_index(
        self,
        query: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        conn = self._connect()
        self._ensure_fts(conn)
        rows: list[sqlite3.Row | tuple] = []
        q = " ".join(part.strip() for part in query.split() if part.strip())
        if q and self._fts_enabled:
            match = " OR ".join(f'"{token}"*' for token in q.split())
            try:
                rows = conn.execute(
                    "SELECT node_id, label, path, title, tags, topics, bm25(nodes_fts) AS rank "
                    "FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY rank LIMIT ? OFFSET ?",
                    (match, limit, offset),
                ).fetchall()
            except sqlite3.OperationalError:
                rows = []
        if not rows:
            like = f"%{q.lower()}%"
            rows = conn.execute(
                "SELECT node_id, label, path, title, tags, topics, 0.0 AS rank "
                "FROM node_search "
                "WHERE ? = '' OR lower(search_blob) LIKE ? "
                "ORDER BY length(label), label LIMIT ? OFFSET ?",
                (q, like, limit, offset),
            ).fetchall()
        conn.close()
        return [
            {
                "node_id": row[0],
                "label": row[1],
                "path": row[2],
                "title": row[3],
                "tags": row[4],
                "topics": row[5],
                "rank": float(row[6]),
            }
            for row in rows
        ]

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
            meta = n.get("metadata") or {}
            depth = meta.get("depth")
            if depth is not None and int(depth) > _SUGGEST_MAX_DEPTH:
                continue
            label = n.get("label") or Path(path).name
            norm_label = _normalize_name(label)
            if norm_label in GENERIC_FOLDER_NAMES or label.lower() in GENERIC_FOLDER_NAMES:
                continue
            fp = str(Path(path).resolve())
            if fp in existing:
                continue
            cid = suggest_constellation(label, threshold=_SUGGEST_THRESHOLD)
            if not cid:
                continue
            self.upsert_constellation_pref(fp, cid, "suggested", "name_match")
            existing.add(fp)
            added += 1
        return added

    def upsert_exploration_tour(self, workspace: str, steps: list[dict[str, Any]]) -> None:
        ts = now_iso()
        conn = self._connect()
        conn.execute(
            """INSERT INTO exploration_tours (workspace, steps, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(workspace) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at""",
            (workspace, json.dumps(steps), ts),
        )
        conn.commit()
        conn.close()

    def get_exploration_tour(self, workspace: str) -> dict[str, Any] | None:
        conn = self._connect()
        row = conn.execute(
            "SELECT workspace, steps, updated_at FROM exploration_tours WHERE workspace = ?",
            (workspace,),
        ).fetchone()
        conn.close()
        if not row:
            return None
        return {
            "workspace": row[0],
            "steps": json.loads(row[1]),
            "updated_at": row[2],
        }

    def list_exploration_tours(self) -> list[dict[str, Any]]:
        conn = self._connect()
        rows = conn.execute(
            "SELECT workspace, steps, updated_at FROM exploration_tours ORDER BY workspace"
        ).fetchall()
        conn.close()
        return [
            {"workspace": r[0], "steps": json.loads(r[1]), "updated_at": r[2]}
            for r in rows
        ]


if __name__ == "__main__":
    from scan_workspaces import scan_workspaces
    g = GraphEngine().build_graph(scan_workspaces())
    print(json.dumps(g, indent=2))
