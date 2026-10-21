import type { JobContext, MinutesComparison, MinutesRequest, MinutesRevision, MinutesRun, MinutesSettings, TranscriptVersion } from "../domain/types";
import { buildMinutesMessages, MINUTES_PROMPT_VERSION } from "./prompt";

export type PartialAcknowledgement = Readonly<{ transcriptVersionId: string; snapshotSignature: string; acknowledgedAt: string }>;
export type GeneratedMinutesRun = MinutesRun & Readonly<{ promptVersion: string; inputSignature: string; partialAcknowledgement: PartialAcknowledgement | null }>;
export type MinutesGeneratorOptions<T extends MinutesRun = MinutesRun> = Readonly<{
 provider: { generate(request: MinutesRequest, job: JobContext): Promise<T> };
 preflight?: (request: MinutesRequest, job: JobContext) => unknown | Promise<unknown>;
 frozenInput?: Pick<MinutesComparison, 'promptVersion' | 'inputSignature'>;
}>;

function immutable<T>(value: T): T {
 if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
  Object.freeze(value); for (const child of Object.values(value)) immutable(child);
 }
 return value;
}
function canonical(value: unknown): string {
 if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
 if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
 if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Minutes input must contain finite JSON values");
 const encoded = JSON.stringify(value);
 if (encoded === undefined) throw new Error("Minutes input must contain JSON values");
 return encoded;
}
async function signature(value: unknown): Promise<string> {
 if (!crypto.subtle) throw new Error("Minutes input hashing requires Web Crypto");
 const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
 return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export function minutesInputSignature(transcript: TranscriptVersion, settings: MinutesSettings): Promise<string> {
 const input = structuredClone(transcript); const output = structuredClone(settings);
 return signature({ promptVersion: MINUTES_PROMPT_VERSION, transcript: input, settings: output, messages: buildMinutesMessages(input, output) });
}
export async function isMinutesRunStale(run: GeneratedMinutesRun, transcript: TranscriptVersion, settings: MinutesSettings): Promise<boolean> {
 return run.promptVersion !== MINUTES_PROMPT_VERSION || run.inputSignature !== await minutesInputSignature(transcript, settings);
}
/** Call only for an explicit user acknowledgement action, never automatically. */
export async function acknowledgePartialTranscript(transcript: TranscriptVersion): Promise<PartialAcknowledgement> {
 const input = structuredClone(transcript);
 if (!input.missingRanges.length) throw new Error("This transcript does not need partial acknowledgement");
 return Object.freeze({ transcriptVersionId: input.id, snapshotSignature: await signature(input), acknowledgedAt: new Date().toISOString() });
}
function partialWarning(transcript: TranscriptVersion): string {
 const missing = transcript.missingRanges.map(([start, end]) => `${start}–${end} ms`).join(", ");
 return `> ⚠️ Incomplete transcript. These minutes cover available speech only. Missing source ranges: ${missing}.\n\n`;
}

/** A user-triggered call; provider/catalog preflight must reject unknown/overflow limits. */
export function createMinutesGenerator<T extends MinutesRun>(options: MinutesGeneratorOptions<T>) {
 return Object.freeze({
  async generateMinutes(transcript: TranscriptVersion, settings: MinutesSettings, job: JobContext, partialAck?: PartialAcknowledgement): Promise<T & GeneratedMinutesRun> {
   job.assertActive();
   const input = immutable(structuredClone(transcript)); const output = immutable(structuredClone(settings));
   const acknowledgement = partialAck ? immutable(structuredClone(partialAck)) : null;
   buildMinutesMessages(input, output, acknowledgement ?? undefined);
   const partial = input.missingRanges.length > 0;
   if (partial && !acknowledgement) throw new Error("Explicit partial transcript acknowledgement is required");
   if (acknowledgement && (acknowledgement.transcriptVersionId !== input.id || acknowledgement.snapshotSignature !== await signature(input) || !Number.isFinite(Date.parse(acknowledgement.acknowledgedAt)))) throw new Error("Partial transcript acknowledgement is stale or invalid");
   job.assertActive(); const inputSignature = options.frozenInput?.inputSignature ?? await minutesInputSignature(input, output); job.assertActive();
   const request: MinutesRequest = Object.freeze({ transcript: input, settings: output, runId: crypto.randomUUID() });
   await options.preflight?.(request, job); job.assertActive();
   const run = await options.provider.generate(request, job); job.assertActive();
   if (run.id !== request.runId || run.transcriptVersionId !== input.id || run.requestedModel !== output.modelId || canonical(run.settings) !== canonical(output)) throw new Error("Minutes provider input/model mismatch");
   if (typeof run.generatedMarkdown !== "string" || !run.generatedMarkdown.trim()) throw new Error("Minutes provider returned empty output");
   // Preserve provider subtypes including raw successful response and requestedEndpoint.
   return immutable(structuredClone({ ...run, generatedMarkdown: (partial ? partialWarning(input) : "") + run.generatedMarkdown,
    promptVersion: options.frozenInput?.promptVersion ?? MINUTES_PROMPT_VERSION, inputSignature, partialAcknowledgement: acknowledgement }));
  },
 });
}

export function reviseMinutes(run: MinutesRun, markdown: string, parentRevision?: MinutesRevision): MinutesRevision {
 if (parentRevision && parentRevision.runId !== run.id) throw new Error("Parent revision belongs to another minutes run");
 return Object.freeze({ id: crypto.randomUUID(), runId: run.id, parentId: parentRevision?.id ?? null, markdown });
}
