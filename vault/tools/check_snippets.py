#!/usr/bin/env python3
"""Checks that the code excerpts in the vault still match the code.

A code block in a note is an *excerpt* when it names its source file, in either of two ways:

    *From `apps/api/src/app.ts`:*          <- a caption line right above the block
    ```ts
    app.use(requestContext(logger));
    ```

    ```ts
    // apps/api/src/app.ts                 <- or a line that is only a comment with the path
    app.use(requestContext(logger));
    ```

A path comment can also appear in the middle of a block: the lines after it come from that file.

For every excerpt line, the code must still appear in the file (spaces at the ends ignored).
These lines are skipped, so notes can cut and annotate freely:
- empty lines and any line containing `…` (a cut, or a shortened line);
- lines that are only a comment (`// …`, `# …`, `-- …`, `/* … */`, `{/* … */}`);
and a comment added at the end of a code line (`x = 1; // why`) is ignored when matching.
Code blocks with no source are illustrations and aren't checked. Mermaid blocks are ignored.

Usage, from the repo root:
    python3 vault/tools/check_snippets.py                    # every note, against this checkout
    python3 vault/tools/check_snippets.py --root ../other    # against another checkout of the repo
    python3 vault/tools/check_snippets.py "app/Auth.md"      # some notes (paths inside the vault)
Exit status 1 if any excerpt has drifted. Run it after a milestone, and fix what it lists.
"""
import argparse
import pathlib
import re
import sys

VAULT = pathlib.Path(__file__).resolve().parent.parent
CAPTION = re.compile(r"^\*From `([^`]+)`[^*]*\*\s*$")
SOURCE = r"((?:apps|packages|deploy|fixtures|\.github)/[\w./$@-]*\w|Dockerfile|compose\.yaml|biome\.json|package\.json|pnpm-workspace\.yaml|tsconfig\.base\.json|\.gitignore|\.dockerignore)"
# The path may be followed by a note: "// apps/web/src/lib/queries.ts: the caller…" or "(shortened)".
PATH_COMMENT = re.compile(r"^\s*(?://|#|--)\s*" + SOURCE + r"\s*(?:[:(—].*)?$")
FENCE = re.compile(r"^(\s*)```(\S*)")
WHOLE_COMMENT = re.compile(r"^\s*(//|#(?!!)|--|/\*|\*|\{/\*)")
TRAILING_COMMENT = re.compile(r"\s+(//|#|--)\s.*$")


def excerpts(text: str):
    """Yields (line number, [(source, code line), ...]) for every excerpt in a note."""
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        m = FENCE.match(lines[i])
        if not m:
            i += 1
            continue
        lang, indent = m.group(2), len(m.group(1))
        j = i + 1
        while j < len(lines) and not lines[j].lstrip().startswith("```"):
            j += 1
        body = [b[indent:] if b[:indent].strip() == "" else b for b in lines[i + 1 : j]]
        if lang != "mermaid":
            k = i - 1
            while k >= 0 and lines[k].strip() == "":
                k -= 1
            caption = CAPTION.match(lines[k].strip()) if k >= 0 else None
            source = caption.group(1) if caption else None
            pairs = []
            for line in body:
                switch = PATH_COMMENT.match(line)
                if switch:
                    source = switch.group(1)
                elif source:
                    pairs.append((source, line))
            if pairs or (caption and not body):
                yield i + 1, pairs
        i = j + 1


def checkable(line: str) -> str | None:
    """The code part of an excerpt line to look for, or None to skip the line."""
    s = line.strip()
    if s == "" or "…" in s or WHOLE_COMMENT.match(s):
        return None
    return s


def matches(code_line: str, file_lines: set[str]) -> bool:
    if code_line in file_lines:
        return True
    without = TRAILING_COMMENT.sub("", code_line).rstrip()
    return without in file_lines or any(f.startswith(without) for f in file_lines if without)


def check(note: pathlib.Path, root: pathlib.Path) -> tuple[int, list[str]]:
    problems, count = [], 0
    cache: dict[str, set[str] | None] = {}
    for line_no, pairs in excerpts(note.read_text()):
        count += 1
        missing, absent = [], set()
        for source, line in pairs:
            if source not in cache:
                path = root / source
                cache[source] = {l.strip() for l in path.read_text().split("\n")} if path.is_file() else None
            if cache[source] is None:
                absent.add(source)
                continue
            code = checkable(line)
            if code is not None and not matches(code, cache[source]):
                missing.append((source, code))
        where = f"{note.relative_to(VAULT)}:{line_no}"
        for source in sorted(absent):
            problems.append(f"{where}: {source} doesn't exist")
        if missing:
            shown = "; ".join(code for _, code in missing[:3])
            problems.append(f"{where}: {len(missing)} line(s) not found in {missing[0][0]}: {shown}")
    return count, problems


def main() -> int:
    parser = argparse.ArgumentParser(description="Check vault code excerpts against the code.")
    parser.add_argument("notes", nargs="*", help="notes to check, as paths inside the vault")
    parser.add_argument("--root", default=str(VAULT.parent), help="the checkout to compare against")
    args = parser.parse_args()
    root = pathlib.Path(args.root).resolve()
    notes = [VAULT / n for n in args.notes] or sorted(VAULT.rglob("*.md"))
    total, problems = 0, []
    for note in notes:
        count, found = check(note, root)
        total += count
        problems += found
    for p in problems:
        print(p)
    print(f"{total} excerpts checked against {root}, {len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
