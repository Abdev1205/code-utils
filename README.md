# utils

A local toolbox. One Next.js app, one sidebar entry per tool. Runs on your Mac, talks to nothing
external.

```bash
cd utils
npm install      # first time only
npm run dev      # http://localhost:3000
```

`/` redirects to the first tool in the registry.

## Tools

### Claude Sessions — `/claude-sessions`

Visual browser for every Claude Code session on this machine, so you don't have to grep
`~/.claude/projects` to find one.

- **Find it** — instant search over session titles and everything you typed. Filter by project and
  recency, sort by recent / oldest / most prompts / longest running / largest transcript.
  **Deep search** (button, or Enter in the search box) greps the full transcripts including tool
  output, and ranks by hit count.
- **⌘K** — jump straight to a session by name or prompt text from anywhere in the app.
- **Read it** — the detail page renders the transcript with markdown, collapsed tool calls,
  collapsed thinking blocks, and a *Your prompts* tab that's just your side of the conversation.
- **Continue it** — every session offers copyable commands:

  | | |
  |---|---|
  | Resume | `claude --resume <id>` — same session, where you left off |
  | Fork | `claude --resume <id> --fork-session` — new session from this history, original untouched |
  | Ask one question | `claude --resume <id> -p "…"` — headless, prints and exits |
  | Resume in background | `claude --resume <id> --bg` |
  | Resume with overrides | `--model` / `--effort` for the rest of the session |
  | Session ID · transcript path · open in editor | for your own commands |
  | Export | full transcript as markdown |

  Every command `cd`s into the session's **owning** directory first. Claude Code derives a project's
  history folder from the directory it was started in, so `--resume` from anywhere else won't find
  the session. 22 of the current sessions moved directories part-way through — the owning directory
  is the one that works, not the last one Claude was in.

Read-only: the app never writes to `~/.claude`.

## Adding a tool

1. Add an entry to `lib/utils-registry.ts`:

   ```ts
   { slug: "my-tool", name: "My Tool", description: "…", icon: SomeLucideIcon }
   ```

2. Create `app/my-tool/page.tsx` (plus `loading.tsx` for a skeleton).

The sidebar, the `/` redirect, and the ⌘K palette all read the registry — nothing else to wire up.

## Layout

```
lib/claude-sessions/    indexer (streams JSONL, mtime-cached), commands, markdown export
lib/utils-registry.ts   the tool list
app/api/claude-sessions ?          index · [id] transcript · [id]/export · search
components/ui/          shadcn
```

The corpus is ~115 MB of JSONL, so nothing is ever loaded whole. Files stream line by line, the list
view keeps only small per-session metadata, and transcripts are parsed one session at a time.
Summaries are cached on `mtime + size` — a reload only re-reads sessions that actually changed
(52 sessions index in ~25 ms warm).

Three caps keep the detail page responsive, all of them visible in the UI rather than silent:

- **250 entries per page.** The largest session here runs to 1027 entries; rendering them at once
  took 51 s and 11 MB of HTML. Paged, the worst page is ~2.5 s.
- **Tool bodies over 700 chars load on expand**, from `/api/claude-sessions/[id]/tool?call=…`.
  Inlining every one was most of the page weight, for output that's almost never opened.
- **Message text clipped at 40k chars.** 99% of messages are under 24k; the outliers are pasted logs
  up to 958k chars. Clipped messages say so, with exact counts.

The markdown export bypasses all three — full text, every tool body, one request (~0.5 s even for
the 12 MB session).

Point it at a different corpus with `CLAUDE_PROJECTS_DIR`.
