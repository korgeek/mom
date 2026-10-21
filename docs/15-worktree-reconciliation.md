# MoM local worktree reconciliation — 2026-10-04

Status: local integration completed; **no push, deployment, worktree deletion or product fix**. This record does not change the failed full-test gate or approve the new model-selection design.

## Original workspace and commits

Original workspace: `/Users/korgeek/Workspace/mom`, branch `main`. The deployed baseline remains `c0cf55c678c24bd9bb11378cf5f7e2ada2771027`.

- Original main had two template commits and no common ancestor with the deployed history. Both histories are retained by a normal merge; no reset or force action was used.
- `archive/mom-root-before-reconciliation-20261004` preserves original `102086a86c59efbe35014ad532e4ce823b26821f`.
- `e25663e2d45d23494cf24bc4fb4a9006fb546bc1`: preserved 26 existing AGENTS/document/reference files, including the expressly unapproved UX design draft.
- `5340941f8d8818fb0e947cc1fa11351642c43531`: merged exact deployed baseline into original main. Parents are the document-preservation commit and c0cf55c.
- `ef52038822ffc7559109e746a0965c4c600631db`: local WIP commit in `fix/mom-m4a`, preserving its existing 11-addition/7-deletion README draft. It is not merged into main.

The add/add conflicts were only README.md and wrangler.json. The original README was `# mom`; the original Worker path pointed at absent template code and enabled observability/source maps. Current root uses the already reviewed/deployed README and assets-only configuration. Prior versions remain in the original history and `/tmp/mom-root-preservation-20261004`.

## Inventory and retention

Registered workspaces: original root + **29 linked worktrees**. A scoped hidden-file scan found the same 29 `.git` markers; no additional manual checkout was found under this repository. All 30 registered source/index states were clean after local integration and draft preservation. Ignored dependencies, builds, reports and browser traces remain local.

Local owner check found no Git/Node writer using a MoM worktree; only the Python execution host held the root as cwd. The model-modal design helper is completed. This observation does not replace the parent controller’s cross-chat ownership coordination. No active worker files were overwritten or processes stopped.

Every linked worktree below is intentionally retained: deletion was outside this request. Paths are under `/Users/korgeek/Workspace/mom/.worktrees/`. The JSON inventory with full branch/SHA/status is saved locally in `.superpowers/reconciliation-20261004/inventory.json`.

| Worktree | HEAD | Reason retained |
| --- | --- | --- |
| `mom-catalog-fix` | `0f86eecc53fbef909cf92ef8150ea7aeac8fbf14` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-contracts` | `2b2aef6077b3480b03b9db87b4827ceac190a31f` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-copy` | `63b31d57d062dcaf25fe656161baa6efd855c7d2` | Branding handoff retained; revised integration is 9bd3962 in deployed history. Do not reapply the original branch. |
| `mom-discovery` | `6281d63318f7e616a103faefb57fb212fd323ebc` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-full-check-20261004` | `c0cf55c678c24bd9bb11378cf5f7e2ada2771027` | Exact deployed baseline; retain canonical/release/full-inspection evidence. New source work should use the original root. |
| `mom-implementation` | `cf939d4ae397445adee922e0f0503a4e9a43daad` | Historical implementation/license-preparation history; released as the reviewed 716fc5f tree. Preserve original commits and evidence; do not replay older code. |
| `mom-m4a` | `ef52038822ffc7559109e746a0965c4c600631db` | Code already released; pending README preserved as explicit WIP ef52038822ffc7559109e746a0965c4c600631db. Historical/duplicated text is not applied over the current README. |
| `mom-minutes-defaults` | `81251d655b03eb057613c0cbd24b9bba4428b8fb` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-model-manager-ui` | `e7cbc2a501b02e07566d06f5c89a773a29660861` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-model-shortlist` | `ef0b467fce64485357ea6b59fbcf4a9dd13f5c0b` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-models` | `c0cf55c678c24bd9bb11378cf5f7e2ada2771027` | Exact deployed baseline; retain canonical/release/full-inspection evidence. New source work should use the original root. |
| `mom-openrouter-stt` | `c0cf55c678c24bd9bb11378cf5f7e2ada2771027` | Exact deployed baseline; retain canonical/release/full-inspection evidence. New source work should use the original root. |
| `mom-playback` | `79e9f283bd6b27060f87e7931d64180055a9647e` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-preparation` | `7e83119b3490af7f7d0fdb0cb27bc4f06479b1e4` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-recording-compat` | `e34953c6dd2e18809add80f838c23f5916ac4dd4` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-recording-core` | `31e35453357297fae89a12e86ecf4705927eb34f` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-recording-ui` | `4dfde0be86a155865e4f04ddbd4575abbe538122` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-release` | `13c7cffb8a9c9110f986d507db4e05509c2a2428` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-responsive` | `3693dcd9d91fcc4e8ce3a64a08f756a4ca38b7bb` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-retained-source` | `b5f98bc316e5bfc9fc4582f7d71f6c116bd26c38` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-source` | `b932c1818994f4cc17d746aee5cb91eb9420d359` | Earlier retained-source handoff; reviewed integration is 10d5720 with later boundary fixes. Retain for provenance. |
| `mom-source-bridge` | `10d5720090c03be59e12373e8211295652533ce6` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-source-consumer` | `321d3d696150ccf542d06327ac51167984d473ca` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-source-writer-current` | `7719a38679d3f84ff1ef5974e3d40863a1b68d5b` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-storage-cleanup` | `1b9991f66c6e107a83cbbf3303758f3f462cc7c9` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-storage-ui` | `f2eb121d82e3dac3bc97a660c511e9d113c85ff7` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-stt-reruns` | `dfece9aae57966e10fd0f0c62ae9e98e961fe4b2` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-vault-reset` | `d04516a59f8530031881c8eff52432c85c12fb2c` | Already included in deployed history; retain historical branch and verification evidence. |
| `mom-writer` | `39c73654fd9e8f6a444bab1cb65f204c18e5ed03` | Earlier source-writer/reader handoff; reviewed integration is 7719a38 with later recording changes. Retain for provenance. |

Earlier handoff patches were revised/reintegrated and are not all patch-ID identical. They were not blindly cherry-picked or marked as new missing features. Their committed originals remain addressable. The integration adds no new product behavior beyond c0cf55c.

## Integration-affected verification

- `npm ci --offline --no-audit --no-fund`: installed 329 locked packages into a real root node_modules directory, using the existing cache and no network. npm blocked eight package install scripts under its existing policy; no policy approval/change was made. The subsequent real build succeeded.
- `npm run build`: PASS, exit 0, 9.003 seconds; includes app type checking. Existing mixed Worker import and large bundle warnings remain.
- `npm run test:secret`: PASS, exit 0, 0.179 seconds. This scans the public source/static/client-artifact scope; it is not a claim that private references/history are cleared for publication.
- All **239 deployed tracked files** in the original root are byte-identical to c0cf55c. Existing 26 AGENTS/reference/document files are byte-identical to their pre-integration preservation manifest.
- Rebuilt client inventory: **78 files compared**; client bytes match. Only generated Wrangler `.configPath` and `.userConfigPath` differ because the workspace moved.
- Markdown-it parsed the root README, AGENTS and documentation: 21 files / 114 existing local file links / 0 missing targets before this report. External links and heading anchors were not re-researched.
- `git diff --check` on the clean workspace passed. Integration-diff whitespace checks retained the supplied HTML originals; their two existing trailing-space lines were not rewritten. Four existing generated Wrangler type whitespace lines were also kept unchanged, as proved by deployed-file identity.

Commands, logs, identity assertions and link results are kept in `.superpowers/reconciliation-20261004/`. Build/location checks were performed; no unrelated unit, audio, model or full browser suites were repeated.

## Preserved failures and pending work

The prior full inspection is **still FAILED**: 1,406 unit assertions, 1,279 passed / 127 failed plus one unhandled rejection; 55 native browser cases, 20 passed / 35 failed. Ten initial symlink/WASM collection errors were resolved for the audit, without hiding the assertion failures. Original 35 browser failures stop at old setup/disclosure/shortlist assumptions; their target flows remain unverified by that run.

174 existing audit files were copied byte-for-byte into original `.superpowers/full-check-20261004/` while retaining the source audit worktree. The copied full report, JSON, logs, traces and six Settings captures remain ignored and are not committed or published. The reproduction harness contains historical absolute worktree paths; do not treat it as a new root test configuration.

- The model-selection/settings UX file is a **review draft only**, not implemented: [design draft](superpowers/specs/2026-10-04-model-selection-settings-design.md).
- The historical M4A README WIP is preserved separately. Its overlapping older capability/portfolio-license prose is not authoritative over the current README and later user decisions.
- Authenticated AI, paid billing, real recordings/microphone quality and comprehensive product/security/format validation remain unverified. No actual credentials or user vault were used.
- Private supplied references/planning were intentionally omitted from the prior released source tree. This reconciliation records them in **local** Git history only. A later push/public-history action needs its own scope check; no visibility, whole-app license or source-distribution decision is made here.

Remaining conflict requiring coordination: **none in the working tree**. Remaining decisions concern the already pending UX design and publication/license scope. Worktree retirement can be considered separately after the parent confirms owners/evidence retention; no deletion was performed.
