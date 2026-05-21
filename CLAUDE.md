# Agent Reader

An Electron/React desktop app for reading PDFs with an embedded AI agent. Highlight text, press a hotkey, and get a streamed response in a sidebar. The agent navigates the document via MCP tools (no embeddings — tool-based search like Claude Code reading a codebase).

Full spec and key decisions: `SPEC.md`  
Architecture and cross-cutting concepts: `~/kb/` (use the `kb` CLI)

## Session workflow

This project uses [Chainlink](https://github.com/dollspace-gay/chainlink) for issue tracking and session handoffs. The DB lives in `.chainlink/` (gitignored).

**Starting a work session** — when the user is about to do work, first check if a session is already active:
```bash
chainlink session status
```
If one is active, continue it. If not, start one:
```bash
chainlink session start
chainlink next          # see what's ready to work on
```

**During a session:**
```bash
chainlink session work <id>          # mark what you're focused on
chainlink session action "note"      # leave a breadcrumb mid-session
chainlink comment <id> "note"        # attach a note to a specific issue
```

**Ending a session** — always end with handoff notes:
```bash
chainlink session end --notes "what you found, what's next"
```

**Creating issues:**
```bash
chainlink create "Title" --label feature   # new feature
chainlink create "Title" --label bug       # bug
chainlink quick "Title"                    # create + label + start in one step
```

When the user says "start a session", "end the session", or "end the session with notes", use these chainlink commands.

## Stack

- Electron shell, React + TypeScript renderer
- `react-pdf` (PDF.js) for rendering; `pdfjs-dist` for text extraction
- `claude` CLI subprocess (interactive PTY) for the AI agent (inherits `~/.claude` MCP servers)
- Local MCP server exposes PDF tools: `get_page`, `get_pages`, `search_text`, `get_toc`
- SQLite via `better-sqlite3` for marks, sessions, and project metadata

## Key conventions

- Tests live alongside source files as `*.test.ts(x)` — run with `npm test`
- Debug logging must be gated behind `DEBUG_<FEATURE>=1` / `VITE_DEBUG_<FEATURE>=1`
- New files in `src/main/` or `src/renderer/src/` should ship with a sibling test
