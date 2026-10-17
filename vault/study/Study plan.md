# Study plan

**Decided 2026-10-09:** Claude writes all the code. You study it through this vault and the code itself. (This replaces the earlier hand-write plan from 2026-10-07.)

## How each feature arrives

1. Claude writes the code and its tests.
2. In the same change, Claude adds vault notes:
   - a **module note**: what the code does, which files, how data flows through it
   - a **decision note** for any real choice: the alternatives and why they lost
   - a **concept note** the first time an idea appears (transactions, idempotency, indexes…)
3. Every note ends with **Check yourself** questions.

## How to study without writing code

Reading alone feels like understanding more than it is. These habits close the gap, and none of them need you to write the app:

- **Predict first.** Before opening a note or file, write two lines: "how would I build this?" Then compare.
- **Answer Check yourself in writing,** without looking. Wrong or blank answers show what to reread.
- **Trace one request** through the real code with a debugger or `console.log`, from route to database and back.
- **Break it.** Change one line, run the tests, explain why they fail.
- **Ask.** Any "why is this here?" is a good question. Bring it to a session.

## Open

- Self-rating (TypeScript, HTTP, SQL, Git, Linux): after the web dev course. See [[Course map]].
