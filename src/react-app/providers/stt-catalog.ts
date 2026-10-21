import { asObject } from "../domain/pipeline";
import type { RateSnapshot, RouterSTTProfile } from "../domain/types";
import { freezeMetadata } from "./catalog";
import type { DiscoveredSTTModel } from "./discovery";

export type { RouterSTTProfile } from "../domain/types";

const sttGuide = "https://openrouter.ai/docs/guides/overview/multimodal/stt";
const miniId = "openai/gpt-4o-mini-transcribe";
const whisperId = "openai/whisper-large-v3";
const profileCheckedAt = "2026-10-03";
const profiles: readonly RouterSTTProfile[] = freezeMetadata([miniId, whisperId].map(modelId => ({
 id: `openrouter-stt-json:${modelId}`, version: 1 as const, modelId,
 formats: [{ mime: "audio/mpeg", codec: "mp3" }, { mime: "audio/wav", codec: "pcm" }],
 // Conservative app ceilings, not evidence of provider acceptance.
 maxAudioBytes: 16_000_000, maxBodyBytes: 24_000_000, singleLanguageHint: true,
 source: `${sttGuide}, https://openrouter.ai/${modelId}${modelId === miniId ? ", https://developers.openai.com/api/docs/guides/speech-to-text" : ""}`,
 checkedAt: profileCheckedAt,
})));

/** Local documented contract only; this does not establish discovery or inference. */
export function lookupRouterSTTProfile(profileId: string, modelId: string): RouterSTTProfile | null {
 return profiles.find(profile => profile.id === profileId && profile.modelId === modelId) ?? null;
}

/** Compatibility only: an exact reviewed identity plus dedicated STT modalities. */
export function resolveRouterSTTProfile(model: DiscoveredSTTModel): RouterSTTProfile | null {
 if (!model.inputModalities.includes("audio") || !model.outputModalities.includes("transcription")) return null;
 return profiles.find(profile => profile.modelId === model.id) ?? null;
}

function reviewedProfile(model: DiscoveredSTTModel, profile: RouterSTTProfile): boolean {
 const reviewed = resolveRouterSTTProfile(model);
 return !!reviewed && profile.id === reviewed.id && profile.version === reviewed.version && profile.modelId === reviewed.modelId
  && profile.maxAudioBytes === reviewed.maxAudioBytes && profile.maxBodyBytes === reviewed.maxBodyBytes
  && profile.singleLanguageHint === reviewed.singleLanguageHint && profile.source === reviewed.source && profile.checkedAt === reviewed.checkedAt
  && profile.formats.length === reviewed.formats.length
  && profile.formats.every((format, index) => format.mime === reviewed.formats[index].mime && format.codec === reviewed.formats[index].codec);
}

function rate(value: unknown): number | null {
 if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(value.trim()))) return null;
 const number = Number(value);
 return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Advertised dimensions only. Missing fees/counters leave preflight totals unknown. */
export function routerSTTRateSnapshot(model: DiscoveredSTTModel, profile: RouterSTTProfile): RateSnapshot | null {
 if (!reviewedProfile(model, profile) || !model.source.trim() || /[\r\n]/u.test(model.source)
  || !Number.isFinite(Date.parse(model.checkedAt)) || new Date(model.checkedAt).toISOString() !== model.checkedAt) return null;
 const raw = asObject(model.pricing.raw);
 if (!raw || Object.keys(raw).some(key => !["prompt", "completion", "request", "tiers", "overrides"].includes(key))) return null;
 for (const key of ["tiers", "overrides"]) {
  if (raw[key] !== undefined && (!Array.isArray(raw[key]) || raw[key].length > 0)) return null;
 }
 const prompt = rate(raw.prompt), completion = rate(raw.completion);
 const request = raw.request === undefined ? null : rate(raw.request);
 if (prompt === null || completion === null || raw.request !== undefined && request === null) return null;
 let rates: RateSnapshot["rates"][number][];
 if (profile.modelId === whisperId) {
  // Whisper's model page + STT guide document per-second input billing.
  // A nonzero completion rate has no reviewed duration/token basis.
  if (completion !== 0) return null;
  rates = [{ unit: "audio-second", units: 1, price: prompt }];
 } else {
  // OpenRouter advertises generic input/output tokens for Mini. File bytes
  // cannot establish token counts or a fixed downstream provider price.
  rates = [{ unit: "input-token", units: 1, price: prompt }, { unit: "output-token", units: 1, price: completion }];
 }
 if (request !== null) rates.push({ unit: "request", units: 1, price: request });
 return freezeMetadata({ source: model.source, checkedAt: model.checkedAt, currency: "USD", rates });
}

/** Dated weekly-token popularity; never changes registry, defaults or enablement. */
export function recommendRouterSTT(models: readonly DiscoveredSTTModel[]): Readonly<{ recommendedId: string | null; freeId: string | null; source: string; checkedAt: string }> {
 const recommendedId = [miniId, whisperId].find(id => models.some(model => model.id === id && resolveRouterSTTProfile(model))) ?? null;
 return freezeMetadata({
  recommendedId,
  // No free STT candidate was confirmed in this 24-model public snapshot.
  freeId: null,
  source: "https://openrouter.ai/api/v1/models?output_modalities=transcription&sort=most-popular&limit=30",
  checkedAt: "2026-10-03T04:18:04.389Z",
 });
}
