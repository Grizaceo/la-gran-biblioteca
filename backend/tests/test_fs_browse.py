"""Tests for fs_browse path sandbox."""

from __future__ import annotations

import pytest

from backend.fs_browse import is_path_allowed, list_directory, resolve_browse_path, resolve_import_path


def test_resolve_browse_path_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    p = resolve_browse_path(None)
    assert p == tmp_path.resolve()


def test_rejects_outside_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    with pytest.raises(ValueError, match="outside"):
        resolve_browse_path("/etc")


def test_list_directory_skips_hidden_technical(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "docs").mkdir()
    (tmp_path / "readme.md").write_text("hi", encoding="utf-8")
    (tmp_path / ".git").mkdir()
    data = list_directory(tmp_path, include_files=True)
    names = {e["name"] for e in data["entries"]}
    assert "docs" in names
    assert "readme.md" in names
    assert ".git" not in names


def test_resolve_import_file(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    resolved = resolve_import_path(str(f), must_be_file=True, must_be_dir=False)
    assert resolved == f.resolve()


def test_is_path_allowed_under_home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    sub = tmp_path / "vault"
    sub.mkdir()
    assert is_path_allowed(sub)
