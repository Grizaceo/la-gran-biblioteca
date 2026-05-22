# RepoCiv, Hermes, and the knowledge plane

This document describes how **La Gran Biblioteca** fits into the broader Hermes / RepoCiv agent ecosystem. It is optional context for contributors who use that stack; the app itself only needs a filesystem vault (`WORKSPACE_ROOT`).

---

## Game-like UI for agents

Inspired by tools such as AgentCraft, the RepoCiv ecosystem uses a real-time strategy (RTS) metaphor to reduce **observability fatigue** when many agents run asynchronously.

In RepoCiv:

- Repositories are **cities**
- Background processes are **buildings**
- Agents (DAVI, LexO, workers) are **units** with energy and movement states

## Orthogonal planes

### Knowledge plane (La Gran Biblioteca)

- **Physical mapping:** `WORKSPACE_ROOT` (often `~/.hermes/workspaces` for Hermes users, or `~/knowledge` for a generic vault)
- **Purpose:** Document vault — papers, notes, plans, domain context for specialist agents
- **In-game concept:** The “Library of Alexandria” wonder — agents **read and study** here; no operational dashboards

### Tools / skills plane (LabHub / Workshop)

- **Physical mapping:** e.g. `~/.hermes/workspace/repos/labhub`
- **Purpose:** Domain-agnostic UI skills and visualizers (SSE monitors, tensor views, telemetry)
- **In-game concept:** The **Workshop** — workers assemble interfaces reused across labs

## Integration in RepoCiv

Specialized UIs (Biblioteca, LabHub, third-party tools) are embedded via **capability-based micro-frontends**, often in a glassmorphism modal with `<iframe src="...">`, so the main RepoCiv canvas stays independent of each tool’s stack (Vue, Three.js, React/Vite, etc.).

## Technical boundary

La Gran Biblioteca’s backend exposes a **stable graph JSON API** (nodes + edges). RepoCiv and other hosts consume that API; this repository does not implement the RTS map or agent orchestration.
