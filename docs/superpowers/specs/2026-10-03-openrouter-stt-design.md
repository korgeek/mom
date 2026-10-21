# OpenRouter STT — implementation design

2026-10-03 · Written design approved by the user; implementation-plan review is next. Baseline: `f5ad6bd3b52148991f5601ab4e86f230ebf3425c`. No product code, live credentials or paid inference is part of this design work.

## Intent and approved boundaries

The user requests OpenRouter transcription and continued MoM work, with OpenRouter-only configuration possible. Keep direct OpenAI transcription available. Browser-local preparation, encrypted persistence, immutable raw/version history, explicit paid requests and lock/ownership checkpoints remain the architecture. Add no MoM account, audio proxy, server storage, provider-key handling outside the vault or automatic model switch.

The user reports microphone recording worked on Galaxy Tab. This is user evidence; the latest report does not name the browser and does not establish every device or end-to-end AI quality.

The user's latest priority is a small working set, rather than more model choices. Explain privacy in beginner language: saved meeting material/keys are encrypted in this browser; starting STT sends audio, while creating Minutes sends the selected transcript and writing instructions to the chosen AI service. Future context is transmitted only when explicitly included. No MoM meeting-data backend does not mean no external transmission. Retention/training depends on service policies and selected settings; OpenRouter may choose a different downstream processor. Do not promise no training from local encryption or from an unchecked request setting.

## Confirmed API facts and limits

- The [official STT guide](https://openrouter.ai/docs/guides/overview/multimodal/stt) documents `/api/v1/audio/transcriptions`, JSON audio input and multipart, normalized `json`/`verbose_json` responses, optional single-language hints and provider-specific capabilities. This implementation uses JSON with inline audio, not URLs.
- Crucially, STT ignores `provider.only/order/ignore`; its processing provider cannot be pinned like the existing Minutes endpoint. Only documented STT policy/options fields may be sent. The app must not claim a provider lock or control of OpenRouter's internal routing/retries.
- The [models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties) supports STT discovery with `output_modalities=transcription`. A keyless GET at 2026-10-03T03:46Z returned 24 records, 23,323 bytes, SHA-256 `ef3eccef56cc657e7704998b2f5d91eabfd39b9d588b0d9dd6ffe161b67f2191`. This is advertised availability, not inference permission or tested quality.
- The same bounded probe returned OPTIONS 204 and allowed POST, Authorization and Content-Type from the app origin. This is an HTTP preflight observation, not a native/authenticated POST pass. No key or audio was transmitted.
- [OpenRouter collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [downstream logging/retention](https://openrouter.ai/docs/guides/privacy/provider-logging) are separate policies. Local encryption does not control either. Do not read/change the user's account privacy settings or claim all providers retain no data.
- Documented limits/options and actual inference acceptance are distinct. Provider format support, timing, speakers, optional usage and processing time can differ. A successful-looking fixture never certifies them.

## Request, capability and pricing design

Use a separate STT catalog/profiles adapter. Require explicit `audio` input plus `transcription` output, an exact non-alias model ID, a supported profile and user enablement. Audio-capable chat models do not qualify. Other discovered models remain visible but blocked when their required profile/format is unknown.

Initial profile targets are `openai/whisper-large-v3` and `openai/gpt-4o-mini-transcribe` for basic JSON; all optional verbose/timestamp/diarization/vocabulary features stay off. Before enabling a profile, record its documented model/format contract and source/check date; unsupported or unconfirmed tuples remain blocked. The first local formats are encoded MP3 and PCM WAV, not every format named by the service.

Send one already prepared chunk per request. Enforce a local ceiling of 16,000,000 encoded audio bytes and 24,000,000 UTF-8 JSON-body bytes, or a smaller documented profile/provider limit. These are conservative app ceilings, not promises of server acceptance. Bound base64/body memory to one chunk; release it after transport. Preserve 10/15-minute preparation choices and measured chunk bytes. Reject oversized input with explicit re-preparation guidance; do not silently split, truncate or re-encode during a paid run.

Use `response_format: json`, omit optional provider-specific fields and omit the ignored generic `prompt`. One validated ISO language may be sent when the profile supports it; multiple expected languages use autodetection and remain recorded as expectations, with the applied hint shown separately. Do not silently select the first language or discard mixed speech.

Normalize text with chunk-level source ranges by default. Validate any actually returned structured time/speaker data before using it; preserve the original response. Never synthesize word times or cross-chunk speaker identity. Preserve response-header/body model/provider/generation identifiers only when returned; otherwise show unknown. Do not infer the actual provider from the model namespace.

Preserve raw rate metadata and its source/check time. Do not infer a duration/token billing unit from `pricing.prompt` alone or copy direct-OpenAI prices to OpenRouter. Display unavailable/conditional estimates honestly. The STT guide documents `usage.cost` in USD; store that as provider-reported USD, separately from estimates, seconds and token counters. Keep the existing Minutes credit/cost interpretation intact.

## Dynamic provider disclosure and consent

Settings exposes OpenRouter STT as a separate capability with policy explanation and an initially unchecked enable/acknowledgment. It does not require an OpenAI key. Merely discovering or saving a key never enables a model or authorizes an audio request.

The default request policy is `data_collection: deny` and required ZDR. The user may explicitly select standard retention instead, after reading its disclosure; never relax ZDR automatically when no route is available. This changes request parameters only, not account settings. Display the selected policy and link the service/provider policy sources.

Before every initial batch, retry or rerun, show browser → OpenRouter → dynamically selected processing provider, the exact model, policy, chunks/bytes, applied language behavior and available/unknown cost. State that downstream identity can change and may be unknown until the response. Both settings acknowledgment and fresh presend consent are required, initially unchecked. The existing generic “no intermediate server” text must distinguish no MoM server from OpenRouter's forwarding role.

Consent binds a versioned immutable snapshot of connection/route, exact model, catalog/profile fingerprint, request policy, audio-source/chunk identities and bytes, applied/expected languages, billing metadata and disclosure version. Any relevant change invalidates it. No automatic model/provider substitution or additional client-side paid attempt is allowed. MoM cannot promise that service-internal routing retries are disabled.

## Batch, persistence and ownership contracts

Keep the existing registry route identity with `provider: openrouter`, `stage: stt`, exact model and `endpointTag: null` for managed STT. Add a versioned managed-routing selection snapshot alongside the batch, rather than pretending it is a pinned Minutes endpoint. Legacy OpenAI batches without this snapshot remain readable and retain their original checks.

The existing queue, paid-request gate, cooldown, job epoch and owner-only encrypted-save path remain in charge. Dispatch the chosen adapter/key by the frozen route; an OpenRouter-only setup must never ask for an OpenAI key. Freeze raw input/output, rate/policy/request provenance and batch attempt links. Save completed work before scheduling the next chunk.

Retries use the original batch snapshot, explicit extra-charge acknowledgment and existing outcome-unknown rules. Changed or unavailable capabilities/policy block retry instead of switching routes. Rerunning successful chunks creates a new batch/version and preserves previous results. Cancellation/lock stops new requests and rejects late results by epoch; transport cancellation does not undo remote work or charges. Storage failure retains the existing blocked/pending semantics and prevents another paid request.

## Ownership and proportional verification

| Increment | Ownership | Required focused checks |
| --- | --- | --- |
| Catalog + transport | New `providers/openrouter-stt.ts` and `providers/stt-catalog.ts`; explicit STT discovery/profile observations; new focused fixtures | Exact modality/profile/ID guards, byte/body limits, JSON and policy fields, no ineffective pin fields, response/error/usage normalization, one request and abort/timeout behavior |
| Shared contracts + orchestration | Parent-owned `domain/types.ts`, `domain/pipeline.ts`, `transcript/batches.ts`, registry/discovery consumers and `controller.tsx` | Legacy OpenAI behavior preserved; OR-only setup; frozen consent/retry/rerun provenance; checkpoint failure, lock/late response, ownership and no next paid request |
| UI | Existing Settings/STT/ModelManager locations and KO/EN copy | Both acknowledgments, policy changes invalidate consent, dynamic/unknown-provider and cost disclosure, disabled unsupported profiles; relevant keyboard and responsive states |

Use failing targeted tests first, then the smallest affected adapter/registry/batch/controller/UI cases. Retain directly affected security/data-loss coverage. Reuse unchanged media/crypto/playback/source proofs; do not run full suites. Build/types/scoped lint/artifact gates remain proportionate. Use one combined independent review of this increment, without adding another mandatory review chain.

An isolated feature worktree starts from verified current integration. Commits are meaningful; main push waits for a coherent tested feature and the parent release gate. One keyless fixture hosted smoke covers this changed flow after deployment. Authenticated native CORS, paid inference and speech quality remain user handoff, with clear unverified labels. No server fallback or weakened browser security on failure.

## Subsequent scope and review handoff

### Initial defaults — additional user decision, 2026-10-03

The user approved this design and requested well-known and well-known free transcription defaults. A keyless [official ranked transcription catalog](https://openrouter.ai/api/v1/models?output_modalities=transcription&sort=most-popular&limit=30) at 2026-10-03T04:18:04Z returned 24 records, 23,323 bytes, SHA-256 `5202c06d54ba7349337bb04a9897a708907f8f34dda9a2548cf2e0c12f772ff1`. The [documented sorting method](https://openrouter.ai/docs/guides/overview/models) is weekly token usage, not quality, user count or audio-duration popularity.

`openai/gpt-4o-mini-transcribe` was first and `openai/whisper-large-v3` nineteenth in this snapshot. Recommend the former for a new, empty setup and retain the latter as an explicit alternative, subject to fresh compatible catalog/profile checks. Recommendation does not enable a route, grant consent or send audio. Apply an initial default only during the user's explicit first enable/default action in a new setup; preserve every existing choice, disabled route and explicitly cleared default. A saved key or refresh must not write defaults.

No `:free` or zero prompt/completion-priced candidate appeared in those 24 records. No free STT default is currently confirmed. Display that absence; do not substitute a free text/chat model or silently choose a paid model when free was requested. Missing or conditional billing dimensions cannot establish free use.

The [Mini model page](https://openrouter.ai/openai/gpt-4o-mini-transcribe) advertises $1.25/M input and $5/M output tokens; the [Whisper page](https://openrouter.ai/openai/whisper-large-v3) rounds its starting rate to $0.000008/second, while this catalog reports `pricing.prompt: 0.0000075`. Retain raw catalog rates and source/date; show advertised pricing separately from an uncertain preflight total and provider-reported actual USD. Do not infer audio token counts from file bytes or apply one model's billing unit to another.

The generic model-page FAQ suggests provider pinning, but the endpoint-specific STT guide explicitly says `only/order/ignore` are ignored. This plan follows the approved managed-routing contract and records this source conflict; it does not promise pinning or route-price guarantees.

After STT, propose the smallest meeting-local company/domain context and terminology fields, encrypted and optionally included in Minutes with consent/budget/signature updates. Then propose named reusable writing instructions with explicit apply/edit/delete. Neither permits arbitrary replacement of fixed grounding/system rules. Their detailed design remains separate from this STT increment.

Whole-app/source-available license, public metadata/history, password/PIN/device-security policy and actual credentials are not blanket-approved by the continuation request. Waveform/optional normalization remain later ideas; denoise remains excluded.

The user approved the managed-routing/privacy/profile contract. Review the implementation plan before product changes. The previously selected Sol Extra High implementer and independent reviewer workflow remains the intended execution method; preserve the parent's current Max setting. No feature is claimed complete at this design stage.
