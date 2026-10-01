# utils

A local toolbox for people who use [Claude Code](https://claude.com/claude-code). One
Next.js app, one sidebar entry per tool. It runs on your machine, reads your own files, and
sends nothing anywhere.

Two tools ship with it:

- **Claude Sessions** — browse, search, resume and fork every Claude Code session on this
  machine, instead of grepping `~/.claude/projects` for the one you want.
- **Understand** — turn markdown you already have into something you can study: a left-hand
  topic list, the full lesson on the right, progress you tick off, and notes you write in
  place.

**⌘K anywhere** searches across everything at once.

## Running it

Requires Node 20.9+ and the Claude Code CLI if you want the Sessions tool to have anything
to show.

```bash
git clone <your-fork> utils
cd utils
npm install
npm run dev          # http://localhost:3000
```

Open it and the app tells you what to do next — including when it finds nothing, which is
the normal first run.

## Configuration

Both tools read from disk, and both locations are overridable:

| Variable                  | Default                     | What it points at               |
| ------------------------- | --------------------------- | ------------------------------- |
| `CLAUDE_PROJECTS_DIR`     | `~/.claude/projects`        | Claude Code session transcripts |
| `UNDERSTAND_ROOT`         | the repo itself             | Where `understand/` lives       |
| `UNDERSTAND_EXTRA_ROOT`   | unset                       | Other repos holding runbooks, RCAs, reports |
| `UNDERSTAND_LESSON_MODEL` | `sonnet`                    | Model used to write lessons     |

```bash
UNDERSTAND_ROOT=~/notes npm run dev
```

Copy `.env.example` to `.env.local` and fill in what you need; git ignores `.env.local`.
Collections that live in other repositories on your machine (runbooks, RCAs, reports) appear
only when `UNDERSTAND_EXTRA_ROOT` points at them. Any variable a document references as
`{{env:NAME|fallback}}` is read from the same environment.

## Claude Sessions

Instant search over session titles and everything you typed; filter by project and recency;
sort by recent, oldest, most prompts, longest running or largest transcript. **Deep search**
greps the full transcripts, tool output included, and ranks by hit count.

Each session offers copyable commands:

|                  |                                                                         |
| ---------------- | ----------------------------------------------------------------------- |
| Resume           | `claude --resume <id>` — same session, where you left off               |
| Fork             | `claude --resume <id> --fork-session` — new session, original untouched |
| Ask one question | `claude --resume <id> -p "…"` — headless, prints and exits              |
| Background       | `claude --resume <id> --bg`                                             |
| Overrides        | `--model` / `--effort` for the rest of the session                      |
| Export           | the whole transcript as markdown                                        |

Every command `cd`s into the session's **owning** directory first. Claude Code derives a
project's history folder from the directory it was started in, so `--resume` from anywhere
else won't find the session — and sessions often move directories part-way through.

The detail view renders the transcript with collapsed tool calls and a _Your prompts_ tab.
Long transcripts page at 250 entries, large tool bodies load on expand, and very long pasted
text is clipped on screen (never in the export) — without that, one 12 MB session took 51
seconds and 11 MB of HTML to render.

**This tool never writes to `~/.claude`.**

## Understand

Point it at markdown and it becomes a study surface.

A **track** is a subject. Each track is a folder of numbered modules; each module is a
checklist whose `- [ ]` lines are its topics:

```
understand/tracks/<id>/
├── track.json        name, order, `visibility`, and a `context` paragraph
├── 00-*.md …         modules — `- [ ]` lines become topics
├── lessons/          written per topic (generated)
└── notes/            your own words (you write these)
```

The tracks in `understand/tracks/` ship with the repo — `voice-platform` and a small
`kubernetes-basics` example — so a fresh clone opens on real material. `understand/README.md`
is the guide to adding your own.

- **Every topic can have a lesson** — real teaching material stored as markdown, not a
  prompt telling you to go ask elsewhere. _Teach me this_ writes a missing one by shelling
  out to your already-authenticated `claude` CLI, so there's no API key to manage.
- **Ticking a topic writes `- [x]` into the markdown itself**, so your editor, your git
  host and this app never disagree.
- **Notes go where the curriculum says** — under each topic's `##` section in
  `notes/<module>.md`, written from the topic rather than a separate file.
- **Archive** means read and understood. It leaves the active list, stays searchable, and
  restores in a click. Nothing is deleted.
- Documents with no checkboxes — runbooks, write-ups — navigate by their `##` headings
  instead, so any markdown works.

Fill a track's lessons in bulk:

```bash
npm run dev                        # in another terminal
npm run lessons -- <track> --dry   # preview
npm run lessons -- <track>
```

`/understand/progress` shows topics and lessons per module, your plan if the track's README
has one, and a prerequisite graph computed from each module's `**Prerequisites:**` line.

Collections beyond tracks — runbooks, policies, reports — are listed in
`lib/understand/roots.ts`.

## Public and private content

Content and tool live in one repo, so `git clone` is a working install with real material
in it. Two mechanisms keep that safe, and they do different jobs.

**One privacy rule: anything under a `private/` folder never leaves this machine.** A
subject that is about one organisation — an audit, an incident review — goes in
`understand/private/<track>/` instead of `understand/tracks/<track>/`. Same structure, read
identically by the app, ignored by git. Locally you see everything; a clone sees `tracks/`.

**`{{env:NAME|fallback}}` placeholders keep a public track useful.** Write the shape, not
the value:

```md
The telephony servers run inside {{env:TELEPHONY_CUSTOMER|the customer}}'s VPC.
```

With the variable set in `.env.local` you read your own value; everyone else reads the
fallback and the sentence still teaches the same thing. No fallback renders as `⟨NAME⟩`,
so nobody mistakes a template for a fact. `.env.example` lists every placeholder the shipped
tracks use. The `{{env:…}}` form was chosen because bare `$VAR` collides with the shell
snippets in these documents and `{{ VAR }}` collides with Helm and Jinja.

Placeholders are resolved when a document is read — nothing on disk changes.

### What a placeholder cannot do

A placeholder hides a *value*. It cannot hide a *sentence*. "GuardDuty is disabled in the
production account and nobody owns the fix" is sensitive with or without the account number
in it. Material like that belongs under `private/`, whole. The check below will not catch
it, because no regex can tell a vulnerability description from a lesson about one.

## Public mode

The **Private / Public** switch in the top bar is for when someone else can see your screen.
Public mode shows exactly what a fresh clone of this repo would show, and nothing else:

| | Private (default) | Public |
| --- | --- | --- |
| `understand/tracks/` | shown | shown |
| `understand/private/` (incl. saved Claude sessions) | shown | hidden |
| Runbooks, RCAs, reports from other repos | shown | hidden |
| Claude Sessions | shown | hidden |

The choice persists in a cookie, so it survives reloads; switch back when the call ends.

It is enforced where data is *read*, not where it is drawn. In public mode the index itself
is smaller, so a private document is not merely unrendered — it is absent from the page
payload, from ⌘K, from `/api/understand`, and from every write route (ticking a topic or
saving a note against a private module is refused). The session routes answer `403`. If you
want to check, open a private document's URL in public mode and view source: the words are
not there.

## Before you push

```bash
npm run check:public      # also runs as part of `npm run check`
```

It looks at exactly what git would commit — tracked and untracked files, `.gitignore`
respected — and **refuses** on any of:

| Checked where | For |
| ------------- | --- |
| every path | a `private/` segment visible to git (the rule has been broken) |
| every file | access keys, private-key blocks, bearer tokens |
| prose and hand-written config | account ids, VPC/subnet ids, public IPs, `*.internal` hostnames |
| every file | the name of any track under `private/` |

Identifier rules are applied only to prose and hand-written config because they are shape
matches: an SVG path (`M1.31 38.89`) is indistinguishable from an IP address, and a check
that cries wolf gets ignored. Credentials have unmistakable shapes and are looked for
everywhere, including inside an SVG comment.

The last row is derived, not configured. The script already knows which tracks are private,
so a usage example or default argument naming one is caught without a wordlist.

## Adding a tool

1. Add an entry to `lib/utils-registry.ts`.
2. Create `app/<slug>/page.tsx`.

The sidebar, the `/` redirect and the ⌘K palette all read the registry.

## Checks

```bash
npm run check         # tsc + eslint + audit:ui + check:audit + check:public
npm run audit:ui      # UI invariants only
npm run check:public  # what git would commit, scanned for secrets
```

`scripts/audit-ui.mjs` catches mistakes a server-side check cannot see. React skips
`createPortal` during SSR, so a menu, dialog or tooltip missing its context root returns a
clean 200 from `curl` and then throws on hydration. It verifies statically that every Base
UI / cmdk part has its required root, every menu label sits inside a group, and every
`Button` rendering a link declares `nativeButton={false}`. All three have bitten this app.

## Privacy

Everything is local. The app reads your session transcripts and your markdown from disk,
serves them to `localhost`, and makes no outbound requests. Lesson generation shells out to
the `claude` CLI on your machine. Nothing is uploaded, and your transcripts are never
written to.

## Licence

MIT — see `LICENSE`.
