# Task 9 Incident Log Template

Use this template for one controller incident. This is a strict operational record, not a command scratchpad.

## Strict Checklist

- [ ] Maximum events: 32
- [ ] Maximum bytes per note: 4096
- [ ] Run ID:
- [ ] Controller run ID:
- [ ] Generation ID:
- [ ] Monotonic timestamp:
- [ ] Wall timestamp:
- [ ] Mode/state:
- [ ] Exact process identities: controller PID and start identity; secondary renderer PID and start identity; JanVim PID, HWND, start identity, executable SHA-256.
- [ ] Fault/retry/domain:
- [ ] Offline snapshot: external default routes, connected profiles, offline result.
- [ ] Artifact/content/display hashes: artifact lock, core, poem, manifest, display map, and display geometry hashes.
- [ ] Operator action:
- [ ] Recovery result:
- [ ] Media hashes: relative media path, byte size, SHA-256, provenance, and independent backup location.
- [ ] Independent photo/video backup path:
- [ ] SHA-256:
- [ ] Follow-up owner:

Secrets are not recorded. Poem text is not recorded. User config paths are not recorded. Arbitrary shell commands are not recorded. Bridge token is not recorded. Arbitrary command is not recorded. Keyboard injection is not recorded. Title matching is not recorded. User config path is not recorded. Source-repository mutation is not recorded.

## Bounded Event Table

Record at most 32 events. Each Notes cell is at most 4096 UTF-8 bytes; put a concise outcome and the follow-up owner in that cell if no separate event is needed.

| # (1-32) | Monotonic timestamp | Wall timestamp | Run/controller/generation IDs | Mode/state | Exact process identities | Fault/retry/domain | Offline snapshot | Artifact/content/display hashes | Operator action | Recovery result | Media hashes and independent photo/video backup path + SHA-256 | Notes (<=4096 bytes) | Follow-up owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 2 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 3 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 4 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 5 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 6 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 7 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 8 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 9 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 10 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 11 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 12 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 13 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 14 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 15 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 16 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 17 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 18 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 19 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 20 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 21 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 22 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 23 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 24 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 25 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 26 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 27 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 28 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 29 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 30 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 31 |  |  |  |  |  |  |  |  |  |  |  |  |  |
| 32 |  |  |  |  |  |  |  |  |  |  |  |  |  |

Do not embed photos, videos, or other media in Git. Record their independent backup path and SHA-256 above.
