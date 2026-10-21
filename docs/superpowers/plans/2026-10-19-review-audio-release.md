# STT review, source preview and memo cleanup release

User approval: 2026-10-19, apply every change discussed in this chat and deploy; prominently state the project's existing license in README. The selected design is `왼쪽 요약` in the reviewed STT layout. This approval supersedes the historical documentation-only phase; it does not authorize actual provider credential access, paid inference or privacy-policy relaxation.

## Constraints

- Keep direct browser-to-provider requests and encrypted browser persistence; no relay, meeting backend or new dependencies.
- Preserve source time mappings, raw responses, original batches, selected/edited transcript and notes versions.
- Unknown costs remain unknown; do not combine currencies or imply intent records prove billing.
- Reuse selected passing evidence for unchanged code/environment; run only directly affected checks, no full suite.
- Use isolated synthetic vaults and files. Never access the real user vault, keys or meeting audio.
- Keep supplied reference originals unchanged. Existing license terms and third-party rights remain unchanged.
- Main push triggers Workers Builds; push only after the complete feature is verified, avoid duplicate CLI deployment, verify actual served assets and changed flows.

## Tasks

- [x] Desktop lock countdown above sidebar lock button; mobile placement retained.
- [x] OpenAI/OpenRouter text presets use GPT-6 Luna; empty/non-JSON HTTP 401 remains an authentication error.
- [x] Integrate existing user license commit preserving both histories; keep current README structure and license terms, add prominent top license link.
- [x] STT chunk result modal before re-transcribe, full transcript review/edit modal near progress; remove long inline review.
- [x] Left compact usage summary below transmission check, organized usage/request-history modal with full evidence drilldown.
- [x] Retry original frozen model by default; changing model creates separate batch for selected chunks with fresh consent, preserving old results and charges.
- [x] Automatically restore retained source preview, actual bounded waveform extraction and click/drag/keyboard seeking. Stop and fence work on lock, navigation and deletion; preserve fresh File preview without reselect.
- [x] Expose memo deletion in the active memo header using existing confirmed delete, purge all owned file generations/records and only that memo's editor drafts, stop/release playback, preserve other memos and global key/model settings.
- [x] Classify OpenRouter's structured data-policy rejection with clear generic guidance; do not change ZDR.
- [x] Run scoped unit/controller/UI/media tests, build/type/changed lint/artifact scan, visible local Chrome scenarios at desktop and phone widths.
- [x] Review integrated diff and address material findings. Commit coherent features and evidence; fast-forward primary only if safe, push main, wait for exact-SHA Workers Build, smoke changed features on the production origin.

## File ownership during implementation

- Audio task: media peak/preview pipeline, source-preview component/CSS, Import and controller preview integration; parent integrates AppController types and deletion cleanup.
- STT task: STT/Review/Usage UI and affected tests; controller startSTT already supports a new batch when original batchId is omitted.
- Deletion task: deletion component, active header in App, targeted screen-state pruning and vault atomic deletion; parent integrates controller cleanup after audio work.
- Parent: license/README integration, policy error handling, documentation/evidence, final integration/browser/build/release.

## Review focus

- Model change invalidates consent and never mutates/relabels the original batch or re-sends successful unrelated chunks.
- Review dialogs retain original immutable response and selected/edited versions, accurate missing/overlap information, lock redaction and focus restoration.
- Real source samples generate the waveform; bounded readers and PCM batches avoid whole-file PCM retention, late responses never restore locked/deleted content.
- Large retained source reconstruction has an explicit compressed-Blob budget; fresh File playback is preserved, preparation remains available.
- Deleted memo drafts, old audio generations and queued writes cannot resurrect the memo; failed atomic deletion retains prior durable records.
- Summaries retain partial coverage, exact currency and requested-versus-returned provider identity; missing evidence is never zero.

## Verification inventory

Derive final commands from actual changed files and affected callers. Selected existing evidence for countdown, Luna/401 and synthetic deletion is under `/private/tmp/mom-lock-countdown/`, `/private/tmp/mom-luna-check/` and `/private/tmp/mom-delete-check.md`. New task reports are under `/private/tmp/mom-*-report.md`. Final durable release evidence will record exact commands, results, actual viewports, deployment SHA/version and limits.

Release outcome: main auto-deploy passed; IAB renders of changed setup/usage/deletion confirmation passed. Hosted Chrome/file upload and full served-byte comparison were blocked before their functional assertions; see release evidence. Authenticated inference remains unverified.
