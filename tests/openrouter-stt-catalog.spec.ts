import { describe, expect, it } from "vitest";
import type { DiscoveredSTTModel } from "../src/react-app/providers/discovery";
import { lookupRouterSTTProfile, recommendRouterSTT, resolveRouterSTTProfile, routerSTTRateSnapshot } from "../src/react-app/providers/stt-catalog";

const source = "https://openrouter.ai/api/v1/models?output_modalities=transcription";
const checkedAt = "2026-10-03T04:18:04.389Z";
const miniId = "openai/gpt-4o-mini-transcribe";
const whisperId = "openai/whisper-large-v3";
function model(id = miniId, raw: unknown = { prompt: "0.00000125", completion: "0.000005" }): DiscoveredSTTModel {
 return { id, name: id, source, checkedAt, inputModalities: ["audio"], outputModalities: ["transcription"], adapterStatus: "unsupported", pricing: { status: "unknown", raw } };
}
const mini = model();
const whisper = model(whisperId, { prompt: "0.0000075", completion: "0" });
const audioChatOnly = { ...mini, outputModalities: ["text"] };
const aliasOrUnknown = model("~openai/gpt-4o-mini-transcribe");
// IDs/order from the dated 24-model keyless ranked snapshot in the approved design.
// This fixture proves shortlist projection; it does not implement those other models.
const rankedIds = [miniId, "google/gemini-3.5-transcribe", "openai/gpt-4o-transcribe", "mistralai/voxtral-mini-transcribe", "assemblyai/universal-3-5-pro", "deepgram/nova-3", "fish-audio/transcribe-1", "fish-audio/transcribe-1-pro", "google/chirp-3", "meta/muse-voice-transcribe-1.0", "microsoft/mai-transcribe-1.5", "microsoft/mai-transcribe-2", "mistralai/voxtral-mini-3b-2507", "mistralai/voxtral-small-24b-2507-stt", "nvidia/nemotron-3.5-asr-streaming-multilingual-0.6b", "nvidia/parakeet-tdt-0.6b-v3", "openai/gpt-transcribe", "openai/whisper-1", whisperId, "openai/whisper-large-v3-turbo", "qwen/qwen3-asr-0.6b", "qwen/qwen3-asr-1.7b", "qwen/qwen3-asr-flash-2026-02-10", "x-ai/grok-stt-1.0"];
const confirmed24 = rankedIds.map(id => id === miniId ? mini : id === whisperId ? whisper : model(id, null));

describe("exact reviewed OpenRouter STT profile lookup", () => {
 it.each([mini, whisper])("returns the immutable reviewed contract for the exact $id pair", candidate => {
  const profile = resolveRouterSTTProfile(candidate)!;
  const found = lookupRouterSTTProfile(profile.id, candidate.id);
  expect(found).toBe(profile);
  expect(Object.isFrozen(found)).toBe(true); expect(Object.isFrozen(found?.formats)).toBe(true);
 });
 it.each([
  [`openrouter-stt-json:${miniId}`, whisperId],
  [`openrouter-stt-json:${whisperId}`, miniId],
  ["unknown-profile", miniId],
  [`openrouter-stt-json:${miniId}`, "openai/unknown-stt"],
  [`openrouter-stt-json:${miniId}`, `~${miniId}`],
  [`openrouter-stt-json:${miniId}:free`, `${miniId}:free`],
  [`openrouter-stt-json:${miniId}`, `${miniId}:latest`],
 ])("rejects crossed, unknown or alias profile/model pairs %s and %s", (profileId, modelId) => {
  expect(lookupRouterSTTProfile(profileId, modelId)).toBeNull();
 });
});

describe("reviewed OpenRouter STT profiles", () => {
 it("blocks audio chat without transcription output", () => {
  expect(resolveRouterSTTProfile(audioChatOnly)).toBeNull();
 });
 it("blocks a catalog alias even when its modalities match", () => {
  expect(resolveRouterSTTProfile(aliasOrUnknown)).toBeNull();
 });
 it.each(["openai/unknown-stt", `${miniId}:free`, `${miniId}:latest`, "openrouter/auto", "gpt-4o-mini-transcribe", ` ${miniId}`])("blocks unreviewed or inexact identity %s", id => {
  expect(resolveRouterSTTProfile(model(id))).toBeNull();
 });
 it("requires audio input even for a reviewed identity", () => {
  expect(resolveRouterSTTProfile({ ...mini, inputModalities: ["text"] })).toBeNull();
 });
 it.each([mini, whisper])("offers only the reviewed MP3/PCM WAV tuples for $id", candidate => {
  const profile = resolveRouterSTTProfile(candidate);
  expect(profile).toMatchObject({ version: 1, modelId: candidate.id, maxAudioBytes: 16_000_000, maxBodyBytes: 24_000_000, singleLanguageHint: true, checkedAt: "2026-10-03" });
  expect(profile?.formats).toEqual([{ mime: "audio/mpeg", codec: "mp3" }, { mime: "audio/wav", codec: "pcm" }]);
  expect(profile?.source).toContain("https://openrouter.ai/docs/guides/overview/multimodal/stt");
  expect(Object.isFrozen(profile)).toBe(true); expect(Object.isFrozen(profile?.formats[0])).toBe(true);
 });
 it("keeps discovery observations unsupported and unmodified", () => {
  const observed = structuredClone(mini), before = structuredClone(observed);
  resolveRouterSTTProfile(observed); routerSTTRateSnapshot(observed, resolveRouterSTTProfile(observed)!); recommendRouterSTT([observed]);
  expect(observed).toEqual(before); expect(Object.isFrozen(observed)).toBe(false);
 });
});

describe("OpenRouter STT rate snapshots", () => {
 it("retains Mini advertised generic token rates without inventing an audio token count", () => {
  const snapshot = routerSTTRateSnapshot(mini, resolveRouterSTTProfile(mini)!);
  expect(snapshot).toEqual({ source, checkedAt, currency: "USD", rates: [{ unit: "input-token", units: 1, price: 0.00000125 }, { unit: "output-token", units: 1, price: 0.000005 }] });
  expect(Object.isFrozen(snapshot?.rates[0])).toBe(true);
 });
 it("uses Whisper's documented duration basis and the exact catalog rate rather than page rounding", () => {
  expect(routerSTTRateSnapshot(whisper, resolveRouterSTTProfile(whisper)!)).toEqual({ source, checkedAt, currency: "USD", rates: [{ unit: "audio-second", units: 1, price: 0.0000075 }] });
 });
 it("retains an explicitly advertised request dimension", () => {
  const candidate = model(miniId, { prompt: "0.00000125", completion: "0.000005", request: "0.01" });
  expect(routerSTTRateSnapshot(candidate, resolveRouterSTTProfile(candidate)!)?.rates.at(-1)).toEqual({ unit: "request", units: 1, price: 0.01 });
 });
 it("rejects ambiguous conditional pricing", () => {
  const ambiguousPricing = model(miniId, { prompt: "0.00000125", completion: "0.000005", tiers: [{ prompt: "0" }] });
  const supportedProfile = resolveRouterSTTProfile(mini)!;
  expect(routerSTTRateSnapshot(ambiguousPricing, supportedProfile)).toBeNull();
 });
 it.each([null, { prompt: "0" }, { completion: "0" }, { prompt: "-1", completion: "0" }, { prompt: true, completion: "0" }, { prompt: "0x10", completion: "0" }, { prompt: "NaN", completion: "0" }, { prompt: Infinity, completion: "0" }, { prompt: "0", completion: "0", request: null }, { prompt: "0", completion: "0", overrides: { prompt: "1" } }, { prompt: "0", completion: "0", audio: "0" }])("rejects unknown, malformed or incomplete billing metadata %j", raw => {
  expect(routerSTTRateSnapshot(model(miniId, raw), resolveRouterSTTProfile(mini)!)).toBeNull();
 });
 it("does not silently drop Whisper output charges with an unknown unit", () => {
  expect(routerSTTRateSnapshot(model(whisperId, { prompt: "0.0000075", completion: "0.1" }), resolveRouterSTTProfile(whisper)!)).toBeNull();
 });
 it("rejects a mismatched or altered reviewed profile", () => {
  const profile = resolveRouterSTTProfile(mini)!;
  expect(routerSTTRateSnapshot(whisper, profile)).toBeNull();
  expect(routerSTTRateSnapshot(mini, { ...profile, maxAudioBytes: 32_000_000 })).toBeNull();
 });
 it("requires a usable rate source and date", () => {
  const profile = resolveRouterSTTProfile(mini)!;
  expect(routerSTTRateSnapshot({ ...mini, source: "" }, profile)).toBeNull();
  expect(routerSTTRateSnapshot({ ...mini, checkedAt: "invalid" }, profile)).toBeNull();
 });
});

describe("dated OpenRouter STT initial recommendation", () => {
 it("projects Mini from the compatible exact candidates in the 24-model snapshot", () => {
  expect(confirmed24).toHaveLength(24);
  expect(recommendRouterSTT(confirmed24).recommendedId).toBe("openai/gpt-4o-mini-transcribe");
  expect(recommendRouterSTT(confirmed24).freeId).toBeNull();
 });
 it("retains dated weekly-token evidence separately from fresh runtime rates", () => {
  const refreshed = { ...mini, checkedAt: "2026-10-04T00:00:00.000Z" };
  expect(recommendRouterSTT([refreshed])).toEqual({ recommendedId: miniId, freeId: null, source: "https://openrouter.ai/api/v1/models?output_modalities=transcription&sort=most-popular&limit=30", checkedAt });
  expect(routerSTTRateSnapshot(refreshed, resolveRouterSTTProfile(refreshed)!)?.checkedAt).toBe(refreshed.checkedAt);
 });
 it("uses Whisper only as an available reviewed alternative when Mini is absent or incompatible", () => {
  expect(recommendRouterSTT([whisper]).recommendedId).toBe(whisperId);
  expect(recommendRouterSTT([audioChatOnly, whisper]).recommendedId).toBe(whisperId);
  expect(recommendRouterSTT([...confirmed24].reverse()).recommendedId).toBe(miniId);
 });
 it("does not recommend an unavailable, chat-only or unreviewed candidate", () => {
  expect(recommendRouterSTT([]).recommendedId).toBeNull();
  expect(recommendRouterSTT([audioChatOnly, aliasOrUnknown, model("fixture/stt")]).recommendedId).toBeNull();
 });
 it("never turns missing, zero or conditional model rates into a confirmed free route", () => {
  for (const raw of [null, { prompt: "0", completion: "0" }, { prompt: "0", completion: "0", request: "0", tiers: [{ prompt: "1" }] }]) {
   expect(recommendRouterSTT([model(miniId, raw)]).freeId).toBeNull();
  }
 });
});
