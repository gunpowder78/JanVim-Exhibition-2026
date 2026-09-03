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

## Deferred cursor-core opacity memo

The operator reviewed the standalone interactive opacity preview and selected `95%` on its
**cursor-core opacity** slider. Because the renderer uses a six-bit opacity field, that preference
would quantize to `60 / 63` (`95.2%`) if a future isolated JanVim candidate implements it.

This value is a reviewed visual preference only. Cursor-core opacity is not changed in the current
JanVim artifact, TOML configuration, exhibition controller, or accepted fallback. The operator
judged its benefit to the current exhibition to be small and explicitly deferred the work to a
possible later candidate. No transparency implementation or artifact rebuild is required for the
current P0 acceptance path.

## Human window 2: offline JanVim recovery acceptance

The operator completed the final dual-monitor simulation window with Wi-Fi, Ethernet, and
external VPN/TUN routing disconnected:

- ValidateOnly run ID: `layout-window2-20260903-044259-validate`;
- Show run ID: `layout-window2-20260903-044259-fault`;
- evidence root:
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\layout-window2-20260903-044259-fault`;
- display-map SHA-256:
  `eed8c655ece41a08413073a28a7fd629562549dc71ad6b341f1d843851cc4738`;
- content revision: `20260902-songfeng-source-r7`;
- content manifest SHA-256:
  `2890e74e289f629896e5c536c7299718447ca6649c9858ca887995f408fa321f`;
- offline samples: `9`; online samples: `0`; `offlineVerified: true`;
- one exact JanVim-domain recovery: generation `2`, attempt `1`, bounded delay `1000 ms`,
  outcome `recovered`, reason `session-recovered`;
- completed loops: `7`, with the retained three recovery-generation loops each recording the
  exact original-poem reset SHA-256
  `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`;
- aggregate outcome: `pass`; total retries: `0`; total recoveries: `1`;
- terminal: `intentional-success`, reason `operator-stop`;
- no controller incident and `loggingIncomplete: false`;
- shutdown: agent acknowledged, window close posted, JanVim exited naturally, bridge closed, and
  lease removed.

The operator confirmed that the JanVim primary rebuilt automatically after the deliberate fault,
the secondary remained safe, the source poem was restored, at least two fresh loops completed,
and Stop Show ended the rehearsal normally. All requested human observations passed.

After evidence inspection, the selector restored the byte-exact `p0-baseline` manifest with
SHA-256 `9a39ee522e556860053468854b0858bc1fafd8b7a1ca08ddff57d0371b717b35`.
This closes the scheduled dual-monitor P0 acceptance for this candidate. Physical-projector G4
remains a separate hardware-layer rehearsal and is not claimed here.

## Display-only solid punctuation checkpoint

The exhibition display layer maps the frozen Chinese punctuation to one-cell display glyphs
without changing the source buffer:

- `，；：？！、` use their ASCII display forms;
- `。` uses the solid bullet `•`;
- every replacement uses the window-local vermilion `Conceal` highlight `#B74133`;
- the source bytes, command acknowledgements, and reset SHA-256 remain unchanged.

The change followed a red-green TDD cycle. The Lua test first failed because the active window had
`conceallevel=0`; it then passed with the exact one-cell replacements before and after reset. The
candidate subsequently passed typecheck, lint, all `47` Vitest files and `810` tests, the production
build, Lua tests, frozen-runtime verification, and `git diff --check`. The Electron main bundle
remained byte-identical at `451996` bytes with SHA-256
`b351464b7c9ff73c2524135d6b104837386047dbfa2831b0ccd9832d4c28ed94`.

Connected visual rehearsal evidence:

- run ID: `punct-bullet-visual-20260903-155146-show`;
- evidence root:
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\punct-bullet-visual-20260903-155146-show`;
- completed loops: `3`;
- terminal: `intentional-success`, reason `operator-stop`;
- logging incomplete: `false`;
- all retained loops record the exact source-poem reset SHA-256
  `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`.

The operator accepted this state as runnable and confirmed that the solid punctuation direction is
correct. The operator also requested a later isolated JanVim candidate in which the punctuation
rendering box is `0.50` relative to the ideograph box `1.0`. This checkpoint remains the rollback
state while that renderer candidate is evaluated; the frozen JanVim artifact itself is unchanged.

## Native half-cell punctuation candidate follow-up

The requested `1.0` ideograph / `0.50` punctuation ink-box ratio was implemented in an isolated
JanVim product worktree. The renderer's orthogonal-punctuation ink scale changed from `0.25` to
`0.50`; cell advance, line layout, source text, conceal mappings, semantic colors, and all
non-punctuation glyph rendering remain unchanged. This keeps the product change to one rendering
constant plus its specifications and deterministic geometry assertions.

JanVim product identity:

- tag: `v0.10.1-gmk.4.punctuation.2`;
- commit: `abbd5a5b942b202e7fe4324bcd3ddab47c672cb9`;
- packaged archive bytes: `31347917`;
- packaged archive SHA-256:
  `b033524f615c7c5389a85fc45039e8a910ce1171d2eed36658d3ba26d8e75ff6`;
- core bytes: `18869248`;
- core SHA-256: `3fc76259677185c619db2a76e302b9588df0bdd3e58600ed30a5ea08b4194f54`;
- build root:
  `D:\VirtualData\JanVim-Exhibition-Builds\gmk4-punctuation-halfcell-20260903-abbd5a5`.

The packaged executable completed a real-window identity smoke and reported the exact candidate
commit. On final product source, `cargo fmt --all -- --check`, serial
`cargo test --workspace --all-targets`, `cargo clippy --workspace --all-targets --all-features --
-D warnings`, `cargo xtask guard-deps`, and `git diff --check` all passed.

The exhibition runtime was then prepared from that immutable package. Its new
`janvim-artifact.lock.json` is `1629` bytes with SHA-256
`9cb5f25c91d8fd7186465de0f90e6ddde8b4a54fadee431d907992a797e54a7c`. Active launcher,
validation, evidence, recovery, and runbook identities now require the exact new tag, commit, core
size, core hash, and lock hash. Six focused identity/runtime/recovery test files passed all `187`
tests after the migration.

The final exhibition verification passed `npm ci`, typecheck, lint, all `47` Vitest files and
`810` tests, the production build, all Lua tests, frozen-runtime verification, and
`git diff --check`. The first full Vitest invocation encountered one external Windows `EPERM`
while replacing a lease file in the shared system temporary directory. The unchanged test passed
in isolation and the complete `810`-test suite then passed without code or timeout changes under a
fresh external test-temporary root. The compiled Electron main bundle is `451996` bytes with
SHA-256 `bc60718dd52323259c397057265245042b4ea1823609cff3958568ceafd36c55`.

Connected half-cell visual rehearsal evidence:

- ValidateOnly run ID: `punct-halfcell-visual-20260903-181855-validate`, exit `0`;
- Show run ID: `punct-halfcell-visual-20260903-181855-show`;
- evidence root:
  `D:\VirtualData\JanVim-Exhibition-Rehearsals\punct-halfcell-visual-20260903-181855-show`;
- network policy: connected diagnostic, so the machine acceptance outcome is intentionally
  `diagnostic` rather than an offline pass;
- artifact tag/commit/core SHA-256 exactly match the candidate identity above;
- completed loops: `3`;
- terminal: `intentional-success`, reason `operator-stop`;
- no controller incident, `loggingIncomplete: false`, and the run lease was removed;
- all three loop records contain the exact source-poem reset SHA-256
  `b699de273f5bbaedb08241495f52ce863d3e8e1851275ce3b6251484d75190a8`.

The operator confirmed that the `1.0 / 0.50` ideograph-to-punctuation rendering ratio is visually
perfect and that the existing colors, spacing, continuous writing, cursor animation, and reset
behavior remain correct. The selector then restored the byte-exact `p0-baseline` manifest.

This accepts the renderer's visual result. Commit `2222d5a` and tag
`exhibition-fallback-p0-solid-punctuation-2026-09-03` remain the byte-addressable rollback state,
and the earlier accepted P0 fallback tag also remains unchanged. An offline forced-restart run of
this exact `.punctuation.2` artifact remains a separate operational acceptance step; this connected
visual rehearsal does not claim it.
