import { afterEach, describe, expect, expectTypeOf, it } from "vitest";
import {
	cancelJobs,
	createJobContext,
	snapshotProject,
	transitionRunState,
	updateMinutesSettings,
} from "../src/react-app/domain/jobs";
import type {
	Checkpoint,
	MeetingProject,
	MinutesSettings,
	RawTranscript,
	RunIntent,
	RunRecord,
	TranscriptionExecution,
} from "../src/react-app/domain/types";

function project(): MeetingProject {
	return {
		id: "project-1", title: "Keyless contract fixture", icon: "meeting", color: "cobalt", pinned: false,
		createdAt: "2026-09-30T18:00:00.000Z", updatedAt: "2026-09-30T18:00:00.000Z",
		sourceAssets: [], preparedChunks: [],
		audioOptions: { chunkMinutes: 10, overlapSeconds: 15, expectedLanguages: ["ko", "en", "sw"], bitrateKbps: 32, sampleRateHz: 16000 },
		rawTranscripts: [{ id: "raw-1", chunkId: "chunk-1", runId: "stt-1", response: { text: "fixture speech" }, text: "fixture speech", segments: [{ id: "segment-1", text: "fixture speech", sourceStartMs: 0, sourceEndMs: 1000, rawIds: ["raw-1"] }], timing: "chunk", speakerScope: "none", execution: null }],
		transcriptVersions: [{ id: "version-1", parentId: null, rawIds: ["raw-1"], segments: [{ id: "segment-1", text: "fixture speech", sourceStartMs: 0, sourceEndMs: 1000, rawIds: ["raw-1"] }], issues: [], missingRanges: [] }],
		selectedTranscriptVersionId: "version-1",
		minutesSettings: { outputLanguage: "fr", sections: ["summary", "actions"], instructions: "", modelId: "test-only-model" },
		minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [],
	};
}

const receipt: Checkpoint = {
	id: "checkpoint-1", projectId: "project-1", runId: "stt-1", recordIds: ["project-1"], committedAt: "2026-09-30T18:00:01.000Z",
};
const saving: RunRecord = { id: "stt-1", projectId: "project-1", state: "saving", checkpoint: null };

afterEach(() => cancelJobs());

describe("project contracts", () => {
	it("output changes preserve independent input languages and the selected transcript", () => {
		const before = snapshotProject(project());
		const settings: MinutesSettings = { outputLanguage: "ja", sections: ["decisions"], instructions: "Only confirmed decisions", modelId: "another-test-only-model" };
		const after = updateMinutesSettings(before, settings);
		expect(after.minutesSettings).toEqual(settings);
		expect(after.audioOptions.expectedLanguages).toEqual(["ko", "en", "sw"]);
		expect(after.selectedTranscriptVersionId).toBe("version-1");
		expect(after.rawTranscripts).toBe(before.rawTranscripts);
		expect(after.transcriptVersions).toBe(before.transcriptVersions);
		expect(before.minutesSettings.outputLanguage).toBe("fr");
	});

	it("snapshots detach and freeze raw responses and immutable version linkage", () => {
		const input = project();
		const snapshot = snapshotProject(input);
		(input.rawTranscripts[0].response as { text: string }).text = "caller changed it";
		expect(snapshot.rawTranscripts[0].response).toEqual({ text: "fixture speech" });
		expect(() => { (snapshot.rawTranscripts[0].response as { text: string }).text = "edit"; }).toThrow(TypeError);
		expect(() => { (snapshot.transcriptVersions[0].rawIds as string[]).push("unrelated-raw"); }).toThrow(TypeError);
		expect(snapshot.transcriptVersions[0].rawIds).toEqual(["raw-1"]);
	});

	it("settings updates detach caller-owned section arrays", () => {
		const sections: MinutesSettings["sections"][number][] = ["summary"];
		const after = updateMinutesSettings(snapshotProject(project()), { outputLanguage: "de", sections, instructions: "", modelId: "test-only-model" });
		sections.push("actions");
		expect(after.minutesSettings.sections).toEqual(["summary"]);
	});

	it("snapshots detach and freeze transcription execution facts and modality usage", () => {
		expectTypeOf<RawTranscript["execution"]>().toEqualTypeOf<TranscriptionExecution | null>();
		const languages = ["ko", "en"];
		const usage = {
			inputTokens: null, outputTokens: null, durationSeconds: 1,
			audioInputTokens: null, textInputTokens: null, audioOutputTokens: null, textOutputTokens: null,
			elapsedMs: 42, cost: null, costKind: "unavailable" as const,
			currency: null, rateSource: null, rateCheckedAt: null, rateSnapshot: null,
		};
		const execution: TranscriptionExecution = {
			requestedModel: "test-only-stt", returnedModel: null, actualProvider: null,
			expectedLanguages: languages, usage,
		};
		const input = project();
		const snapshot = snapshotProject({ ...input, rawTranscripts: [{ ...input.rawTranscripts[0], execution }] });
		languages.push("sw");
		usage.elapsedMs = 99;
		const saved = snapshot.rawTranscripts[0].execution!;
		expect(saved.requestedModel).toBe("test-only-stt");
		expect(saved.returnedModel).toBeNull();
		expect(saved.actualProvider).toBeNull();
		expect(saved.expectedLanguages).toEqual(["ko", "en"]);
		expect(saved.usage.durationSeconds).toBe(1);
		expect(saved.usage.elapsedMs).toBe(42);
		expect(() => { (saved.expectedLanguages as string[]).push("fr"); }).toThrow(TypeError);
		expect(() => { (saved.usage as { elapsedMs: number }).elapsedMs = 7; }).toThrow(TypeError);
		const checkReadonlyContract = (value: TranscriptionExecution) => {
			// @ts-expect-error Execution provenance is readonly.
			value.requestedModel = "changed";
			// @ts-expect-error Expected input languages are readonly.
			value.expectedLanguages.push("fr");
			// @ts-expect-error Modality usage is readonly.
			value.usage.elapsedMs = 7;
		};
		// Compile-only negative assignments; never mutate the runtime fixture.
		void checkReadonlyContract;
	});

	it("snapshots preserve immutable dispatch intent without raw credentials", () => {
		expectTypeOf<keyof RunIntent>().toEqualTypeOf<"kind" | "chunkId" | "requestedModel" | "expectedLanguages" | "rateSnapshot" | "requestedEndpoint" | "sttBatchId" | "sttPurpose" | "modelSnapshot">();
		const languages = ["ko", "en"];
		const rates: { unit: "audio-second"; units: number; price: number }[] = [{ unit: "audio-second", units: 60, price: 1 }];
		const intent: RunIntent = {
			kind: "stt", chunkId: "chunk-1", requestedModel: "test-only-stt", expectedLanguages: languages,
			rateSnapshot: { source: "keyless-test-only-rate", checkedAt: "2026-09-30T18:00:00.000Z", currency: "USD", rates },
			requestedEndpoint: "https://provider.invalid/transcriptions",
		};
		const run: RunRecord = { id: "stt-1", projectId: "project-1", state: "queued", checkpoint: null, intent };
		const snapshot = snapshotProject({ ...project(), runs: [run] });
		languages.push("sw");
		rates[0].price = 99;
		const saved = snapshot.runs[0].intent!;
		expect(saved.kind).toBe("stt");
		expect(saved.chunkId).toBe("chunk-1");
		expect(saved.requestedModel).toBe("test-only-stt");
		expect(saved.expectedLanguages).toEqual(["ko", "en"]);
		expect(saved.rateSnapshot?.rates[0]).toEqual({ unit: "audio-second", units: 60, price: 1 });
		expect(saved.requestedEndpoint).toBe("https://provider.invalid/transcriptions");
		expect(() => { (saved.expectedLanguages as string[]).push("fr"); }).toThrow(TypeError);
		expect(() => { (saved.rateSnapshot!.rates[0] as { price: number }).price = 7; }).toThrow(TypeError);
	});
});

describe("checkpoint state", () => {
	it("rejects saved before a completed encrypted transaction receipt exists", () => {
		expect(() => transitionRunState(saving, "saved")).toThrow(/checkpoint/i);
	});

	it("rejects another run or project's checkpoint", () => {
		expect(() => transitionRunState(saving, "saved", { ...receipt, runId: "stt-2" })).toThrow(/checkpoint/i);
		expect(() => transitionRunState(saving, "saved", { ...receipt, projectId: "project-2" })).toThrow(/checkpoint/i);
	});

	it("rejects empty or incomplete transaction receipts", () => {
		for (const invalid of [
			{ ...receipt, id: "" },
			{ ...receipt, recordIds: [] },
			{ ...receipt, recordIds: [""] },
			{ ...receipt, committedAt: "not-a-timestamp" },
			{ ...receipt, committedAt: "2026-09-30T18:00:01+09:00" },
		]) expect(() => transitionRunState(saving, "saved", invalid)).toThrow(/checkpoint/i);
	});

	it("promotes only the saving state using a matching receipt", () => {
		const queued: RunRecord = { ...saving, state: "queued" };
		const requesting = transitionRunState(queued, "requesting");
		const received = transitionRunState(requesting, "response-received");
		const writing = transitionRunState(received, "saving");
		const saved = transitionRunState(writing, "saved", receipt);
		expect(saved.state).toBe("saved");
		expect(saved.checkpoint?.id).toBe("checkpoint-1");
		expect(saving.state).toBe("saving");
		expect(() => transitionRunState(requesting, "saved", receipt)).toThrow(/transition/i);
	});

	it("preserves terminal saved and unknown-outcome runs instead of overwriting them on retry", () => {
		const saved = transitionRunState(saving, "saved", receipt);
		expect(() => transitionRunState(saved, "queued")).toThrow(/transition/i);
		const unknown = transitionRunState({ ...saving, state: "requesting" }, "outcome-unknown");
		expect(() => transitionRunState(unknown, "queued")).toThrow(/transition/i);
	});

	it("allows failures without implying a saved checkpoint", () => {
		const failed = transitionRunState(saving, "failed");
		expect(failed).toEqual({ ...saving, state: "failed" });
	});
});

describe("job epoch", () => {
	it("rejects stale asynchronous completions before they can schedule another request", async () => {
		const job = createJobContext();
		const response = Promise.resolve("late keyless fixture response");
		cancelJobs();
		let scheduled = false;
		await expect(response.then(() => { job.assertActive(); scheduled = true; })).rejects.toMatchObject({ name: "AbortError" });
		expect(scheduled).toBe(false);
		expect(job.signal.aborted).toBe(true);
	});

	it("cancels every context in the epoch and starts a fresh active epoch", () => {
		const first = createJobContext();
		const second = createJobContext();
		expect(() => first.assertActive()).not.toThrow();
		cancelJobs();
		expect(() => first.assertActive()).toThrow();
		expect(() => second.assertActive()).toThrow();
		const next = createJobContext();
		expect(next.epoch).toBeGreaterThan(first.epoch);
		expect(next.signal.aborted).toBe(false);
		expect(() => next.assertActive()).not.toThrow();
	});
});
