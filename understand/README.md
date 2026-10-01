# Understand

Everything you're deliberately learning, organised as **tracks** — one per subject. Browse
it at <http://localhost:3000/understand> (`npm run dev` from the repo root).

This folder ships with the app. Clone the repo and the tracks are already here; add a track
and it appears in the app with no code change. Several people can contribute to the same
repo, which is the point of keeping content and tool together.

## Layout

```
understand/
├── tracks/                      ← public: everything here goes to GitHub
│   └── <track-id>/
│       ├── track.json           ← name, description, order, and the context
│       │                          fed into every lesson prompt for this track
│       ├── README.md            ← the track's own guide (optional)
│       ├── 00-*.md … NN-*.md    ← modules, each a checklist of topics
│       ├── lessons/<module>/    ← the written lesson for each topic
│       └── notes/<module>.md    ← your own explanation, in your own words
├── private/                     ← never leaves your machine
│   ├── <track-id>/              ← same structure as a public track
│   └── claude/                  ← documents Claude wrote for you, saved sessions
└── .understand.json             ← your archive marks (ignored by git)
```

## The one privacy rule

**Anything under a `private/` folder stays on this machine.** `.gitignore` ignores every
`private/` directory, and `npm run check:public` refuses to pass if a private path is visible
to git or a public file names a private track. The app reads `tracks/` and `private/`
identically, so locally you see everything.

Use it for whole subjects that are about one organisation — an audit, an incident review, a
system only you run. Saved Claude sessions always land here: a transcript about your work is
private even when nothing in it looks like a secret, which is also why no scanner can be the
only line of defence. For a public track that merely *mentions* something specific, use a
placeholder instead.

## Placeholders

Write the shape, not the value:

```md
The telephony servers run inside {{env:TELEPHONY_CUSTOMER|the customer}}'s VPC.
```

With `TELEPHONY_CUSTOMER` set in `.env.local`, you read the real name. Everyone else reads
*the customer*, and the sentence still teaches the same thing. Without a fallback an unset
placeholder renders as `⟨TELEPHONY_CUSTOMER⟩` so nobody mistakes a template for a fact.

List every placeholder you introduce in `.env.example` with a one-line comment. That file is
the contract between the content and whoever reads it.

Placeholders are resolved when a document is read. Nothing on disk changes, and `.env.local`
is ignored by git.

## Adding a track

1. `mkdir -p understand/tracks/<id>` — or `understand/private/<id>` if it should not be shared.
2. Write `track.json`:

   ```json
   {
     "name": "Backend Engineering",
     "description": "What it says",
     "order": 2,
     "context": "Who is learning this, what system they work on, and why it matters. This paragraph is pasted into every lesson prompt for the track, so be specific — it is what keeps lessons grounded in your world instead of generic."
   }
   ```

3. Add numbered module files (`00-foo.md`, `01-bar.md`, …). Each module is a checklist:

   ```markdown
   # 01. Some module

   **Goal:** what you should be able to do at the end.

   **Prerequisites:** none. **Time:** 4 to 6 hours.

   ## Topics

   - [ ] **A topic** — one line explaining it.
     - Ask: "a question that would teach this"
     - See: `a read-only command that shows it`
   ```

4. Run `npm run check:public` before you commit. It tells you exactly what to template.

Documents without checkboxes — write-ups, architecture explanations — work too; the app
navigates them by their `##` headings. `voice-platform` is one of these.

## How a track works

Each `- [ ]` is a topic. Every topic can have a **lesson** — the actual teaching material,
written by Claude and stored as markdown in `lessons/`, with a real-world analogy, the real
mechanism, how it shows up in your own environment, and three questions to check yourself.
The lesson is the resource; you are not meant to go and ask somewhere else.

Tick a topic only when you can explain it to someone else without looking. Ticking from the
app writes `- [x]` back into the module file, so your editor and the app always agree.

Archive a document once you've read and understood it. It leaves the active list, stays
searchable under *Archived*, and can be restored. Nothing is deleted.
