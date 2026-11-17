# PULSEGRID

One tap changes everything. A colour-pulse logic puzzle: tapping a square moves it and its orthogonal neighbours one colour
along (dark → cyan → magenta → dark). Match every square to its target.

- `index.html` is the whole game (engine inlined). `engine.js` is the same engine for the tests.
- Every level is built backwards from its solved board, so it is always solvable; par is the proven minimum from a GF(3) solver.
- 100 levels (3×3 to 6×6, blocked squares from level 30), a Daily Pulse with streaks, stars, hints, undo, sound, local saves.
- Tests: `npm i jsdom && node tests/pulsegrid.test.js index.html`
