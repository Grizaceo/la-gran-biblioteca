#!/usr/bin/env python3
"""
library_bridge.py - FastAPI server para La Gran Biblioteca
Endpoints: /api/graph, /api/node/{id}, /api/study, /api/stream (SSE)
"""

import os
import json
import asyncio
from pathlib import Path
from typing import Dict, Any
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse
import uvicorn

from scan_workspaces import scan_workspaces, WORKSPACE_ROOT
from graph_engine import GraphEngine

app = FastAPI(title="La Gran Biblioteca API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = GraphEngine()
_graph_state = {"graph": {"nodes": [], "edges": []}}


def get_current_graph():
    return _graph_state["graph"]


def set_current_graph(g):
    _graph_state["graph"] = g


@app.on_event("startup")
async def startup_event():
    """Carga grafo existente o crea uno nuevo."""
    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        set_current_graph(engine.load_from_db())
    else:
        raw = scan_workspaces()
        set_current_graph(engine.build_graph(raw))


@app.get("/api/graph")
async def get_graph():
    """Retorna el grafo completo con posiciones."""
    return get_current_graph()


@app.get("/api/node/{node_id}")
async def get_node(node_id: str):
    """Retorna un nodo específico por ID."""
    for node in get_current_graph()["nodes"]:
        if node["id"] == node_id:
            return node
    raise HTTPException(status_code=404, detail="Node not found")


@app.post("/api/study")
async def study_node(node_id: str):
    """Endpoint para registrar estudio de un nodo."""
    graph = get_current_graph()
    node = next((n for n in graph["nodes"] if n["id"] == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    if "study_count" not in node.get("metadata", {}):
        node["metadata"]["study_count"] = 0
    node["metadata"]["study_count"] += 1
    
    return {"status": "ok", "node": node_id, "study_count": node["metadata"]["study_count"]}


@app.get("/api/stream")
async def stream_graph():
    """SSE para actualizaciones en vivo del grafo."""
    
    async def event_generator():
        graph = get_current_graph()
        yield {"event": "init", "data": json.dumps(graph)}
        
        last_hash = hash(json.dumps(graph, sort_keys=True))
        
        while True:
            await asyncio.sleep(5)
            
            raw = scan_workspaces()
            new_engine = GraphEngine()
            new_graph = new_engine.build_graph(raw)
            
            new_hash = hash(json.dumps(new_graph, sort_keys=True))
            
            if new_hash != last_hash:
                set_current_graph(new_graph)
                last_hash = new_hash
                yield {"event": "update", "data": json.dumps(new_graph)}
    
    return EventSourceResponse(event_generator())


@app.post("/api/rescan")
async def trigger_rescan():
    """Fuerza un re-escaneo del workspace."""
    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        db_path.unlink()
    
    raw = scan_workspaces()
    new_graph = engine.build_graph(raw)
    set_current_graph(new_graph)
    
    return {"status": "ok", "nodes": len(new_graph["nodes"]), "edges": len(new_graph["edges"])}


@app.get("/api/health")
async def health():
    """Health check."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3001)