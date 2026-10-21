// IDs are opaque; source times are integer milliseconds; execution times are UTC ISO strings.
// These JSON project contracts never contain provider keys or Authorization headers.
import type { ModelRegistration } from '../providers/model-registrations';
export type ModelExecutionSnapshot = Readonly<Omit<ModelRegistration, 'lastTest'>>;
export type SourceAsset = Readonly<{
	id: string; fileName: string; bytes: number; container: string; codec: string;
	durationMs: number; channels: number; sampleRateHz: number;
}>;

export type TranscriptionHints = Readonly<{ terms: readonly string[]; context: string }>;

export type AudioOptions = Readonly<{
	chunkMinutes: 5 | 10 | 15; overlapSeconds: 5 | 10 | 15; expectedLanguages: readonly string[];
	bitrateKbps: number; sampleRateHz: number; transcriptionHints?: TranscriptionHints;
}>;

export type PreparedChunk = Readonly<{
	id: string; sourceId: string; index: number; sourceStartMs: number; sourceEndMs: number;
	// Remove verified encoder delay exactly once before adding sourceStartMs.
	encodingOffsetMs: number;
	encodedBytes: number; mimeType: string; codec: string; audioRecordId: string;
}>;

export type SourceSegment = Readonly<{
	id: string; text: string; sourceStartMs: number; sourceEndMs: number; rawIds: readonly string[];
	speaker?: string | number;
}>;

export type TranscriptionExecution = Readonly<{
	requestedModel: string; returnedModel: string | null; actualProvider: string | null;
	expectedLanguages: readonly string[]; usage: Usage;
}>;

export type RawTranscript = Readonly<{
	id: string; chunkId: string; runId: string; response: unknown; text: string;
	segments: readonly SourceSegment[]; timing: "word" | "segment" | "chunk"; speakerScope: "none" | "chunk";
	// Actual provider adapters always fill this; null is for legacy/import/test data.
	execution: TranscriptionExecution | null;
	// Only documented identifiers actually returned by the provider; absent on legacy records.
	responseMetadata?: Readonly<{ generationId: string | null; returnedModel: string | null; actualProvider: string | null }>;
}>;

export type BoundaryIssue = Readonly<{
	id: string; rangeMs: readonly [number, number]; alternatives: readonly (readonly SourceSegment[])[]; selected: number | null;
}>;

export type TranscriptVersion = Readonly<{
	id: string; parentId: string | null; rawIds: readonly string[]; segments: readonly SourceSegment[];
	issues: readonly BoundaryIssue[]; missingRanges: readonly (readonly [number, number])[];
	chunkSources?: readonly Readonly<{ rawId: string; chunkId: string; sourceStartMs: number; sourceEndMs: number; timing: RawTranscript['timing'] }>[];
	// Absent on legacy versions: provenance/date are unknown, never inferred.
	batchId?: string; createdAt?: string;
}>;

export type STTBatchPurpose = "initial" | "retry-failed" | "rerun-successful" | "transcribe-selected";
export type STTBatch = Readonly<{
	id: string; parentBatchId: string | null; parentTranscriptVersionId: string | null;
	sourceId: string; chunkIds: readonly string[]; modelId: string; languages: readonly string[];
	route: ModelRegistryRoute | RegisteredModelRoute; purpose: STTBatchPurpose; createdAt: string;
	modelSnapshot?: ModelExecutionSnapshot;
	transcriptionHints?: TranscriptionHints;
	parentSelectedRawIdsByChunk: Readonly<Record<string, string>>;
	attemptRunIds: readonly string[]; selectedRawIdsByChunk: Readonly<Record<string, string>>;
	routerSelection?: RouterSTTSelection;
}>;

export type MinutesSection = "summary" | "topics" | "decisions" | "actions" | "open" | "refs";
export type MinutesSettings = Readonly<{
	outputLanguage: string; sections: readonly MinutesSection[]; instructions: string; modelId: string;
	registrationId?: string; outputTokens?: number;
	// Absence preserves the exact legacy explicit language, including custom values.
	outputLanguageMode?: "app" | "explicit";
}>;

// Reviewed basic-JSON STT contract; discovery or a profile does not enable a route.
export type RouterSTTProfile = Readonly<{
	id: string; version: 1; modelId: string;
	formats: readonly Readonly<{ mime: string; codec: string }>[];
	maxAudioBytes: number; maxBodyBytes: number; singleLanguageHint: boolean;
	source: string; checkedAt: string;
}>;

export type RouterSTTPolicy = Readonly<{ dataCollection: "deny"; requireZdr: boolean }>;
export type RouterSTTPreference = Readonly<{
	policy: RouterSTTPolicy; acknowledgedDisclosureVersion: "or-stt-1" | null; initialDefaultApplied: boolean;
}>;
export type RouterSTTSelection = Readonly<{
	version: 1; route: ModelRegistryRoute; profileId: string; profileVersion: 1;
	catalogFingerprint: string; catalogSource: string; catalogCheckedAt: string;
	policy: RouterSTTPolicy; sourceId: string; chunks: readonly PreparedChunk[];
	expectedLanguages: readonly string[]; appliedLanguage: string | null;
	responseFormat: "json"; rateSnapshot: RateSnapshot | null; rawPricing: unknown;
	billingBasis: "audio-second" | "tokens" | "unknown"; disclosureVersion: "or-stt-1";
}>;

export type RateSnapshot = Readonly<{
	source: string; checkedAt: string; currency: string;
	rates: readonly Readonly<{
		// Generic counters retain advertised billing without assuming a modality.
		unit: "input-token" | "output-token" | "text-input-token" | "text-output-token" | "audio-input-token" | "audio-output-token" | "audio-second" | "request";
		units: number; price: number;
	}>[];
}>;

export type ModelRegistryRoute = Readonly<{
	connectionId: string; provider: "openai" | "openrouter"; stage: "stt" | "minutes";
	modelId: string; endpointTag: string | null;
}>;
export type RegisteredModelRoute = Readonly<{
	connectionId: string; provider: 'openai' | 'openrouter' | 'openai-compatible';
	stage: 'stt' | 'minutes'; modelId: string; endpointTag: string | null;
}>;
export type ModelRegistryMetadata = Readonly<{
	route: ModelRegistryRoute; name: string; source: string; checkedAt: string;
	endpointSource: string | null; endpointCheckedAt: string | null;
	compatible: boolean; blockers: readonly string[]; warnings: readonly string[];
	inputModalities: readonly string[]; outputModalities: readonly string[];
	modelSupportedParameters: readonly string[]; endpointSupportedParameters: readonly string[];
	completionParameter: "max_tokens" | "max_completion_tokens" | null;
	limits: Readonly<{ maxBytes: number | null; contextTokens: number | null; maxPromptTokens: number | null; maxOutputTokens: number | null }>;
	pricing: Readonly<{ kind: "zero" | "priced" | "unknown"; snapshot: RateSnapshot | null; missingDimensions: readonly string[]; unsupportedDimensions: readonly string[]; conditionalDimensions: readonly string[] }>;
	description: Readonly<{ text: string; source: string; checkedAt: string }> | null;
	retirement: Readonly<{ retiredOn: string; source: string; checkedAt: string }> | null;
}>;
export type ModelRegistryEntry = Readonly<{
	route: ModelRegistryRoute; alias: string | null; userEnabled: boolean;
	observedMetadata: ModelRegistryMetadata; acceptedMetadata: ModelRegistryMetadata | null;
	refresh: Readonly<{ status: "current" | "stale" | "unavailable"; attemptedAt: string; error: "refresh-failed" | null }>;
}>;
// Optional encrypted vault-catalog preferences, distinct from historical run snapshots.
export type ModelRegistry = Readonly<{
	version: 1; entries: readonly ModelRegistryEntry[];
	defaults: Readonly<{ stt: string | null; minutes: string | null }>; lastCheckedAt: string | null;
	// Encrypted registry preferences keyed by connection ID; absence grants no acknowledgment.
	openRouterSTT?: Readonly<Record<string, RouterSTTPreference>>;
}>;

export type Usage = Readonly<{
	// Aggregate provider totals, never assumed to be one billing modality.
	inputTokens: number | null; outputTokens: number | null;
	durationSeconds: number | null; audioInputTokens: number | null; textInputTokens: number | null;
	audioOutputTokens: number | null; textOutputTokens: number | null;
	elapsedMs: number; cost: number | null; costKind: "reported" | "estimated" | "unavailable";
	currency: string | null; rateSource: string | null; rateCheckedAt: string | null; rateSnapshot: RateSnapshot | null;
}>;

export type MinutesRun = Readonly<{
	id: string; transcriptVersionId: string; settings: MinutesSettings; generatedMarkdown: string; usage: Usage;
	requestedModel: string; returnedModel: string | null; actualProvider: string | null;
	modelSnapshot?: ModelExecutionSnapshot; response?: unknown; requestedEndpoint?: string;
}>;
export type MinutesRevision = Readonly<{
	id: string; runId: string; parentId: string | null; markdown: string;
}>;

// Optional project JSON: old encrypted projects have no comparisons. Provider
// credentials are held only by the session, never by choices or attempts.
export type MinutesComparisonMember = Readonly<{
	modelId: string; endpointTag: string; providerName: string | null; selectionSnapshot: unknown;
	modelSnapshot?: ModelExecutionSnapshot;
	attempts: readonly Readonly<{ runId: string; revisionId: string | null; consentToken: string; selectionSnapshot: unknown }>[];
}>;
export type MinutesComparison = Readonly<{
	id: string; projectId: string; createdAt: string; inputSignature: string; promptVersion: string;
	transcript: TranscriptVersion; settings: MinutesSettings;
	messages: readonly Readonly<{ role: "system" | "user"; content: string }>[];
	outputTokens: number; reasoningReserveTokens: number;
	members: readonly [MinutesComparisonMember, MinutesComparisonMember];
}>;

export type RunState = "queued" | "requesting" | "response-received" | "saving" | "saved" | "failed" | "cancelled" | "outcome-unknown";
export type Checkpoint = Readonly<{
	id: string; projectId: string; runId: string | null; recordIds: readonly string[]; committedAt: string;
}>;
export type RunIntent = Readonly<{
	kind: "stt" | "minutes"; chunkId: string | null; requestedModel: string;
	expectedLanguages: readonly string[]; rateSnapshot: RateSnapshot | null; requestedEndpoint: string | null;
	sttBatchId?: string; sttPurpose?: STTBatchPurpose;
	modelSnapshot?: ModelExecutionSnapshot;
}>;
export type RunRecord = Readonly<{
	id: string; projectId: string; state: RunState; checkpoint: Checkpoint | null;
	// Optional only for legacy/import/test records; persist intent before actual dispatch.
	intent?: RunIntent | null;
}>;
export type JobContext = Readonly<{
	signal: AbortSignal; epoch: number; assertActive(): void;
}>;

export type UsageHistoryItem = Readonly<{
  id: string; projectId: string; date: string | null; kind: 'stt' | 'minutes' | null;
  state: RunState | null; recordedAttempt: boolean; hasResult: boolean; conflict: boolean;
  model: string | null; executionRequestedModel: string | null; route: 'openai' | 'openrouter' | 'openai-compatible' | null;
  publisher: string | null; requestedEndpoint: string | null; returnedModel: string | null; actualProvider: string | null;
  modelName?: string; archivedAt?: string;
  chunkId: string | null; usage: Usage | null; intentRateSnapshot: RateSnapshot | null;
}>;
export type ProcessingArchive = Readonly<{
 id: string; resetAt: string;
 chunks: readonly Pick<PreparedChunk, 'id' | 'index' | 'sourceStartMs' | 'sourceEndMs'>[];
 items: readonly UsageHistoryItem[];
}>;

export type MeetingProject = Readonly<{
	id: string; title: string; icon: string; color: string; pinned: boolean; createdAt: string; updatedAt: string;
	sourceAssets: readonly SourceAsset[]; audioOptions: AudioOptions; preparedChunks: readonly PreparedChunk[];
	rawTranscripts: readonly RawTranscript[]; transcriptVersions: readonly TranscriptVersion[]; selectedTranscriptVersionId: string | null;
	minutesSettings: MinutesSettings; minutesRuns: readonly MinutesRun[]; minutesRevisions: readonly MinutesRevision[];
	selectedMinutesRevisionId: string | null; runs: readonly RunRecord[];
	minutesComparisons?: readonly MinutesComparison[];
	sttBatches?: readonly STTBatch[];
	processingArchives?: readonly ProcessingArchive[];
	// Absence is legacy/unknown until the vault verifies owned manifests.
	retainedAudio?: RetainedAudio;
	sttRegistrationId?: string;
}>;

export type RetainedAudio = Readonly<{ sourceIds: readonly string[]; chunkIds: readonly string[] }>;
export type StorageProjectInventory = Readonly<{
	projectId: string; sourceBytes: number; chunkBytes: number; draftBytes: number;
	projectBytes: number; encryptedBytes: number; retainedAudio: RetainedAudio;
	draftIds: readonly string[];
}>;
export type StorageInventory = Readonly<{
	// Encoded original/prepared audio and incomplete PCM body sizes, not ciphertext.
	sourceBytes: number; chunkBytes: number; draftBytes: number;
	// Exact ciphertext payload bytes; excludes IDB overhead/header/nonces.
	projectBytes: number; encryptedBytes: number; vaultBytes: number;
	originUsage: number | null; originQuota: number | null;
	projects: readonly StorageProjectInventory[];
}>;
export type DeletionPlan = Readonly<{
	scope: "source" | "chunks" | "meeting" | "vault"; projectId: string | null;
	recordIds: readonly string[]; versionToken: string;
	// Source cleanup explicitly includes these incomplete drafts and owned bodies.
	draftIds: readonly string[];
}>;
export type DeletionConfirmation = Readonly<{ accepted: true; token: string; typedPhrase?: string }>;

export type CheckpointWrite = Readonly<{
	project: MeetingProject; runId: string | null;
	audioRecords: readonly Readonly<{ recordId: string; audio: Blob }>[];
}>;
export type CheckpointResult = Readonly<{ project: MeetingProject; checkpoint: Checkpoint }>;

export type WavCaptureConfig = Readonly<{ sampleRateHz: number; channels: 1 | 2 }>;
export type SourceDraft = Readonly<{ sourceId: string; projectId: string; config: WavCaptureConfig; bodyBytes: number; blockCount: number }>;
export interface SourceWriter {
	// Resolves after the encrypted block, draft metadata and ownership commit.
	append(bytes: Uint8Array, job: JobContext): Promise<void>;
	finalize(asset: SourceAsset, job: JobContext): Promise<CheckpointResult>;
	abort(): Promise<void>;
}

// The vault is the only checkpoint issuer. Resolve only after the encrypted IDB
// transaction completes; commit the raw response, saved run and receipt together.
export interface VaultStore {
	listProjects(job: JobContext): Promise<readonly MeetingProject[]>;
	readProject(projectId: string, job: JobContext): Promise<MeetingProject | null>;
	readAudio(recordId: string, job: JobContext): Promise<Blob>;
	checkpoint(request: CheckpointWrite, job: JobContext): Promise<CheckpointResult>;
	deleteProject(projectId: string, job: JobContext): Promise<void>;
}

export type STTRequest = Readonly<{
	chunk: PreparedChunk; audio: Blob; modelId: string; expectedLanguages: readonly string[]; runId: string; transcriptionHints?: TranscriptionHints;
}>;
export interface STTProvider {
	transcribe(request: STTRequest, job: JobContext): Promise<RawTranscript>;
}
export type MinutesRequest = Readonly<{
	transcript: TranscriptVersion; settings: MinutesSettings; runId: string;
}>;
export interface MinutesProvider {
	generate(request: MinutesRequest, job: JobContext): Promise<MinutesRun>;
}
