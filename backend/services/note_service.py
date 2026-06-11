"""Create, read, update, delete notes (inline in source files or vault under _notes/)."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .. import graph_state
from ..constants import get_workspace_root
from ..path_utils import (
    path_from_node_id,
    path_from_node_id_fuzzy,
    resolve_node_path,
    validate_path_under_workspace,
)
from ..scan.inline_notes import (
    INLINE_EXTENSIONS,
    build_inline_block,
    delete_inline_block,
    insert_inline_block,
    new_note_id,
    parse_inline_blocks,
    parse_inline_blocks_from_file,
    replace_inline_block,
)
from ..scan.markdown import parse_frontmatter

LABEL_RE = re.compile(r"^[a-z][a-z0-9_-]{0,29}$")
MAX_LABELS = 10
MAX_BODY = 50_000
SOURCE_SLUG_MAX = 120
NOTES_DIR = "_notes"
StorageKind = str  # "inline" | "vault"


class NoteError(Exception):
    """Base error for note operations."""


class NoteNotFoundError(NoteError):
    pass


class SourceNodeNotFoundError(NoteError):
    pass


class NoteValidationError(NoteError):
    pass


def normalize_source_node_id(source_node_id: str) -> str:
    return source_node_id.strip().replace("\\", "/")


def source_slug_from_node_id(source_node_id: str) -> str:
    slug = normalize_source_node_id(source_node_id).replace("/", "__")
    if len(slug) > SOURCE_SLUG_MAX:
        slug = slug[:SOURCE_SLUG_MAX]
    return slug


def inline_note_node_id(source_node_id: str, note_id: str) -> str:
    slug = source_slug_from_node_id(source_node_id)
    return f"inline_note_{slug}_{note_id}"


def _stem_from_file_path(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).stem
    except ValueError:
        return path.stem


def _resolve_source_file(source_node_id: str, source_path: str = "") -> Path:
    nid = normalize_source_node_id(source_node_id)
    root = get_workspace_root().resolve()

    node = graph_state.get_node_by_id(nid)
    path_str = (source_path or (node.get("path", "") if node else "")).strip()
    if path_str:
        try:
            resolved = resolve_node_path(nid, path_str, root)
            if resolved.is_file():
                validate_path_under_workspace(str(resolved), root)
                return resolved
        except (OSError, ValueError):
            stored = Path(path_str)
            if stored.is_file():
                validate_path_under_workspace(str(stored.resolve()), root)
                return stored.resolve()

    for candidate in (
        path_from_node_id(nid, root),
        path_from_node_id_fuzzy(nid, root),
    ):
        if candidate is not None and candidate.is_file():
            validate_path_under_workspace(str(candidate), root)
            return candidate

    raise SourceNodeNotFoundError(
        f"Nodo origen no encontrado: {nid!r}. "
        "Abre el nodo de nuevo o re-escanea la biblioteca."
    )


def _wikilink_stem_from_vault_file(path: Path) -> str | None:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return None
    for line in reversed(text.splitlines()):
        s = line.strip()
        if s.startswith("[[") and s.endswith("]]"):
            return s[2:-2].strip()
    return None


def _wikilink_stem(source_node_id: str, source_path: str = "") -> str:
    path = _resolve_source_file(source_node_id, source_path)
    return _stem_from_file_path(path, get_workspace_root().resolve())


def validate_labels(labels: list[str]) -> None:
    if len(labels) > MAX_LABELS:
        raise NoteValidationError(f"At most {MAX_LABELS} labels allowed")
    for label in labels:
        if len(label) > 30 or not LABEL_RE.match(label):
            raise NoteValidationError(
                "Each label must match ^[a-z][a-z0-9_-]{0,29}$"
            )


def _note_dir(source_node_id: str) -> Path:
    slug = source_slug_from_node_id(source_node_id)
    return get_workspace_root() / NOTES_DIR / slug


def _note_path(source_node_id: str, note_id: str) -> Path:
    return _note_dir(source_node_id) / f"{note_id}.md"


def _find_vault_note_path(note_id: str) -> Path:
    notes_root = get_workspace_root() / NOTES_DIR
    if not notes_root.is_dir():
        raise NoteNotFoundError(note_id)
    matches = list(notes_root.rglob(f"{note_id}.md"))
    if not matches:
        raise NoteNotFoundError(note_id)
    if len(matches) > 1:
        matches.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    path = matches[0]
    validate_path_under_workspace(str(path), get_workspace_root())
    return path


def _format_labels_yaml(labels: list[str]) -> str:
    if not labels:
        return "labels: []"
    lines = ["labels:"]
    for label in labels:
        lines.append(f"  - {label}")
    return "\n".join(lines)


def _escape_yaml(value: str) -> str:
    if not value:
        return '""'
    if any(c in value for c in ':"\n#'):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f'"{escaped}"'
    return value


def _build_vault_note_content(
    *,
    title: str,
    body: str,
    labels: list[str],
    source_node_id: str,
    selected_text: str,
    created_at: str,
    wikilink_stem: str,
) -> str:
    quote = ""
    if selected_text.strip():
        safe = selected_text.strip().replace("\n", " ")
        quote = f'> "{safe}"\n\n'
    fm = "\n".join(
        [
            "---",
            f"title: {_escape_yaml(title)}",
            _format_labels_yaml(labels),
            f"source_node_id: {_escape_yaml(source_node_id)}",
            f"selected_text: {_escape_yaml(selected_text)}",
            f"created_at: {_escape_yaml(created_at)}",
            "---",
            "",
            quote + body.rstrip(),
            "",
            f"[[{wikilink_stem}]]",
            "",
        ]
    )
    return fm


def _parse_vault_note_file(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    fm = parse_frontmatter(text)
    note_id = path.stem
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            body = text[end + 4 :].lstrip("\n")
    lines = body.rstrip().splitlines()
    while lines and lines[-1].strip().startswith("[[") and lines[-1].strip().endswith("]]"):
        lines.pop()
    body_clean = "\n".join(lines).strip()
    if body_clean.startswith(">"):
        parts = body_clean.split("\n\n", 1)
        if len(parts) == 2 and parts[0].startswith(">"):
            body_clean = parts[1].strip()

    labels = fm.get("labels", [])
    if isinstance(labels, str):
        labels = [labels] if labels else []
    elif not isinstance(labels, list):
        labels = []

    rel = str(path.relative_to(get_workspace_root()))
    return {
        "id": note_id,
        "title": str(fm.get("title", "") or ""),
        "body": body_clean,
        "labels": [str(x) for x in labels],
        "source_node_id": str(fm.get("source_node_id", "") or ""),
        "selected_text": str(fm.get("selected_text", "") or ""),
        "created_at": str(fm.get("created_at", "") or ""),
        "path": rel,
        "storage": "vault",
        "line_start": None,
        "line_end": None,
    }


def _inline_notes_for_source(source_node_id: str, source_path: Path) -> list[dict]:
    rel = str(source_path.relative_to(get_workspace_root().resolve()))
    try:
        content = source_path.read_text(encoding="utf-8")
    except OSError:
        return []
    notes = parse_inline_blocks(
        content,
        source_path=rel,
        source_node_id=source_node_id,
    )
    return [n for n in notes if n.get("source_node_id") in ("", source_node_id) or not n.get("source_node_id")]


def _find_inline_note(note_id: str) -> tuple[dict, Path]:
    root = get_workspace_root().resolve()
    candidates: list[Path] = []

    graph = graph_state.get_current_graph()
    if graph:
        for node in graph.get("nodes", []):
            path_str = node.get("path") or ""
            if not path_str:
                continue
            p = Path(path_str)
            if p.suffix.lower() in INLINE_EXTENSIONS:
                candidates.append(p)

    if not candidates:
        for ext in ("*.md", "*.txt"):
            candidates.extend(get_workspace_root().rglob(ext))

    seen: set[str] = set()
    for path in candidates:
        try:
            resolved = str(path.resolve())
        except OSError:
            continue
        if resolved in seen:
            continue
        seen.add(resolved)
        for note in parse_inline_blocks_from_file(path, workspace_root=root):
            if note["id"] == note_id:
                return note, path.resolve()
    raise NoteNotFoundError(note_id)


def _create_vault_note(
    *,
    title: str,
    body: str,
    labels: list[str],
    source_node_id: str,
    selected_text: str,
    source_path: str,
) -> tuple[dict, Path]:
    note_id = uuid.uuid4().hex[:8]
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    stem = _wikilink_stem(source_node_id, source_path)
    content = _build_vault_note_content(
        title=title,
        body=body,
        labels=labels,
        source_node_id=source_node_id,
        selected_text=selected_text,
        created_at=created_at,
        wikilink_stem=stem,
    )
    dest = _note_path(source_node_id, note_id)
    validate_path_under_workspace(str(dest), get_workspace_root())
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(content, encoding="utf-8")
    return _parse_vault_note_file(dest), dest


def _create_inline_note(
    *,
    title: str,
    body: str,
    labels: list[str],
    source_node_id: str,
    selected_text: str,
    source_path: str,
) -> tuple[dict, Path]:
    source_file = _resolve_source_file(source_node_id, source_path)
    if source_file.suffix.lower() not in INLINE_EXTENSIONS:
        raise NoteValidationError(
            "Inline notes require a .md or .txt source file; use storage='vault' instead."
        )
    note_id = new_note_id()
    created_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    block = build_inline_block(
        note_id=note_id,
        title=title,
        body=body,
        labels=labels,
        selected_text=selected_text,
        created_at=created_at,
    )
    try:
        content = source_file.read_text(encoding="utf-8")
    except OSError as e:
        raise NoteValidationError(f"Cannot read source file: {e}") from e
    updated = insert_inline_block(content, block, selected_text)
    source_file.write_text(updated, encoding="utf-8")
    rel = str(source_file.relative_to(get_workspace_root().resolve()))
    notes = parse_inline_blocks(
        updated,
        source_path=rel,
        source_node_id=source_node_id,
    )
    for note in notes:
        if note["id"] == note_id:
            return note, source_file
    raise NoteValidationError("Failed to write inline note block")


def create_note(
    *,
    title: str = "",
    body: str,
    labels: list[str] | None = None,
    source_node_id: str,
    selected_text: str = "",
    source_path: str = "",
    storage: StorageKind = "vault",
) -> tuple[dict, Path]:
    source_node_id = normalize_source_node_id(source_node_id)
    labels = list(labels or [])
    if not body.strip():
        raise NoteValidationError("body must not be empty")
    if len(body) > MAX_BODY:
        raise NoteValidationError(f"body exceeds {MAX_BODY} characters")
    validate_labels(labels)

    if storage == "inline":
        return _create_inline_note(
            title=title,
            body=body,
            labels=labels,
            source_node_id=source_node_id,
            selected_text=selected_text,
            source_path=source_path,
        )
    return _create_vault_note(
        title=title,
        body=body,
        labels=labels,
        source_node_id=source_node_id,
        selected_text=selected_text,
        source_path=source_path,
    )


def get_note(note_id: str) -> dict:
    try:
        path = _find_vault_note_path(note_id)
        return _parse_vault_note_file(path)
    except NoteNotFoundError:
        note, _path = _find_inline_note(note_id)
        return note


def update_note(
    note_id: str,
    *,
    title: str | None = None,
    body: str | None = None,
    labels: list[str] | None = None,
) -> tuple[dict, Path]:
    current = get_note(note_id)
    storage = current.get("storage", "vault")
    new_title = title if title is not None else current["title"]
    new_body = body if body is not None else current["body"]
    new_labels = labels if labels is not None else current["labels"]

    if not new_body.strip():
        raise NoteValidationError("body must not be empty")
    if len(new_body) > MAX_BODY:
        raise NoteValidationError(f"body exceeds {MAX_BODY} characters")
    validate_labels(new_labels)

    if storage == "inline":
        source_node_id = current["source_node_id"]
        source_file = _resolve_source_file(source_node_id, current.get("path", ""))
        created_at = current.get("created_at") or datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S"
        )
        block = build_inline_block(
            note_id=note_id,
            title=new_title,
            body=new_body,
            labels=new_labels,
            selected_text=current.get("selected_text", ""),
            created_at=created_at,
        )
        content = source_file.read_text(encoding="utf-8")
        updated = replace_inline_block(content, note_id, block)
        source_file.write_text(updated, encoding="utf-8")
        rel = str(source_file.relative_to(get_workspace_root().resolve()))
        for note in parse_inline_blocks(
            updated,
            source_path=rel,
            source_node_id=source_node_id,
        ):
            if note["id"] == note_id:
                return note, source_file
        raise NoteNotFoundError(note_id)

    path = _find_vault_note_path(note_id)
    stem = _wikilink_stem_from_vault_file(path)
    if not stem:
        stem = _wikilink_stem(current["source_node_id"])
    content = _build_vault_note_content(
        title=new_title,
        body=new_body,
        labels=new_labels,
        source_node_id=current["source_node_id"],
        selected_text=current["selected_text"],
        created_at=current["created_at"] or datetime.now(timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%S"
        ),
        wikilink_stem=stem,
    )
    path.write_text(content, encoding="utf-8")
    return _parse_vault_note_file(path), path


def delete_note(note_id: str) -> Path:
    try:
        path = _find_vault_note_path(note_id)
        path.unlink()
        return path
    except NoteNotFoundError:
        pass

    note, source_file = _find_inline_note(note_id)
    content = source_file.read_text(encoding="utf-8")
    updated = delete_inline_block(content, note_id)
    source_file.write_text(updated, encoding="utf-8")
    return source_file


def list_notes_for_source(source_node_id: str) -> list[dict]:
    source_node_id = normalize_source_node_id(source_node_id)
    notes: list[dict] = []

    note_dir = _note_dir(source_node_id)
    if note_dir.is_dir():
        for path in sorted(note_dir.glob("*.md")):
            try:
                parsed = _parse_vault_note_file(path)
                if parsed.get("source_node_id") == source_node_id:
                    notes.append(parsed)
            except OSError:
                continue

    try:
        source_file = _resolve_source_file(source_node_id)
        if source_file.suffix.lower() in INLINE_EXTENSIONS:
            notes.extend(_inline_notes_for_source(source_node_id, source_file))
    except SourceNodeNotFoundError:
        pass

    notes.sort(key=lambda n: (n.get("created_at") or "", n.get("id") or ""))
    return notes


def collect_all_notes() -> list[dict]:
    """All vault + inline notes for search."""
    all_notes: list[dict] = []
    seen: set[str] = set()

    notes_root = get_workspace_root() / NOTES_DIR
    if notes_root.is_dir():
        for path in notes_root.rglob("*.md"):
            try:
                parsed = _parse_vault_note_file(path)
                if parsed["id"] not in seen:
                    seen.add(parsed["id"])
                    all_notes.append(parsed)
            except OSError:
                continue

    root = get_workspace_root().resolve()
    scanned_files: set[str] = set()
    graph = graph_state.get_current_graph()
    file_paths: list[Path] = []
    if graph:
        for node in graph.get("nodes", []):
            path_str = node.get("path") or ""
            if path_str:
                p = Path(path_str)
                if p.suffix.lower() in INLINE_EXTENSIONS:
                    file_paths.append(p)
    if not file_paths:
        for ext in ("*.md", "*.txt"):
            file_paths.extend(get_workspace_root().rglob(ext))

    for path in file_paths:
        try:
            key = str(path.resolve())
        except OSError:
            continue
        if key in scanned_files:
            continue
        scanned_files.add(key)
        if NOTES_DIR in path.parts:
            continue
        try:
            rel = str(path.relative_to(root))
            node_id = f"file_{rel.replace(chr(92), '/')}"
        except ValueError:
            node_id = ""
        for note in parse_inline_blocks_from_file(
            path,
            source_node_id=node_id,
            workspace_root=root,
        ):
            if note["id"] not in seen:
                seen.add(note["id"])
                all_notes.append(note)

    return all_notes


def search_notes(
    query: str = "",
    label: str = "",
    source_node_id: str = "",
    limit: int = 20,
) -> list[dict]:
    limit = min(max(limit, 1), 100)
    notes = collect_all_notes()
    q = query.strip().lower()
    label = label.strip().lower()
    source_node_id = normalize_source_node_id(source_node_id) if source_node_id else ""

    filtered: list[dict] = []
    for note in notes:
        if source_node_id and note.get("source_node_id") != source_node_id:
            continue
        if label:
            note_labels = [x.lower() for x in note.get("labels") or []]
            if label not in note_labels:
                continue
        if q:
            haystack = " ".join(
                [
                    note.get("title") or "",
                    note.get("body") or "",
                    note.get("selected_text") or "",
                    " ".join(note.get("labels") or []),
                ]
            ).lower()
            if q not in haystack:
                continue
        filtered.append(note)

    return filtered[:limit]


def attached_notes_preview(source_node_id: str, limit: int = 10) -> dict:
    notes = list_notes_for_source(normalize_source_node_id(source_node_id))
    preview = [
        {
            "id": n["id"],
            "title": n.get("title") or "",
            "storage": n.get("storage", "vault"),
        }
        for n in notes[:limit]
    ]
    return {"total": len(notes), "preview": preview}
