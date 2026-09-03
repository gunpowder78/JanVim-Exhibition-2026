# P0 Vim-layout candidate visual receipt

Date: 2026-09-03

## Scope and rollback

This isolated exhibition candidate adds native Neovim absolute logical line numbers and changes
the exhibition viewport margins to `0.0 / 0.0`. It does not implement physical wrapped-column
numbers, independent number font scaling, or cursor-core transparency.

The accepted exhibition fallback remains commit
`14aef7f2af250e6e770b60b8c33ca0ea53364261` and tag
`exhibition-fallback-p0-2026-09-03`. The native-punctuation candidate base remains commit
`b8e882cc395c3f17f82ed4cd2ce161bcf5e85388`. Neither fallback was modified.

## Candidate changes

- `34080ca feat: show compact absolute column numbers`
  - enables Neovim `number` for the exhibition window;
  - disables `relativenumber`;
  - keeps compact `numberwidth=2`;
  - reapplies and verifies the options after prepare and reset.
- `ff5c02b feat: use full viewport for exhibition text`
  - changes the show-only horizontal and vertical margins from `0.08 / 0.12` to `0.0 / 0.0`;
  - preserves the dark theme, semantic colors, column spacing, deterministic write-back, cursor
    effects, and reset behavior.

The operator explicitly accepted Neovim logical line numbering as the intended editor-native
behavior. Wrapped screen columns therefore repeat or omit a visible logical line label according
to Neovim semantics; they are not assigned synthetic physical-column numbers.

## Test-driven evidence

The line-number integration test first failed with `number=false`, then passed after the window
options were applied. The full-viewport runtime test first failed with margin `0.08`, then passed
after both margins were set to zero.

Before the visual run, the candidate passed:

- `npm ci`;
- `npm run typecheck`;
- `npm run lint`;
- `npm test` (`47` files, `810` tests);
- `npm run build`;
- `pwsh -NoProfile -File scripts/run-lua-tests.ps1`;
- `pwsh -NoProfile -File scripts/verify-runtime.ps1`;
- `git diff --check`.

The Electron main bundle remained `451996` bytes with SHA-256
`b351464b7c9ff73c2524135d6b104837386047dbfa2831b0ccd9832d4c28ed94`.

## Frozen JanVim artifact

- tag: `v0.10.1-gmk.4.punctuation.1`;
- commit: `3dddb882e7f54f77b7847a3e65f1acd815b3ea4f`;
- core bytes: `18869248`;
- core SHA-256: `e492c96516439b38bfa204cc3bc5586ba2b303b7250ee9db3564aa65ffbee118`;
- artifact-lock SHA-256:
  `a2f857d8a1dc832c7a02a23ca816fd2e3e6cc21386956bc608f8fe34dbbae3a2`.

No JanVim product source or user Neovim configuration was modified.

## Connected dual-monitor visual rehearsal

- run ID: `layout-vim-show-20260903-033848`;
- evidence root:
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\layout-vim-show-20260903-033848`;
- acceptance scope: `monitor-simulation`;
- physical projectors tested: `false`;
- network policy result: connected diagnostic;
- display-map SHA-256:
  `eed8c655ece41a08413073a28a7fd629562549dc71ad6b341f1d843851cc4738`;
- primary: ID `1502331611`, `1920x1080`, scale `1`, at `0,0`;
- secondary: ID `3192275084`, `1920x1080`, scale `1`, at `776,-1080`;
- content revision: `20260902-songfeng-source-r7`;
- content manifest SHA-256:
  `2890e74e289f629896e5c536c7299718447ca6649c9858ca887995f408fa321f`;
- completed loops: `4`;
- terminal: exit `0`, `intentional-success`, reason `operator-stop`;
- logging incomplete: `false`;
- shutdown: agent acknowledged, window close posted, JanVim exited naturally, bridge closed,
  and lease removed.

Three retained complete-loop records contain the exact original-poem reset SHA-256
`b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`.

## Human visual decision

The operator confirmed:

1. the `0.0 / 0.0` full-viewport layout is appropriate;
2. Neovim logical line numbers should be retained as an intentional programmer-editor trait;
3. long-form numbering, semantic colors, column spacing, and swordsman animation are normal;
4. reset accurately restores the four-line source poem.

Cursor-core transparency is deliberately deferred. Human window 2, covering the offline run and
forced-restart recovery, remains paused and is not claimed by this receipt.
