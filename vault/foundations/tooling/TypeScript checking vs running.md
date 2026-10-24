# TypeScript: checking vs running

> **Builds on:** [[TypeScript essentials]] (the language itself). This note is about the tools: who checks the types, and how the code runs with them removed.

TypeScript is JavaScript plus **type annotations** (`date: ISODate`, `function f(x: number): string`). Two separate jobs happen to TypeScript code:

1. **Checking.** The TypeScript compiler, `tsc` (version 7, written in Go, so it's fast), reads every file and reports mistakes: passing a number where a string is expected, forgetting a case, reading a property that might be `undefined`. Think of it as a spell-checker for logic. We run it as `pnpm typecheck`, which runs `tsc --noEmit`: check, but don't write any output files.
2. **Running.** Computers run JavaScript, not TypeScript. To run `.ts` code, something **strips** the type annotations, leaving plain JavaScript. Vitest does that for tests, Vite does it for the web app, and Node 24 can do it itself.

Stripping never checks anything, so a file full of type errors still runs. That's why `typecheck` is its own step, and why CI will refuse a PR that fails it.

You can see both jobs side by side in the API's scripts:

*From `apps/api/package.json` (shortened):*
```json
    "start": "node --env-file-if-exists=../../.env src/main.ts",
    // …
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
```

`start` hands a `.ts` file straight to `node`, which strips the types and runs it: no build step, no `.js` files. `typecheck` runs `tsc` to *check* the same files and write nothing. `test` lets Vitest strip them its own way. Of the three, only `typecheck` would notice a type error.

## Our settings (`tsconfig.base.json`)

Every package extends this one file, so the rules are the same everywhere.

| Setting | What it does |
|---|---|
| `strict` | Turns on the important checks, above all: `null` and `undefined` must be handled before use |
| `noUncheckedIndexedAccess` | `arr[3]` has type `T \| undefined`, because the array might be shorter. Forces you to handle "not there" |
| `noUnusedLocals`, `noUnusedParameters` | Dead variables are errors |
| `noEmit` | `tsc` only checks; it never writes `.js` files |
| `erasableSyntaxOnly` | Bans the few TypeScript features that aren't just annotations (`enum`, `namespace`). What's left can be stripped by deleting text, which is what Node does |
| `verbatimModuleSyntax` | Type-only imports must say `import type`, so the stripper knows to delete them |
| `module`/`moduleResolution: nodenext` | Resolve imports exactly the way Node does |
| `allowImportingTsExtensions` | Imports name the real file: `import ... from './dates.ts'`. Node requires the extension |
| `lib: ["es2024"]`, `types: []` | Only standard JavaScript is known. No browser `window`, no Node `process`, and no global `Temporal`. If someone forgets to import `Temporal` from the polyfill, it's a type error |

Here's the file itself, so you can match each row to its line:

*From `tsconfig.base.json` (shortened):*
```json
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,

    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    // …
  }
```

A package's own `tsconfig.json` is then tiny: `packages/core/tsconfig.json` is just `"extends": "../../tsconfig.base.json"` plus which folders to check. The API and the web app add only what they need on top: Node's types (`"types": ["node"]`, for `process`) in the API, and the browser's (`"dom"`, for `document`) in the web app.

## ES modules

`"type": "module"` in `package.json` means files use `import`/`export` (ES modules), the standard since 2015. The older Node style was `require()`/`module.exports` (CommonJS). New code should use ES modules.

## The `core` package exports source

`packages/core/package.json` says `"exports": { ".": "./src/index.ts" }`. Other packages import the TypeScript source directly, and their own tool strips it. There's no build step for `core`, and no `dist/` folder to keep in sync. The trade-off is in [[Tooling choices]].

## Check yourself
- A file has a type error. Does `pnpm test` fail? Does `pnpm typecheck`? Why are they different?
- With `noUncheckedIndexedAccess`, what is the type of `dates[0]` when `dates` is `string[]`? What do you have to write before using it as a string?
- Why would an `enum` break Node's "strip the types and run" approach, when `type Weekday = 'MO' | 'TU'` doesn't?
