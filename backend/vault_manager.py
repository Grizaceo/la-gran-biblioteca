"""Multi-vault registry and active vault context."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

LGB_DIR = ".lgb"
DB_NAME = "library.db"
_DEFAULT_REGISTRY = Path.home() / ".hermes" / "lgb" / "vaults.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def vault_id_for_path(path: Path) -> str:
    resolved = str(path.resolve())
    return hashlib.sha256(resolved.encode()).hexdigest()[:12]


@dataclass
class VaultConfig:
    id: str
    name: str
    path: str
    created_at: str
    last_opened_at: str

    @property
    def root(self) -> Path:
        return Path(self.path)

    @property
    def db_path(self) -> Path:
        return self.root / LGB_DIR / DB_NAME

    @property
    def display_name(self) -> str:
        return self.name


def ensure_vault_layout(path: Path) -> Path:
    """Create {vault}/.lgb/ if missing; return db_path."""
    lgb = path / LGB_DIR
    lgb.mkdir(parents=True, exist_ok=True)
    return lgb / DB_NAME


def _normalize_vault_path(path: str | Path) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ValueError("Vault path must be absolute")
    p = p.resolve()
    if not p.exists():
        raise ValueError(f"Vault path does not exist: {p}")
    if not p.is_dir():
        raise ValueError(f"Vault path is not a directory: {p}")
    if not os.access(p, os.R_OK):
        raise ValueError(f"Vault path is not readable: {p}")
    return p


class VaultManager:
    def __init__(self, registry_path: Path | None = None) -> None:
        self.registry_path = Path(
            registry_path
            or os.environ.get("LGB_REGISTRY_PATH", str(_DEFAULT_REGISTRY))
        )
        self._data: dict[str, Any] = {"active_id": None, "vaults": []}
        self._bootstrapped = False

    def _load_registry(self) -> None:
        if self.registry_path.exists():
            try:
                raw = json.loads(self.registry_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    self._data = {
                        "active_id": raw.get("active_id"),
                        "vaults": list(raw.get("vaults") or []),
                    }
            except (OSError, json.JSONDecodeError) as exc:
                logger.warning("Could not load vault registry %s: %s", self.registry_path, exc)

    def _save_registry(self) -> None:
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        self.registry_path.write_text(
            json.dumps(self._data, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def _entry_to_config(self, entry: dict[str, Any]) -> VaultConfig:
        return VaultConfig(
            id=str(entry["id"]),
            name=str(entry.get("name") or Path(entry["path"]).name),
            path=str(entry["path"]),
            created_at=str(entry.get("created_at") or _now_iso()),
            last_opened_at=str(entry.get("last_opened_at") or _now_iso()),
        )

    def list_vaults(self) -> list[VaultConfig]:
        self._load_registry()
        return [self._entry_to_config(v) for v in self._data.get("vaults", [])]

    def _resolve_existing_root(self, path: str | Path) -> Path | None:
        try:
            p = Path(path).expanduser().resolve()
        except (OSError, ValueError):
            return None
        if p.is_dir() and os.access(p, os.R_OK):
            return p
        return None

    def get_active(self) -> VaultConfig:
        self._load_registry()
        active_id = self._data.get("active_id")
        if active_id:
            for entry in self._data.get("vaults", []):
                if entry.get("id") == active_id:
                    root = self._resolve_existing_root(entry.get("path", ""))
                    if root is not None:
                        return self._entry_to_config({**entry, "path": str(root)})
                    break
        vaults = self._data.get("vaults") or []
        for entry in vaults:
            root = self._resolve_existing_root(entry.get("path", ""))
            if root is not None:
                cfg = self._entry_to_config({**entry, "path": str(root)})
                if active_id and entry.get("id") != active_id:
                    logger.warning(
                        "Active vault missing or unreadable; falling back to %s",
                        root,
                    )
                return cfg
        from . import constants

        root = constants.WORKSPACE_ROOT.expanduser().resolve()
        if root.is_dir():
            ensure_vault_layout(root)
        return VaultConfig(
            id=vault_id_for_path(root),
            name=root.name,
            path=str(root),
            created_at=_now_iso(),
            last_opened_at=_now_iso(),
        )

    def register_vault(
        self,
        path: str | Path,
        *,
        name: str | None = None,
        activate: bool = False,
    ) -> VaultConfig:
        root = _normalize_vault_path(path)
        ensure_vault_layout(root)
        vid = vault_id_for_path(root)
        display = (name or root.name).strip() or root.name
        now = _now_iso()

        self._load_registry()
        vaults: list[dict[str, Any]] = list(self._data.get("vaults") or [])
        for entry in vaults:
            if entry.get("id") == vid or Path(entry.get("path", "")).resolve() == root:
                entry["name"] = display
                entry["path"] = str(root)
                entry["last_opened_at"] = now
                cfg = self._entry_to_config(entry)
                if activate:
                    self._data["active_id"] = cfg.id
                self._save_registry()
                return cfg

        entry = {
            "id": vid,
            "name": display,
            "path": str(root),
            "created_at": now,
            "last_opened_at": now,
        }
        vaults.append(entry)
        self._data["vaults"] = vaults
        if activate or not self._data.get("active_id"):
            self._data["active_id"] = vid
        self._save_registry()
        return self._entry_to_config(entry)

    def remove_vault(self, vault_id: str) -> bool:
        self._load_registry()
        vaults = self._data.get("vaults") or []
        new_vaults = [v for v in vaults if v.get("id") != vault_id]
        if len(new_vaults) == len(vaults):
            return False
        self._data["vaults"] = new_vaults
        if self._data.get("active_id") == vault_id:
            self._data["active_id"] = new_vaults[0]["id"] if new_vaults else None
        self._save_registry()
        return True

    def rename_vault(self, vault_id: str, name: str) -> VaultConfig | None:
        self._load_registry()
        clean = name.strip()
        if not clean:
            raise ValueError("Vault name cannot be empty")
        for entry in self._data.get("vaults") or []:
            if entry.get("id") == vault_id:
                entry["name"] = clean
                self._save_registry()
                return self._entry_to_config(entry)
        return None

    def switch_vault(self, vault_id_or_path: str, *, by_path: bool = False) -> VaultConfig:
        if by_path:
            cfg = self.register_vault(vault_id_or_path, activate=True)
        else:
            self._load_registry()
            found = None
            for entry in self._data.get("vaults") or []:
                if entry.get("id") == vault_id_or_path:
                    found = entry
                    break
            if found is None:
                raise ValueError(f"Unknown vault id: {vault_id_or_path}")
            root = _normalize_vault_path(found["path"])
            found["path"] = str(root)
            found["last_opened_at"] = _now_iso()
            ensure_vault_layout(root)
            self._data["active_id"] = found["id"]
            self._save_registry()
            cfg = self._entry_to_config(found)

        from . import constants

        constants.WORKSPACE_ROOT = cfg.root
        return cfg

    def vault_to_public(self, cfg: VaultConfig, *, active: bool | None = None) -> dict[str, Any]:
        if active is None:
            active = cfg.id == self._data.get("active_id")
        return {
            "id": cfg.id,
            "name": cfg.name,
            "path": cfg.path,
            "db_path": str(cfg.db_path),
            "active": active,
            "created_at": cfg.created_at,
            "last_opened_at": cfg.last_opened_at,
        }

    def bootstrap(self) -> VaultConfig:
        if self._bootstrapped:
            return self.get_active()

        from . import constants

        self._load_registry()
        env_root = constants.WORKSPACE_ROOT.expanduser().resolve()
        legacy_db = Path(__file__).parent / "library.db"
        target_db = env_root / LGB_DIR / DB_NAME

        if legacy_db.exists() and not target_db.exists():
            ensure_vault_layout(env_root)
            try:
                shutil.copy2(legacy_db, target_db)
                logger.info("Migrated legacy DB to %s", target_db)
            except OSError as exc:
                logger.warning("Legacy DB migration failed: %s", exc)

        if not self._data.get("vaults"):
            if not env_root.exists():
                try:
                    env_root.mkdir(parents=True, exist_ok=True)
                    logger.info("Created default vault directory %s", env_root)
                except OSError as exc:
                    logger.warning(
                        "WORKSPACE_ROOT %s missing and could not be created: %s",
                        env_root,
                        exc,
                    )
            if env_root.is_dir():
                self.register_vault(env_root, name=env_root.name, activate=True)
        elif not self._data.get("active_id"):
            self._data["active_id"] = self._data["vaults"][0]["id"]
            self._save_registry()

        cfg = self.get_active()
        constants.WORKSPACE_ROOT = cfg.root
        self._bootstrapped = True
        return cfg


vault_manager = VaultManager()
