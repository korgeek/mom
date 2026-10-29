import type { MeetingProject, MinutesComparison, MinutesSettings, RunState, TranscriptVersion } from "../domain/types";
import { freezeMetadata } from "../providers/catalog";
import type { RouterSelection } from "../providers/openrouter";
import { minutesInputSignature } from "./generate";
import { buildMinutesMessages, MINUTES_PROMPT_VERSION } from "./prompt";
import { previewMinutesSelection, previewRegisteredMinutesSelection, selectionConsentSnapshot } from "./selection";
import type { MinutesSelectionPreview } from "./selection";
import { defaultRegistrationOutputTokens, freezeExecutionModel, registrationEndpoint, type ModelRegistration } from '../providers/model-registrations';
import { supportsMinutesReasoning } from './reasoning';

export type MinutesChoice = RouterSelection | Readonly<{ registration: ModelRegistration }>;
export type ComparisonChoices = readonly [MinutesChoice | null, MinutesChoice | null];
export function minutesChoiceModelId(choice: MinutesChoice): string { return 'registration' in choice ? choice.registration.modelId : choice.model.id; }
export function minutesChoiceSnapshot(choice: MinutesChoice, outputTokens: number, reasoningReserveTokens = 0): unknown {
 return 'registration' in choice ? { registration: freezeExecutionModel(choice.registration), outputTokens, reasoningReserveTokens } : selectionConsentSnapshot(choice.model, choice.endpoint, outputTokens, reasoningReserveTokens);
}
export type MinutesComparisonPreview = Readonly<{
 status: MinutesSelectionPreview["status"] | "duplicate" | "unresolved";
 outputTokens: number | null; members: readonly [MinutesSelectionPreview, MinutesSelectionPreview];
 combinedTotal: number | null; unknownTotal: boolean;
}>;
export function previewComparison(options: Readonly<{ transcript: TranscriptVersion | null; settings: MinutesSettings; choices: ComparisonChoices; outputTokens?: number; messages?: readonly import("./prompt").MinutesMessage[] }>): MinutesComparisonPreview {
 const { transcript, settings, choices } = options;
 const caps = choices.flatMap(choice => choice && 'registration' in choice ? [defaultRegistrationOutputTokens(choice.registration) ?? null] : [choice?.model.maxOutputTokens ?? null, choice?.endpoint.maxOutputTokens ?? null]);
 const outputTokens = options.outputTokens ?? settings.outputTokens ?? (caps.every(cap => cap !== null) ? Math.min(4096, ...(caps as number[])) : null);
 let messages: ReturnType<typeof buildMinutesMessages> | null = null;
 try { if (transcript) messages = options.messages ?? buildMinutesMessages(transcript, settings); } catch { /* Invalid input blocks dispatch below. */ }
 const members = choices.map(choice => choice && 'registration' in choice ? previewRegisteredMinutesSelection(choice.registration, transcript, { ...settings, ...(outputTokens !== null ? {outputTokens} : {}), modelId: choice.registration.modelId, registrationId: choice.registration.id }, options.messages) : previewMinutesSelection({ model: choice?.model ?? null, endpoint: choice?.endpoint ?? null, messages, outputTokens, reasoningReserveTokens: 0 })) as unknown as MinutesComparisonPreview["members"];
 const duplicate = choices[0] && choices[1] && minutesChoiceModelId(choices[0]) === minutesChoiceModelId(choices[1]);
 const invalidEffort = settings.reasoningEffort !== undefined && choices.some(choice => !choice || !('registration' in choice) || !supportsMinutesReasoning(choice.registration, settings.reasoningEffort));
 const status = duplicate ? "duplicate" : invalidEffort ? 'invalid-input' : members.find(member => member.status !== "fits")?.status ?? "fits";
 const unknownTotal = members.some(member => member.projection.total === null);
 return freezeMetadata({ status, outputTokens, members, unknownTotal, combinedTotal: unknownTotal ? null : members[0].projection.total! + members[1].projection.total! });
}
export async function freezeMinutesComparison(projectId: string, transcript: TranscriptVersion, settings: MinutesSettings, choices: readonly [MinutesChoice, MinutesChoice], outputTokens: number): Promise<MinutesComparison> {
 const input = structuredClone(transcript); const output = structuredClone(settings);
 if (previewComparison({ transcript: input, settings: output, choices, outputTokens }).status !== "fits") throw new Error("Both comparison members must fit before consent");
 const inputSignature = await minutesInputSignature(input, output);
 const members = choices.map(choice => 'registration' in choice ? { modelId: choice.registration.modelId, endpointTag: registrationEndpoint(choice.registration), providerName: new URL(registrationEndpoint(choice.registration)).host, modelSnapshot: freezeExecutionModel(choice.registration), selectionSnapshot: minutesChoiceSnapshot(choice, outputTokens), attempts: [] } : { modelId: choice.model.id, endpointTag: choice.endpoint.tag, providerName: choice.endpoint.providerName, selectionSnapshot: selectionConsentSnapshot(choice.model, choice.endpoint, outputTokens, 0), attempts: [] }) as unknown as MinutesComparison["members"];
 return freezeMetadata({ id: crypto.randomUUID(), projectId, createdAt: new Date().toISOString(), transcript: input, settings: output, messages: buildMinutesMessages(input, output), inputSignature, promptVersion: MINUTES_PROMPT_VERSION, outputTokens, reasoningReserveTokens: 0, members });
}
/** Frozen input and current immutable metadata; fresh comparisons exclude only random ID/time. */
export async function comparisonConsentToken(record: MinutesComparison, choices: readonly [MinutesChoice, MinutesChoice], metadataRevision: number, retryMember: 0 | 1 | null): Promise<string> {
 const payload = [record.projectId, retryMember === null ? null : record.id, record.inputSignature, record.promptVersion, record.transcript, record.settings, record.messages, record.outputTokens, record.reasoningReserveTokens,
  record.members.map(member => [member.modelId, member.endpointTag, member.attempts]), choices.map(choice => minutesChoiceSnapshot(choice, record.outputTokens, record.reasoningReserveTokens)), metadataRevision, retryMember];
 const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(payload)));
 return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
/** Run state is authoritative after vault recovery; a revision alone is not a saved receipt. */
export function comparisonMemberState(project: MeetingProject, record: MinutesComparison, index: 0 | 1): RunState {
 const attempts = record.members[index].attempts; const attempt = attempts[attempts.length - 1];
 if (!attempt) return "queued";
 const run = project.runs.find(run => run.id === attempt.runId);
 if (run?.state === "saved" && (!attempt.revisionId || !project.minutesRevisions.some(revision => revision.id === attempt.revisionId && revision.runId === attempt.runId))) return "outcome-unknown";
 return run?.state ?? "outcome-unknown";
}
