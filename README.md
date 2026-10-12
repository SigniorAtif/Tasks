# Tasks

A calendar and tasks hybrid for students and builders. Your fixed week stays visible, tasks and projects sit beside it, and you drag them onto free time.

Status: pre-release (`0.x.x`). Design docs live in `docs/brainstorm/`.

## Development

Needs Node 24 or newer and pnpm (`sudo pacman -S pnpm` on Arch; the repo pins the version in `package.json`).

```sh
pnpm install
pnpm test        # unit and property tests
pnpm test:tz     # the same tests under UTC, Asia/Kolkata and America/New_York
pnpm coverage    # branch coverage, gated at 90% on the recurrence engine
pnpm typecheck
pnpm check       # Biome: lint and format (pnpm check:fix to apply fixes)
```

| Path | What it is |
|---|---|
| `packages/core` | Pure TypeScript shared by every app: the shared types (`src/types.ts`) and the recurrence engine (`src/recurrence/`). No I/O, no clock. |
| `apps/` | The API and the PWA (not yet created). |
| `docs/brainstorm/` | Design documents. Start with `00-overview.md`. |

## Licence

MIT. See `LICENSE`.
