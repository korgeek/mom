# Luna presets and empty HTTP 401 handling — local verification

Worktree: `/Users/jinik/.codex/worktrees/desktop-lock-countdown/mom`
Branch: `codex/desktop-lock-countdown`, based on `c4076fe6a11d974eeb3c6ceda0fa5f56541927bb`.
No commit, push, deployment, actual API credential entry or paid inference was performed.

## Changes

- `src/react-app/providers/model-profiles.ts`: OpenAI and OpenRouter text presets now use GPT-6 Luna. Stable preset IDs are retained. Existing encrypted user registrations are not automatically rewritten. Existing registrations require selecting the Luna preset, linking the same-provider key and saving in the app.
- Official model IDs: `gpt-6-luna` / `openai/gpt-6-luna`. Output remains 4096 tokens; `reasoning_effort: none` retains the prior preset’s non-reasoning role. The shared prompt/output budget uses the conservative 922000-token input ceiling.
- `src/react-app/providers/registered-runtime.ts`: failed non-JSON responses preserve HTTP error classification. An empty 401 is authentication failure; an invalid successful response remains malformed. No response text is reflected or stored by this change.
- `tests/model-registrations.spec.ts`: two provider-specific Luna request cases.
- `tests/registered-runtime.spec.ts`: empty/non-JSON 401 and non-JSON success cases.

## Targeted checks

No full suite was run. The scope is changed model presets/request construction, registered runtime error classification, and the directly affected model form.

```sh
npx vitest run --config /private/tmp/mom-lock-placement.vitest.config.mts tests/model-registrations.spec.ts tests/registered-runtime.spec.ts tests/model-registrations-ui.spec.tsx --testNamePattern 'GPT-6 Luna preset|classifies a non-JSON response|places provider-labelled presets|adopts the saved shared binding'
npx eslint src/react-app/providers/model-profiles.ts src/react-app/providers/registered-runtime.ts tests/model-registrations.spec.ts tests/registered-runtime.spec.ts
npx tsc -b
git diff --check
```

Result: exit 0; 7 selected tests passed, 48 not selected, 3 test files; lint, type and diff checks passed. New Luna tests failed against the old presets before the change. Empty/non-JSON 401 tests failed with `malformed` before the runtime change.

```sh
node /private/tmp/mom-luna-preset-browser.mjs
```

Result: exit 0. Separate headed Chrome with a new synthetic vault and all external HTTPS blocked. Both provider presets render the correct name, ID and endpoint at 1440x1000; OpenAI preset also checked at 390x844. No page errors, no modal horizontal overflow. Desktop and mobile screenshots visually inspected. The first two browser harness attempts failed during vault initialization / exact label lookup; the final harness waits for the new-vault state and selects the observed combobox label. These were harness changes, not product fixes.

Screenshots: `openrouter-text-1440.png`, `openai-text-1440.png`, `openai-text-390.png`.

## Current user-reported errors

- User reports the OpenAI read-only key check now succeeds after correcting the pasted key. This does not verify model execution.
- The supplied OpenRouter 404 says the sole candidate endpoint was excluded at `Filter by Data Policy` for Zero Data Retention. This is a routing/privacy eligibility error, distinct from the earlier 401.
- The supplied retry modal freezes the original Grok STT model. Existing retry behavior preserves the batch request conditions. Changing another model selection does not make that retry a new route.
- No OpenRouter retention policy or account setting was changed. A request-level opt-out cannot relax ZDR enforced by account policy or a guardrail. No final billing or account-specific inference availability was verified.

## Primary sources

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://openrouter.ai/openai/gpt-6-luna
- https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints
- https://openrouter.ai/blog/insights/zero-data-retention/

Desktop countdown implementation and its separate browser evidence remain in `/private/tmp/mom-lock-countdown/verification.md`. The STT-history redesign is a proposal artifact; it has not been applied to product source.
