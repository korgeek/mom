# Color and spoken-language settings implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement the approved editable color and spoken-language lists, encrypted persistence, JSON import/export and a copyable AI editing prompt; finish with the latest explicitly authorized commit and deployment.

**Architecture:** A small pure settings module owns defaults, normalization and JSON boundaries. The existing encrypted Catalog stores optional section overrides and retains accepted writes through lock finalization. Settings edits those lists; Import consumes them without rewriting meeting selections.

**Tech Stack:** Existing React/TypeScript, Web Crypto, IndexedDB, Vitest and headed Playwright Chrome; no new dependencies.

**Spec:** [Approved design](../specs/2026-10-17-color-language-settings-design.md).

## Global constraints

- Initial approval was local-only. The later 2026-10-17 clarification explicitly authorizes commit and deployment; preserve the earlier commits and include them in the verified release.
- Reuse the current checkout and installed tools; avoid an extra approval or review chain. Run only changed/affected tests, never the full suite.
- Custom SVG registration, editable translations, provider transports and encoding are outside scope. Existing built-in icons remain selectable.
- JSON limit 256 KiB; each list 1–64 entries; color `#RRGGBB`; language code ≤64 characters and name 1–80 Unicode characters, no control characters.
- Lock clears sensitive UI immediately, retains accepted writes privately for retry, and fences late public responses.

## Review focus

- Imported extra fields, duplicate normalized values, invalid encoding and oversized files must never change saved settings (Task 1).
- Accepted changes immediately followed by lock or quota failure must survive retry without exposing unlocked UI (Task 2).
- Concurrent project/registry writes must preserve list overrides and list writes must preserve their Catalog entries (Task 2).
- Removed list entries must leave existing meeting color and selected language codes/order intact (Task 3).
- Late file reads and clipboard failures must not restore locked previews or report false success (Tasks 3–4).

## Task 1: Pure lists and import/export boundary

Files: create `src/react-app/settings/lists.ts`, `tests/settings-lists.spec.ts`; move default list ownership out of `ui/copy.ts` without duplicating defaults.

Interfaces: `SelectionLists { colors: readonly string[]; languages: readonly {code:string;name:string}[] }`, optional `SelectionListOverrides {version:1;colors?;languages?}`, `defaultSelectionLists`, `normalizeSelectionLists(unknown)`, `normalizeListOverrides(unknown)`, `selectionListOverrides(SelectionLists)`, `resolveSelectionLists(overrides)`, `parseSelectionLists(Uint8Array)`, `exportSelectionLists(SelectionLists)`, `selectionListsPrompt(SelectionLists, 'ko'|'en')`.

- [x] Write normalization/duplicate/limit/import UTF-8/unknown-field/export-only-allowed-fields tests; run `npx vitest run tests/settings-lists.spec.ts` and observe missing implementation failure.
- [x] Implement pure schema validation, default section override comparison, bounded parsing and allowlisted export/prompt generation; rerun the same tests to PASS.

## Task 2: Encrypted persistence and controller

Files: `vault/store.ts`, `vault/session.ts`, `controller.tsx`, `App.tsx`; create `tests/settings-lists-persistence.spec.ts` and `tests/settings-lists-controller.spec.ts`.

Interfaces: session/coordinator `loadSelectionLists(job): Promise<SelectionLists>` and `saveSelectionLists(lists, job): Promise<void>`; AppController optional `selectionLists`, `onSaveSelectionLists(lists): Promise<void>`; integration controller `saveSelectionLists(lists): Promise<void>`.

- [x] Test absence/defaults, encrypted reload, mutation detachment, project/registry preservation, quota failure, immediate lock admission, retry and ownership fencing; observe RED.
- [x] Add an optional Catalog field validated on read; retain accepted overrides in coordinator until the encrypted transaction commits, and flush them through private finalize. Restore lists before exposing their editing callback, clear them on lock, and update UI only after a current save receipt. Rerun focused tests to PASS.
- [x] Commit the complete pure boundary and persistence unit after affected checks pass.

## Task 3: Settings editor and Import selection

Files: create `ui/components/SelectionListSettings.tsx`; modify `ui/screens/Settings.tsx`, `ui/screens/Import.tsx`, `ui/styles.css`; create `tests/selection-list-settings-ui.spec.tsx`; update affected existing UI assertions and responsive tab count.

- [x] Test row edit/add/delete/reset, rejected save retains draft, import preview/cancel/atomic apply, unknown/oversized file rejection, current saved export and prompt, and retained legacy selections; observe RED.
- [x] Implement one `색상 · 언어 / Colors & languages` tab, accessible form rows, section reset, bounded file input and preview, current-list download/prompt copy with actual success/failure feedback. Use local component lifecycle fencing for late reads/saves.
- [x] Replace Import's custom-code field with a Settings link; combine configured choices with current selected legacy values without modifying project data. Rerun focused UI tests to PASS.

## Task 4: Browser evidence and finish

Files: create `tests/e2e/selection-lists.spec.ts`; update design/decision status and save exact commands/results to `docs/superpowers/evidence/2026-10-17-selection-lists/README.md`.

- [x] Build and scan artifacts; run changed test type checks, then only the new headed Chrome E2E at ko/en × 360×800/1440×900 with synthetic vaults and blocked external requests. Exercise add/edit/delete/reset/import cancel/apply/export/prompt, reload/lock and retained existing selections. Inspect captured layouts.
- [x] Review the complete diff, validate documentation links and unchanged reference hashes, record limits and existing build warnings, then leave the remaining finished changes for the final local commit. The final commit and clean HEAD/status are recorded in the executor ledger; no push/deployment.

## User clarification: preparation choices and deployment

The latest request supersedes local-only delivery. Keep the existing theme/palette and interface-language controls. Colors are the custom memo-title icon colors used on Import; spoken languages are display-name/code pairs. Keep the nine built-in icons selectable on Import, show their fixed set in Settings, and keep SVG registration excluded. Rename the list tab to Audio preparation and make the destination of each setting explicit.

- [x] Update Settings labels, built-in icon/color previews and the Import management link; retain the existing data/import/export schema.
- [x] Verify changed UI, actual icon/color application and unchanged appearance controls in targeted unit and headed Chrome cases. Reuse prior storage/parser evidence for unchanged code.
- [x] Commit, push main under the latest explicit authorization, and smoke-check the deployed feature. Product commit `68f5531`: Workers Builds success; live Chrome at 1492×1103 shows matching built assets, preserved appearance controls, the preparation list settings and its Import link. Follow-up evidence-only commit records the result.
