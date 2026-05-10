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

# CORS para desarrollo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = GraphEngine()
current_graph: Dict[str, Any] = {"nodes": [], "edges": []}


@app.on_event("startup")
async def startup_event():
    """Carga grafo existente o crea uno nuevo."""
    global current_graph
    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        current_graph = engine.load_from_db()
    else:
        raw = scan_workspaces()
        current_graph = engine.build_graph(raw)


@app.get("/api/graph")
async def get_graph():
    """Retorna el grafo completo con posiciones."""
    return current_graph


@app.get("/api/node/{node_id}")
async def get_node(node_id: str):
    """Retorna un nodo específico por ID."""
    for node in current_graph["nodes"]:
        if node["id"] == node_id:
            return node
    raise HTTPException(status_code=404, detail="Node not found")


@app.post("/api/study")
async def study_node(node_id: str):
    """Endpoint para registrar estudio de un nodo."""
    # Placeholder - aquí se registraría el tiempo de estudio
    node = next((n for n in current_graph["nodes"] if n["id"] == node_id), None)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    
    # Incrementar contador de estudio en metadata
    if "study_count" not in node.get("metadata", {}):
        node["metadata"]["study_count"] = 0
    node["metadata"]["study_count"] += 1
    
    return {"status": "ok", "node": node_id, "study_count": node["metadata"]["study_count"]}


@app.get("/api/stream")
async def stream_graph():
    """SSE para actualizaciones en vivo del grafo."""
    
    async def event_generator():
        # Enviar grafo actual
        yield {
            "event": "init",
            "data": json.dumps(current_graph)
        }
        
        # Polling cada 5 segundos para detectar cambios
        last_hash = hash(json.dumps(current_graph, sort_keys=True))
        
        while True:
            await asyncio.sleep(5)
            
            # Verificar cambios en el filesystem
            raw = scan_workspaces()
            new_engine = GraphEngine()
            new_graph = new_engine.build_graph(raw)
            
            new_hash = hash(json.dumps(new_graph, sort_keys=True))
            
            if new_hash != last_hash:
                global current_graph
                current_graph = new_graph
                last_hash = new_hash
                
                yield {
                    "event": "update",
                    "data": json.dumps(new_graph)
                }
    
    return EventSourceResponse(event_generator())


@app.post("/api/rescan")
async def trigger_rescan():
    """Fuerza un re-escaneo del workspace."""
    global current_graph
    
    # Borrar DB para forzar rebuild
    db_path = Path(__file__).parent / "library.db"
    if db_path.exists():
        db_path.unlink()
    
    raw = scan_workspaces()
    current_graph = engine.build_graph(raw)
    
    return {"status": "ok", "nodes": len(current_graph["nodes"]), "edges": len(current_graph["edges"])}


@app.get("/api/health")
async def health():
    """Health check."""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3001)