# Start here

This vault explains the planner app: what each part does, why it was chosen, what the alternatives were, and how it works, down to the details. It lives in the repo's `vault/` folder and is committed like the code. The repo is public, so examples use the made-up sample timetable, never your real one.

- **Where to begin:** [[01 Reading order]], the guide: which notes to read, in which order.
- **Stuck on a word?** [[Glossary]]: every technical term in one line, linked to the note that explains it.
- **New to TypeScript?** [[TypeScript essentials]]: the language every file is written in, explained with our own code. Read it before anything else.
- **State of the work:** v0.0, v0.1 and v0.2 are merged; v0.3 (cancelling and groups) is next. Still waiting: your one-time server setup (`deploy/README.md`) and the phone checks. Newest overview: [[v0.2 in plain words]]. Past session handoffs are archived in `handoffs/` (latest: [[Handoff v0.2 (2026-10-13)]]); new ones come from `/handoff` in Claude Code, which saves to `/tmp` (gone after a reboot).

## How the vault is organised

| Folder | What's in it | Read it when |
|---|---|---|
| `01 Reading order.md` | The guide. Only the order and why, no explanations of its own | You don't know what to read next |
| `app/` | How **our** app works: overviews, walkthroughs, and one note per part of the code, file by file | You want to understand our code |
| `foundations/` | **General** technical ideas, explained from zero with examples from our app, grouped by subject (`web/`, `server/`, `database/`, `browser/`, `time/`, `tooling/`, `shipping/`, `algorithms/`). True in any project, not just ours. The [[Glossary]] lives here too | A word or idea in an `app/` note is new to you |
| `decisions/` | One note per choice we made: the options, and why the others lost | You wonder "why not X?" |

**Every note says what to read before it**, on its first line:
- `app/` notes have **Background:** the foundation notes they rely on.
- `foundations/` notes have **Builds on:** the foundation notes they assume. "Nothing" marks a starting point.

So you never need to guess what's missing: if a note feels hard, read its first line's links.

## Two ways to study

- **Top-down (recommended):** start from our app ([[01 Reading order]], path 1). Read a note; when a word is new, follow its link down into `foundations/`, then come back. You learn each idea at the moment you need it.
- **Bottom-up:** go through `foundations/` subject by subject in the order given in [[01 Reading order]] ("Foundations, in order"), then read the `app/` notes. Slower to start, but more systematic.

## How to read a note

1. **Predict first.** Before opening a note or a file, write one or two lines: "how would I build this?" Then read and compare. The gap between your guess and the real thing is what you learn.
2. **Follow links on demand.** Don't read the vault front to back.
3. **Explain it back.** After a note, explain it out loud or in writing without looking. Where you get stuck is where to reread.
4. **Break it.** Change a line, run the tests, see what fails and why. Every note ends with "Check yourself" questions for this.

## Rules for new notes

- How *our* code works → `app/`. A general idea → `foundations/<subject>/`. A choice between options → `decisions/`.
- A foundation note is written the first time its idea shows up in our code, and every new term gets a [[Glossary]] line.
- First line: **Background** (app) or **Builds on** (foundations). Last section: `## Check yourself`.
- When something has more than a few steps or parts, draw it as a Mermaid diagram in a `mermaid` code block (flowchart, sequenceDiagram, erDiagram, stateDiagram-v2). Obsidian draws these itself; no plugin needed.
- **Show the code where it's explained.** When a note explains how a piece of our code works, the lines that do it sit right there: a short excerpt (usually 4–20 lines, cut with `// …`) under a caption `*From `path/to/file.ts`:*`, followed by what to notice in it. Excerpts are copied exactly, never paraphrased.
- [[01 Reading order]] gets the new note in its place.

### Keeping the code excerpts true

Code changes; a copied excerpt doesn't. `tools/check_snippets.py` (in this vault) compares every excerpt with the file its caption names and lists any that no longer match:

```sh
python3 vault/tools/check_snippets.py          # from the repo root, against your current checkout
```

Run it on the branch the notes describe (the newest release branch). Each milestone's vault update runs it and fixes what it lists, so an excerpt you read is the code as it is, not as it was.
