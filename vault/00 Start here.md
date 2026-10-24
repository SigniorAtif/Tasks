# Start here

This vault explains the planner app: what each part does, why it was built that way, what it beat, and how it works underneath. It lives in the repo's `vault/` folder and is committed like the code. The repo is public, so every example uses the made-up sample timetable, never your real one.

- [[01 Reading order]] tells you what to read, and in which order.
- [[Glossary]] gives every technical term in one line, linked to the note that explains it.
- [[TypeScript essentials]] teaches the language every file is written in, using our own code. New to TypeScript? Read it before anything else.
- Where the work stands: v0.0, v0.1 and v0.2 are merged; v0.3 (cancelling and groups) is next. Still waiting on you: the one-time server setup (`deploy/README.md`) and the phone checks. The newest overview is [[v0.2 in plain words]].

## How the vault is organised

| Folder | What's in it | Read it when |
|---|---|---|
| `01 Reading order.md` | The guide: only the order and why, no explanations of its own | You don't know what to read next |
| `app/` | How *our* app works: overviews, walkthroughs, and one note per part of the code, file by file | You want to understand our code |
| `foundations/` | *General* technical ideas, explained from zero with examples from our app, grouped by subject (`web/`, `server/`, `database/`, `browser/`, `time/`, `tooling/`, `shipping/`, `algorithms/`). True in any project, not just ours. The [[Glossary]] lives here too | A word or idea in an `app/` note is new to you |
| `decisions/` | One note per choice we made: the options, and why the others lost | You wonder "why not X?" |

Every note's first line says what to read before it:
- `app/` notes open with **Background:** the foundation notes they rely on.
- `foundations/` notes open with **Builds on:** the foundation notes they assume. "Nothing" marks a starting point.

So you never have to guess what's missing: if a note feels hard, follow the links on its first line.

## Two ways to study

- Top-down, the recommended way: start from our app, path 1 in [[01 Reading order]]. When a word is new, follow its link down into `foundations/`, then come back. Each idea arrives the moment you need it.
- Bottom-up: work through `foundations/` subject by subject, in the order [[01 Reading order]] gives under "Foundations, in order", then read the `app/` notes. Slower to start, more systematic.

## How to read a note

1. Predict first. Before opening a note or a file, write a line or two on how you'd build it. Then read and compare. The gap between your guess and the code is what you learn.
2. Follow links when you need them. The vault isn't meant to be read front to back.
3. Explain it back. After a note, explain it aloud or on paper without looking. Where you stall is where to reread.
4. Break it. Change a line, run the tests, and see what fails and why. Every note ends with "Check yourself" questions for this.

## Rules for new notes

- How *our* code works goes in `app/`, a general idea in `foundations/<subject>/`, a choice between options in `decisions/`.
- Write a foundation note the first time its idea shows up in our code, and give every new term a [[Glossary]] line.
- First line: **Background** (app) or **Builds on** (foundations). Last section: `## Check yourself`.
- Anything with more than a few steps or parts gets a Mermaid diagram in a `mermaid` code block (flowchart, sequenceDiagram, erDiagram, stateDiagram-v2). Obsidian draws these itself; no plugin needed.
- Show the code where it's explained. When a note explains how a piece of our code works, the lines that do it sit right there: a short excerpt (usually 4–20 lines, cut with `// …`) under a caption ``*From `path/to/file.ts`:*``, then what to notice in it. Copy excerpts exactly; never paraphrase code.
- Place every new note in [[01 Reading order]].

### Keeping the code excerpts true

Code changes; a copied excerpt doesn't. `tools/check_snippets.py` (in this vault) compares every excerpt with the file its caption names and lists the ones that no longer match:

```sh
python3 vault/tools/check_snippets.py          # from the repo root, against your current checkout
```

Run it on the branch the notes describe, the newest release branch. Every milestone's vault update runs it and fixes what it lists, so the excerpt you read is the code as it is, not as it was.
