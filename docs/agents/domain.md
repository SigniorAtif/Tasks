# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists: it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`JOURNEY.md` §3 (Decisions log)**: this repo's ADRs. Read the `ADR v0.x` entries (one per milestone) and the `D-0xx` entries that touch the area you're about to work in. The longer, proposed D-entries live in `docs/brainstorm/00-overview.md` §4; where an ADR and the overview disagree, the ADR wins.

There is no `docs/adr/` folder: record a new decision as a bullet in the current milestone's `ADR v0.x` entry in `JOURNEY.md` (create the entry if the milestone has none), with a matching note in the git-ignored `vault/decisions/`. If `CONTEXT.md` doesn't exist, **proceed silently**; the `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates it lazily when terms actually get resolved.

## File structure

This repo is single-context:

```
/
├── CONTEXT.md
├── JOURNEY.md                         ← decisions: ADR v0.x and D-0xx entries in §3
├── docs/brainstorm/00-overview.md     ← the plan and the proposed D-entries
├── apps/
│   ├── api/
│   └── web/
└── packages/
    └── core/
```

Multi-context repo (presence of `CONTEXT-MAP.md` at the root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR v0.3 (groups have no first day), but worth reopening because…_
