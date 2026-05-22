#!/usr/bin/env python3
"""
export_html.py - Exporta grafo como HTML estático autocontenido
"""

import json
from pathlib import Path
from backend.graph_engine import GraphEngine

OUTPUT_FILE = Path(__file__).parent.parent / "export" / "library.html"
STYLE_PATH = Path(__file__).parent.parent / "frontend" / "src" / "lib" / "style.json"
TEMPLATE_PATH = Path(__file__).parent / "templates" / "library.html.tpl"


def _load_style() -> dict:
    if STYLE_PATH.exists():
        return json.loads(STYLE_PATH.read_text())
    return {}


def generate_html(graph: dict) -> str:
    tpl = TEMPLATE_PATH.read_text()
    return (
        tpl
        .replace("__GRAPH_JSON__", json.dumps(graph, indent=2))
        .replace("__STYLE_JSON__", json.dumps(_load_style()))
    )


def export_static():
    engine = GraphEngine()
    graph = engine.load_from_db()
    if not graph["nodes"]:
        print("No hay datos. Ejecuta: python -m backend.library_bridge (rescan) primero")
        return
    
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(generate_html(graph))
    print(f"Exportado: {OUTPUT_FILE}")


if __name__ == "__main__":
    export_static()