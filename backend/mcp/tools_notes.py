"""Notes MCP tools: create_note, get_note, update_note, delete_note, search_notes, list_notes."""

from __future__ import annotations


def _rescan():
    """Call _rescan_and_reload from the module (patchable in tests)."""
    import backend.mcp as mcp_mod

    return mcp_mod._rescan_and_reload()


def create_note(
    source_node_id: str,
    body: str,
    title: str = "",
    labels: list[str] | None = None,
    selected_text: str = "",
    source_path: str = "",
    storage: str = "vault",
) -> dict:
    import backend.mcp as mcp_mod
    from ..services.note_service import (
        NoteValidationError,
        SourceNodeNotFoundError,
        create_note as _create_note,
    )

    kind = storage if storage in ("inline", "vault") else "vault"
    try:
        note, path = _create_note(
            title=title,
            body=body,
            labels=labels,
            source_node_id=source_node_id,
            selected_text=selected_text,
            source_path=source_path,
            storage=kind,
        )
        mcp_mod._recent_imports.append(str(path.resolve()))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        _rescan()
        return {"status": "ok", **note}
    except (SourceNodeNotFoundError, NoteValidationError) as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


def list_notes(source_node_id: str) -> dict:
    from ..services.note_service import list_notes_for_source

    try:
        notes = list_notes_for_source(source_node_id)
        return {"notes": notes, "total": len(notes)}
    except Exception as e:
        return {"error": str(e)}


def get_note(note_id: str) -> dict:
    from ..services.note_service import NoteNotFoundError, get_note as _get_note

    try:
        return _get_note(note_id)
    except NoteNotFoundError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


def update_note(
    note_id: str,
    title: str = "",
    body: str = "",
    labels: list[str] | None = None,
) -> dict:
    import backend.mcp as mcp_mod
    from ..services.note_service import (
        NoteNotFoundError,
        NoteValidationError,
        update_note as _update_note,
    )

    try:
        kwargs: dict = {}
        if title:
            kwargs["title"] = title
        if body:
            kwargs["body"] = body
        if labels is not None:
            kwargs["labels"] = labels
        note, path = _update_note(note_id, **kwargs)
        mcp_mod._recent_imports.append(str(path.resolve()))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        _rescan()
        return {"status": "ok", **note}
    except (NoteNotFoundError, NoteValidationError) as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}


def search_notes(
    query: str = "",
    label: str = "",
    source_node_id: str = "",
    limit: int = 20,
) -> dict:
    from ..services.note_service import search_notes as _search_notes

    try:
        notes = _search_notes(
            query=query,
            label=label,
            source_node_id=source_node_id,
            limit=limit,
        )
        return {"notes": notes, "total": len(notes)}
    except Exception as e:
        return {"error": str(e)}


def delete_note(note_id: str) -> dict:
    import backend.mcp as mcp_mod
    from ..services.note_service import NoteNotFoundError, delete_note as _delete_note

    try:
        path = _delete_note(note_id)
        mcp_mod._recent_imports.append(str(path.resolve()))
        if len(mcp_mod._recent_imports) > 50:
            mcp_mod._recent_imports.pop(0)
        _rescan()
        return {"status": "ok", "id": note_id}
    except NoteNotFoundError as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}
