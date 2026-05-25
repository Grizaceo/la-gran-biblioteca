"""ExplorationLens contract — shared by HTTP API, MCP tools, and frontend."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

LENS_VERSION = 1

HEATMAP_MODES = frozenset({"off", "volume", "study"})
STUDY_FILTERS = frozenset({"all", "studied", "unstudied"})

DEFAULT_LENS: dict[str, Any] = {
    "version": LENS_VERSION,
    "id": None,
    "label": None,
    "workspaces": None,
    "topics": None,
    "folders": None,
    "studyFilter": "all",
    "minDegree": 0,
    "hideTags": False,
    "showArchived": False,
    "hiddenEdgeTypes": [],
    "heatmap": "off",
    "focusNodeId": None,
    "highlightNodeIds": [],
    "depth": None,
}

PRESETS: dict[str, dict[str, Any]] = {
    "heatmap_study": {
        "label": "Heatmap estudio",
        "heatmap": "study",
    },
    "heatmap_volume": {
        "label": "Heatmap volumen",
        "heatmap": "volume",
    },
    "gaps_unstudied": {
        "label": "Huecos sin estudiar",
        "studyFilter": "unstudied",
        "heatmap": "study",
    },
    "agent_default": {
        "label": "Vista del agente",
        "heatmap": "off",
    },
}


def _coerce_string_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError("Expected list or null for workspace/topic/folder filters")
    return [str(item) for item in value if str(item).strip()]


def validate_lens(data: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize and validate an ExplorationLens payload."""
    if not data or not isinstance(data, dict):
        return deepcopy(DEFAULT_LENS)

    lens = deepcopy(DEFAULT_LENS)
    version = int(data.get("version") or LENS_VERSION)
    if version != LENS_VERSION:
        raise ValueError(f"Unsupported lens version: {version}")
    lens["version"] = LENS_VERSION

    for key in ("id", "label", "focusNodeId"):
        if key in data and data[key] is not None:
            lens[key] = str(data[key])

    lens["workspaces"] = _coerce_string_list(data.get("workspaces"))
    lens["topics"] = _coerce_string_list(data.get("topics"))
    lens["folders"] = _coerce_string_list(data.get("folders"))

    study = str(data.get("studyFilter") or "all")
    if study not in STUDY_FILTERS:
        raise ValueError(f"Invalid studyFilter: {study}")
    lens["studyFilter"] = study

    lens["minDegree"] = max(0, int(data.get("minDegree") or 0))
    lens["hideTags"] = bool(data.get("hideTags"))
    lens["showArchived"] = bool(data.get("showArchived"))

    hidden = data.get("hiddenEdgeTypes")
    if hidden is None:
        lens["hiddenEdgeTypes"] = []
    elif isinstance(hidden, list):
        lens["hiddenEdgeTypes"] = [str(item) for item in hidden]
    else:
        raise ValueError("hiddenEdgeTypes must be a list")

    heatmap = str(data.get("heatmap") or "off")
    if heatmap not in HEATMAP_MODES:
        raise ValueError(f"Invalid heatmap mode: {heatmap}")
    lens["heatmap"] = heatmap

    highlights = data.get("highlightNodeIds")
    if highlights is None:
        lens["highlightNodeIds"] = []
    elif isinstance(highlights, list):
        lens["highlightNodeIds"] = [str(item) for item in highlights if str(item).strip()]
    else:
        raise ValueError("highlightNodeIds must be a list")

    if data.get("depth") is not None:
        lens["depth"] = max(1, min(3, int(data["depth"])))

    return lens


def preset_lens(preset_id: str, **overrides: Any) -> dict[str, Any]:
    """Build a lens from a named preset with optional overrides."""
    base = PRESETS.get(preset_id)
    if base is None:
        raise ValueError(f"Unknown lens preset: {preset_id}")
    merged = deepcopy(DEFAULT_LENS)
    merged.update(deepcopy(base))
    merged["id"] = preset_id
    merged.update(overrides)
    return validate_lens(merged)


def lens_to_search_params(lens: dict[str, Any]) -> dict[str, Any]:
    """Map ExplorationLens fields to search_graph / MCP search() parameters."""
    params: dict[str, Any] = {
        "query": "",
        "mode": "text",
        "limit": 20,
        "offset": 0,
    }

    workspaces = lens.get("workspaces")
    if workspaces and len(workspaces) == 1:
        params["workspace"] = workspaces[0]

    topics = lens.get("topics")
    if topics and len(topics) == 1:
        params["topic"] = topics[0]

    folders = lens.get("folders")
    if folders and len(folders) == 1:
        params["folder_prefix"] = folders[0]

    study = lens.get("studyFilter") or "all"
    if study in {"studied", "unstudied"}:
        params["studied"] = study

    min_degree = int(lens.get("minDegree") or 0)
    if min_degree > 0:
        params["min_degree"] = min_degree

    return params


def lens_to_graph_filters(lens: dict[str, Any]) -> dict[str, Any]:
    """Subset of lens fields that map to UI GraphFiltersState."""
    return {
        "workspaces": lens.get("workspaces"),
        "topics": lens.get("topics"),
        "folders": lens.get("folders"),
        "hideTags": bool(lens.get("hideTags")),
        "showArchived": bool(lens.get("showArchived")),
        "studyFilter": lens.get("studyFilter") or "all",
        "minDegree": int(lens.get("minDegree") or 0),
        "hiddenEdgeTypes": list(lens.get("hiddenEdgeTypes") or []),
    }
