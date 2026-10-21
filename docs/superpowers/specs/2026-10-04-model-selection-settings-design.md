# Settings and model selection — review draft

Status: **local implementation authorized by the latest explicit user direction on 2026-10-04; deployment deferred until the user returns home**. Earlier inspection and proposal text below records the design baseline; it does not claim implementation or verification is already complete.

Source: latest user direction relayed in `Sentinel_c1c93f169e448191a0ae0117482b39ea`, inspected main `c0cf55c678c24bd9bb11378cf5f7e2ada2771027`. This supersedes older UI proposals for this flow. Existing encryption, exact model identity, consent, retention, pricing and retry constraints still apply.

## Intent and confirmed direction

Make setup comfortable for ordinary office workers with some technical curiosity. Preserve MoM's typography, palette and card/button look. The user chose this flow: save an OpenAI/OpenRouter key → **Select models** → modal with **Transcription / Text generation** tabs → concise checkbox rows with name, price, short factual features and meaningful model release date. Exploration remains available through **Additional information**. Remove research-source clutter from normal task screens, while preserving evidence internally and legally required license access.

Recommended initial choices should appear checked in a new setup draft, instead of long recommendation prose. Existing enabled/disabled/default choices must remain authoritative. Recommended checks do not grant meeting transmission consent, provider-policy consent or a paid fallback.

This changes the selection/save boundary: existing checkboxes save independently, whereas a cancelable modal needs a single confirmed batch save. Treat that boundary as an architectural part of the proposal; do not implement only the visual modal and silently keep partial immediate saves.

## Actual rendered evidence

Fresh headed Chrome, isolated synthetic vault, native local WAV preparation, no provider requests, no existing user profile. Current unchanged production build was inspected at these sizes:

| Viewport | OpenRouter card width / height | Gap after connection group | Storage card width / height | Horizontal overflow |
| --- | --- | --- | --- | --- |
| 1440×900 | 1100 / 613px | **0px** | 1100 / 458px | None |
| 768×900 | 501 / 706px | **0px** | 501 / 476px | None |
| 360×800 | 313 / 960px | **0px** | 313 / 536px | None |

All cards have 18px padding. At desktop size, storage values occupy a small part of the 1100px card; raw-byte labels and technical prose dominate otherwise sparse content. The connection group and OpenRouter section share a border edge because the tabpanel is not a stack with a gap. Mobile OpenRouter prose alone exceeds a screen height. This is a spacing and information-density problem, not demonstrated horizontal overflow.

Evidence: `/Users/korgeek/Workspace/mom/.worktrees/mom-full-check-20261004/.superpowers/full-check/settings-layout/` contains six actual screenshots and three metrics JSON files; `settings-layout.receipt.json` records 3 PASS in 5.524 seconds. Root directly viewed 360 connections, 768 connections and 1440 storage captures. These inspection checks are separate from the failed full suite and do not replace it.

## Proposed screens and layout

- Give Settings a scoped content width of at most **960px**, preserving existing main/sidebar layout elsewhere. Use a consistent **18px section gap** and **16px card interior rhythm**. At tablet/mobile widths, keep the current single-column behavior; avoid fixed-width fields. Add a stack/gap to the tabpanel so adjacent sections do not touch.
- Connection cards show service name, saved/error status, key entry/save controls and **Select models**. After saving, keep the field cleared and show a short success message. Connection testing and key-storage explanations belong under Additional information. Keep encrypted persistence as the default; session-only remains available.
- Replace the long standalone OpenRouter recommendation block with the model-selection entry and a brief sentence: **“Transcription sends audio; text generation sends the selected transcript.”** Show the active retention choice concisely. Policy controls/explanations remain reachable and their explicit acknowledgment remains required; simplify wording without changing the saved policy or acknowledging it automatically.
- Modal: maximum width **820px**, maximum height within the viewport, internally scrolling list, fixed header/footer. Below 640px, use a full-width sheet with safe 12–16px insets. Tabs use **음성 전사 / 글 생성** and retain keyboard navigation. Desktop rows show name/price/features/release date; mobile rows stack those fields rather than squeezing a four-column table.
- Footer: **Cancel / Apply**. Cancel/Escape discards only the draft. Apply closes only after a confirmed encrypted save. Visible error plus retained draft on failure. Trap dialog focus, restore the opener when still available, and remove all modal/draft content on lock.
- Storage normal view: **원본 음성 / 전송용 음성 조각 / 미완성 녹음**, human-readable file sizes; group each meeting with its two explicit delete actions. Exact bytes, encrypted payload, site-wide estimates and secure-erasure limitations move to Storage details. Preserve the existing loss explanation, confirmation, cancellation and failure behavior. Keep vault reset separate from selective audio deletion.
- Model source links/IDs/endpoint metadata go under Additional information, not the normal row. Keep license links in Settings app information. External transmission/retention facts remain understandable and visible at actual presend; reducing source clutter cannot hide those facts.

## Model rows and initial choices

Each row uses exact registry identity, not its alias or visual position. Display actual advertised currency **and billing unit**. Audio-minute pricing is valid only when a documented audio-duration rate exists; token-billed audio must retain its real token unit. Do not convert token prices into invented per-minute costs. Unknown rates display **Price unavailable** and never imply free use. Estimated totals and reported actual cost remain separate; OpenRouter component rates do not guarantee a total before dispatch.

Features are short, factual adapter/catalog capabilities. No stars, quality scores, “best accuracy” claims or undocumented timing/language guarantees. Recommendation provenance and dates remain in internal evidence/details.

Initial draft recommendation eligibility means this provider/stage has no saved preference entries/default or prior explicit decision. Eligible exact supported routes may be checked in the draft; **opening or saving a key does not persist them**. Apply records explicitly unchecked recommended entries too, so reopening cannot reselect a rejected recommendation. Existing meetings/defaults are preserved unless the user explicitly chooses a new prospective default.

OpenRouter's implemented STT shortlist currently contains only `openai/gpt-4o-mini-transcribe` and `openai/whisper-large-v3`. Unsupported new rows stay hidden by default; Show all can display **MoM does not support this model yet** with disabled activation. Previously saved blocked rows stay visible and can be turned off. Direct OpenAI text generation is not implemented here; that tab must say so clearly. OpenRouter text activation requires a reviewed, explicitly selected endpoint; never silently pick one or substitute a model.

Version release date comes only from an exact-version owner announcement/model card with source and checked date. **Unknown** remains unknown. OpenRouter `created` is catalog registration, and MoM `checkedAt` is fetch time; neither measures technology age. Date precision is preserved. Store presentation-only evidence separately from the exact encrypted v1 registry schema. Initial small curated coverage may be incomplete; don't delay usability with a fabricated complete date database.

## Ownership and interfaces

| File/area | Responsibility |
| --- | --- |
| `src/react-app/ui/screens/Settings.tsx` | Compact connection entry, key save status, model opener, simple policy/storage copy; preserve key clearing and retention acknowledgment |
| `src/react-app/ui/components/ModelSelectionModal.tsx` (new) | Focus/keyboard/modal lifecycle, provider and stage selection, local draft, cancel/apply/error states |
| `src/react-app/ui/components/ModelManager.tsx` | Reuse registry row projection, discovery and detailed controls; separate compact row presentation from mutation behavior |
| `src/react-app/providers/model-presentation.ts` (new) | Exact-version release/feature presentation evidence with source/date precision, without extending persisted sensitive schema |
| `src/react-app/ui/components/StorageManagement.tsx` | Friendly inventory presentation and sized layout; existing deletion semantics and confirmation remain authoritative |
| `src/react-app/ui/styles.css` | Settings/modal-scoped width, gaps, responsive rows; preserve unrelated screens/styles |
| `src/react-app/App.tsx`, `controller.tsx` | Nonsecret key-save attempt state, modal apply contract, atomic registry save, existing job/lock/metadata fences |
| `providers/model-registry.ts` | Existing normalization, identity, eligibility and preferences; batch composition uses these exact guards |

Proposed nonsecret `onApplyModelSelection({ baseRevision, changes, defaultChanges? }): Promise<void>`: changes reference existing exact route keys and desired enabled state, not arbitrary URLs/endpoints. Revision is an opaque current controller metadata/preference revision, not a new persisted v1 field. Controller rejects stale, unsupported or ownership-invalid submissions; reconstructs changes against current observations, normalizes one next registry and invokes existing `saveRegistry` once. Never loop immediate `onEnabled` saves. Default changes occur only when explicitly present in the draft. Metadata-price acceptance and OpenRouter policy acknowledgment remain explicit, distinct actions; Apply does not manufacture them.

Add nonsecret per-provider save-attempt state (`saving/saved/failed`, attempt revision, safe message). Current `onSaveKey` returns void and a previous saved connection can remain saved while replacement fails; therefore connection status alone cannot prove the latest save succeeded. Save doesn't auto-open the modal or discover models. Existing saved keys may open it with a separate click. OpenAI catalog discovery sends an authenticated request only through an explicit user control and disclosure; OpenRouter public discovery needs no key. Opening/Apply never sends meeting content or initiates inference.

## Acceptance and implementation gate

After this written design is approved, prepare the scoped implementation plan; do not start product changes from this draft alone.

1. Key save success/failure/replacement status is truthful and nonsecret; failed replacement cannot appear as a completed new save. No automatic provider or meeting transmission.
2. Draft cancel/reopen/first recommendation rejection preserves all prior preferences. One successful Apply has one encrypted save; failure preserves saved state and visible draft. Metadata/ownership/lock changes invalidate late work safely.
3. Unsupported/default/disabled/endpoint cases retain exact identity, consent and retry behavior; direct OpenAI text remains visibly unavailable. No silent model/endpoint/policy switch.
4. Prices retain currency/unit, unknown/free distinctions, estimate/actual separation. Release/cutoff/catalog/fetch dates cannot be mislabeled or inferred.
5. Desktop 1440, tablet 768 and mobile 360 render the changed Settings/modal states with measured gaps, no horizontal overflow, keyboard focus restoration and usable touch targets. Include one English state; no unrelated responsive matrix repetition.
6. Storage presentation changes preserve cancel/delete/failure/ownership checks for directly touched deletion controls. Reuse identical existing lower-level safety evidence; do not repeat unchanged model/audio suites.
7. Keep the full-audit failures as historical evidence. Update affected stale fixtures/interactions and run their target checks after implementation; do not conceal failures through changed assertions or label the full product verified.

No real keys, user data deletion, paid inference, license/public-source changes, model adapter expansion, deployment or production readiness claim is part of this design task.
