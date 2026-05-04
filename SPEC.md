# Agent Reader — Project Spec

## Core Concept

A desktop app for reading PDFs with an AI agent you can invoke on any selection. Highlight a paragraph, press a hotkey, ask a question (or accept the default "Explain this"), and get a streamed response in a sidebar. The agent can tool-call its way through the rest of the document to answer intelligently — not just the passage you selected.

Designed for dense non-fiction, legal documents, and anything where you'd otherwise reread a paragraph three times and give up.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Shell | Electron | |
| UI | React + TypeScript | |
| PDF rendering | `react-pdf` (PDF.js) | Handles rendering; text extraction reuses `pdfjs-dist` |
| Agent harness | `claude -p` subprocess | Uses existing Claude subscription; MCP plugins from `~/.claude` work for free |
| PDF tools | Local MCP server | Required — `claude -p` has no inline tool definition flag; tools must be built-in or MCP |
| PDF text extraction | `pdfjs-dist` | Powers the local MCP server |
| EPUB (v2) | `epubjs` | Deferred |

---

## MVP User Flow

1. Open a PDF from disk
2. Select a paragraph or two with the mouse
3. Press hotkey (`Cmd+Shift+A` or similar)
4. Small floating prompt dialog appears, pre-filled with **"Explain this"**
5. Press Enter (or type a custom question) → sidebar opens with streaming response
6. Type follow-ups; full back-and-forth in sidebar

---

## Agent Design

### Initial context

Each agent invocation receives:
- The highlighted text
- The user's question
- The current page number
- Text of the surrounding page(s) (~1 page before and after)
- Document metadata: title, total page count, table of contents (if present — not all PDFs have one)

### Tools

```
get_page(page_number)        → full text of that page
get_pages(start, end)        → range of pages (capped, e.g. max 10 at a time)
search_text(query)           → matching passages with page numbers and surrounding lines
get_toc()                    → chapter/section structure, or null if not present
```

No indexing, no embeddings. The agent uses `search_text` and page fetching to navigate the document, the same way Claude Code reads a codebase. When no TOC is available, `search_text` is the primary navigation tool — the agent searches for key terms and concepts from the highlighted passage to find related sections.

---

## Architecture

```
Renderer (React)                     Main Process (Node/Electron)
────────────────────────             ────────────────────────────────
PDF viewer (react-pdf)               File system / PDF extraction
Mouse selection listener   →  IPC →  Spawn `claude -p` subprocess
Floating prompt dialog                 - tools defined as MCP or stdin
                                       - stdout streamed back over IPC
Sidebar (streaming chat)   ←  IPC ←  Stream tokens back
```

The agent runs as a `claude -p` subprocess in the main process. `claude -p` does not support inline tool definitions — tools must be either built-in (Bash, Read, Edit) or exposed via MCP. The PDF tools are therefore a local MCP server that the Electron app spins up at launch.

The MCP server can be registered permanently in `~/.claude` or passed per-invocation via `--mcp-config`. The latter is cleaner for a desktop app since it avoids polluting the user's global Claude config.

Streaming output uses `--output-format stream-json --verbose --include-partial-messages`, which emits newline-delimited JSON events. The main process parses these and forwards text deltas to the renderer over IPC.

Any MCP servers already configured in `~/.claude` — Westlaw, web search, etc. — are automatically available to the agent with no additional wiring, since `claude -p` without `--bare` inherits the full `~/.claude` config.

---

## Open Questions

These aren't blockers but should be decided before building the corresponding piece:

**1. Hotkey scope**
App-level only (simpler, safer) vs. system-wide global hotkey. Global would let you trigger from Preview or a browser PDF — much larger scope, probably v2.

**2. Sidebar vs. separate window**
Sidebar alongside the PDF is the better UX. A separate always-on-top window is easier to build first. Lean toward sidebar from the start to avoid rearchitecting later.

**3. Conversation scope**
Does chat history reset on each new highlight, or persist across highlights in the same document session? Recommendation: reset per highlight, but offer a "continue in this thread" affordance.

**4. Model**
Defaults to whatever `claude` uses by default (currently `claude-sonnet-4-6`). Can be overridden via `--model` flag if needed.

---

## Phases

### v1 — MVP
- Open PDF from disk
- Text selection + hotkey trigger
- Floating prompt dialog with smart default
- Sidebar with streaming response and follow-up chat
- Agent tools: `get_page`, `get_pages`, `search_text`, `get_toc`

### v2
- EPUB support via `epubjs`
- Inline annotations: save a note/summary anchored to a page range, visible in the margin
- Model switcher (settings panel, Ollama for offline use)

### v3
- MCP integration for external tools (Westlaw, web search, etc.) — largely free since `claude -p` inherits `~/.claude` MCP config
- "Reading mode": agent surfaces related passages as you scroll
