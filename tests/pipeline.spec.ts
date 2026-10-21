// Keyless request-boundary fixtures; no real provider traffic.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelJobs, createJobContext } from "../src/react-app/domain/jobs";
import { ProviderError, readOnlyJson, runPaidRequest, runTranscriptionQueue } from "../src/react-app/domain/pipeline";
import type { CheckpointResult, MeetingProject, RawTranscript, VaultStore } from "../src/react-app/domain/types";
const date = "2026-09-30T18:00:00.000Z";
const chunk = (id: string, index: number) => ({ id, sourceId: "source1", index, sourceStartMs: index * 600000, sourceEndMs: (index + 1) * 600000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: "audio/mpeg", codec: "mp3", audioRecordId: `audio-${id}` });
const project = (): MeetingProject => ({ id: "p1", title: "Keyless fixture project", icon: "meeting", color: "cobalt", pinned: false, createdAt: date, updatedAt: date, sourceAssets: [], audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ["ko", "en"], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [chunk("c1", 0), chunk("c2", 1)], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { modelId: "fixture/model", outputLanguage: "en", sections: ["summary"], instructions: "" }, minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] });
const raw = (chunkId: string, runId: string): RawTranscript => ({ id: `raw-${runId}`, chunkId, runId, response: { text: "Keyless fixture speech" }, text: "Keyless fixture speech", segments: [], timing: "chunk", speakerScope: "none", execution: null });
const receipt = (p: MeetingProject, runId: string | null): CheckpointResult => { const checkpoint = { id: `cp-${p.runs.length}-${runId}`, projectId: p.id, runId, recordIds: [p.id], committedAt: date }; return { checkpoint, project: { ...p, runs: p.runs.map((run) => run.id === runId ? { ...run, state: "saved" as const, checkpoint } : run) } }; };
const store = (checkpoint: VaultStore["checkpoint"]): VaultStore => ({ listProjects: async () => [], readProject: async () => null, readAudio: async () => new Blob(["abc"], { type: "audio/mpeg" }), deleteProject: async () => {}, checkpoint });
afterEach(() => { cancelJobs(); vi.useRealTimers(); });
it.each([undefined, 'force-cache'] as const)('bypasses browser caching for authenticated read-only requests with caller cache %s', async cache => {
 const requests: RequestInit[] = [];
 const init: RequestInit = { headers: { Authorization: 'Bearer SYNTHETIC_READ_ONLY' }, ...(cache ? { cache } : {}) };
 const body = await readOnlyJson(async (_url, sent) => { requests.push(sent!); return new Response('{"synthetic":true}'); }, 'https://provider.invalid/private', init, () => 0, createJobContext());
 expect(body).toEqual({ synthetic: true }); expect(requests).toHaveLength(1);
 expect(requests[0].cache).toBe('no-store'); expect(new Headers(requests[0].headers).get('Authorization')).toBe('Bearer SYNTHETIC_READ_ONLY');
 expect(init.cache).toBe(cache);
});

describe("one global paid request", () => {
 it("rejects another provider while one request is active rather than queueing paid work", async () => {
  let release!: (value: string) => void; const first = runPaidRequest("openai", createJobContext(), async (_signal, dispatched) => { dispatched(); return new Promise<string>((resolve) => { release = resolve; }); });
  await expect(runPaidRequest("openrouter", createJobContext(), async () => "must not run")).rejects.toMatchObject({ code: "busy" }); release("fixture"); expect(await first).toBe("fixture");
 });
 it("marks network loss after dispatch outcome-unknown without automatic retry", async () => {
  let calls = 0; await expect(runPaidRequest("openai", createJobContext(), async (_signal, dispatched) => { calls++; dispatched(); throw new TypeError("private upstream fixture text"); })).rejects.toMatchObject({ code: "network", outcomeUnknown: true }); expect(calls).toBe(1);
 });
 it("classifies pre-dispatch cancellation without ambiguous charges", async () => {
  const job = createJobContext(); cancelJobs(); await expect(runPaidRequest("openai", job, async () => "must not run")).rejects.toMatchObject({ name: "AbortError" });
 });
 it("discards late completions after epoch change", async () => {
  let release!: (value: string) => void; const job = createJobContext(); const request = runPaidRequest("openai", job, async (_signal, dispatched) => { dispatched(); return new Promise<string>((resolve) => { release = resolve; }); }); cancelJobs(); release("private late fixture"); await expect(request).rejects.toMatchObject({ name: "AbortError" });
 });
 it("times out dispatched work and never releases gate to overlap still unresolved transport", async () => {
  vi.useFakeTimers(); let release!: (value: string) => void; const request = runPaidRequest("openai", createJobContext(), async (_signal, dispatched) => { dispatched(); return new Promise<string>((resolve) => { release = resolve; }); }, { timeoutMs: 10 });
  const assertion = expect(request).rejects.toMatchObject({ code: "timeout", outcomeUnknown: true }); await vi.advanceTimersByTimeAsync(10); await assertion;
  await expect(runPaidRequest("openrouter", createJobContext(), async () => "must not overlap")).rejects.toMatchObject({ code: "busy" }); release("late"); await Promise.resolve(); await Promise.resolve();
 });
 it("respects Retry-After for only a user-triggered repeat", async () => {
  let now = 1000; const options = { now: () => now }; await expect(runPaidRequest("openai", createJobContext(), async () => { throw new ProviderError("rate-limit", { retryAt: 2000 }); }, options)).rejects.toMatchObject({ code: "rate-limit" });
  let calls = 0; await expect(runPaidRequest("openai", createJobContext(), async () => { calls++; return "fixture"; }, options)).rejects.toMatchObject({ code: "cooldown", retryAt: 2000 }); expect(calls).toBe(0); now = 2001; expect(await runPaidRequest("openai", createJobContext(), async () => { calls++; return "fixture"; }, options)).toBe("fixture");
 });
});

describe("durable STT pipeline", () => {
 it("waits for encrypted requesting intent before dispatch and saved response transaction before the next chunk", async () => {
  const events: string[] = []; let releaseIntent!: (value: CheckpointResult) => void; let releaseResult!: (value: CheckpointResult) => void; let intentProject!: MeetingProject; let resultProject!: MeetingProject; let resultId: string | null = null;
  const vault = store(async ({ project: p, runId }) => { events.push(runId ? "response-saving" : "intent-saving"); if (events.length === 1) { intentProject = p; return new Promise((resolve) => { releaseIntent = resolve; }); } if (events.length === 3) { resultProject = p; resultId = runId; return new Promise((resolve) => { releaseResult = resolve; }); } return receipt(p, runId); });
  const pending = runTranscriptionQueue({ project: project(), chunkIds: ["c1", "c2"], modelId: "gpt-transcribe", languages: ["ko", "en"], vault, provider: { transcribe: async (request) => { events.push(`dispatch-${request.chunk.id}`); return raw(request.chunk.id, request.runId); } }, job: createJobContext(), makeId: (() => { let id = 0; return () => `run-${++id}`; })() });
  await Promise.resolve(); await Promise.resolve(); expect(events).toEqual(["intent-saving"]); expect(intentProject.runs[0].state).toBe("requesting"); releaseIntent(receipt(intentProject, null));
  await vi.waitFor(() => expect(events).toEqual(["intent-saving", "dispatch-c1", "response-saving"])); expect(resultProject.runs[0].state).toBe("saving"); releaseResult(receipt(resultProject, resultId));
  const result = await pending; expect(result.failure).toBeNull(); expect(result.project.rawTranscripts).toHaveLength(2); expect(result.project.runs.every((run) => run.state === "saved")).toBe(true);
 });
 it("does not dispatch when durable intent hits quota failure", async () => {
  let calls = 0; const result = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async () => { throw new DOMException("fixture quota", "QuotaExceededError"); }), provider: { transcribe: async () => { calls++; return raw("c1", "r1"); } } }); expect(calls).toBe(0); expect(result.failure?.code).toBe("storage");
 });
 it("preserves received unsaved work and halts on response checkpoint failure", async () => {
  let calls = 0; let writes = 0; let captured: MeetingProject | null = null; const result = await runTranscriptionQueue({ project: project(), chunkIds: ["c1", "c2"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: p, runId }) => { if (++writes === 2) throw new Error("fixture storage"); return receipt(p, runId); }), provider: { transcribe: async (request) => { calls++; return raw(request.chunk.id, request.runId); } }, onPending: (p) => { captured = p; } }); expect(calls).toBe(1); expect(result.failure?.code).toBe("storage"); expect(result.pendingProject?.rawTranscripts).toHaveLength(1); expect(captured).toEqual(result.pendingProject); expect(result.project.rawTranscripts).toHaveLength(0);
 });
 it("retries only explicit selected unsaved chunks and preserves previous saved raw results", async () => {
  const p = project(); const completed = receipt({ ...p, rawTranscripts: [raw("c1", "previous")], runs: [{ id: "previous", projectId: p.id, state: "saving", checkpoint: null }] }, "previous").project; const calls: string[] = [];
  const result = await runTranscriptionQueue({ project: completed, chunkIds: ["c1", "c2"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: next, runId }) => receipt(next, runId)), provider: { transcribe: async (request) => { calls.push(request.chunk.id); return raw(request.chunk.id, request.runId); } } }); expect(calls).toEqual(["c2"]); expect(result.project.rawTranscripts[0]).toEqual(completed.rawTranscripts[0]);
 });
 it("does not auto replay restored requesting/unknown attempts without explicit acknowledgement", async () => {
  const p = { ...project(), runs: [{ id: "interrupted", projectId: "p1", state: "requesting" as const, checkpoint: null }] }; let calls = 0;
  await expect(runTranscriptionQueue({ project: p, chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: next, runId }) => receipt(next, runId)), provider: { transcribe: async () => { calls++; return raw("c1", "r1"); } } })).rejects.toMatchObject({ code: "ambiguous-attempt" }); expect(calls).toBe(0);
 });
 it("does not persist/render a response completed after lock epoch changes", async () => {
  let release!: (value: RawTranscript) => void; let dispatched = false; let writes = 0; let rendered = 0; let requestRun = "";
  const result = runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: p, runId }) => { writes++; return receipt(p, runId); }), provider: { transcribe: async (request) => { dispatched = true; requestRun = request.runId; return new Promise((resolve) => { release = resolve; }); } }, onPending: () => { rendered++; } }); await vi.waitFor(() => expect(dispatched).toBe(true)); cancelJobs(); release(raw("c1", requestRun)); await expect(result).rejects.toMatchObject({ name: "AbortError" }); expect(writes).toBe(1); expect(rendered).toBe(0);
 });
 it("rejects adapter-only saved status and invalid atomic checkpoint receipts", async () => {
  let writes = 0; const result = await runTranscriptionQueue({ project: project(), chunkIds: ["c1", "c2"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: p, runId }) => { writes++; const result = receipt(p, runId); return runId ? { ...result, project: p } : result; }), provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } }); expect(result.failure?.code).toBe("storage"); expect(writes).toBe(2); expect(result.pendingProject).not.toBeNull();
 });
});

describe("request intent scope", () => {
 it("does not create ambiguous requesting intent when local audio cannot be read", async () => {
  let writes = 0; let calls = 0; const vault = { ...store(async ({ project: p, runId }) => { writes++; return receipt(p, runId); }), readAudio: async () => { throw new Error("fixture unreadable audio"); } };
  const result = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault, provider: { transcribe: async () => { calls++; return raw("c1", "r1"); } } }); expect(writes).toBe(0); expect(calls).toBe(0); expect(result.failure?.code).toBe("storage");
 });
 it("records the checked model rates and complete requested language scope in durable intent", async () => {
  let intent: MeetingProject | null = null; await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: ["ko", "en"], job: createJobContext(), vault: store(async ({ project: p, runId }) => { if (runId === null) intent = p; return receipt(p, runId); }), provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } });
  const captured = intent as unknown as MeetingProject; expect(captured.runs[0].intent).toMatchObject({ kind: "stt", chunkId: "c1", requestedModel: "gpt-transcribe", expectedLanguages: ["ko", "en"], requestedEndpoint: null }); expect(captured.runs[0].intent?.rateSnapshot?.rates[0].unit).toBe("audio-second");
 });
});

describe("review regressions: queue admission", () => {
 it("rejects a concurrent queue before vault reads or writes and preserves the first queue's saved raw result", async () => {
  let durable = project(); let releaseFirst!: () => void; let firstDispatch = false;
  const firstVault = store(async ({ project: p, runId }) => { const committed = receipt(p, runId); durable = committed.project; return committed; });
  const first = runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: firstVault, provider: { transcribe: async (request, job) => runPaidRequest("openai", job, async (_signal, dispatched) => { dispatched(); firstDispatch = true; await new Promise<void>((resolve) => { releaseFirst = resolve; }); return raw(request.chunk.id, request.runId); }) } });
  await vi.waitFor(() => expect(firstDispatch).toBe(true));
  let secondReads = 0; let secondWrites = 0; let releaseStaleFailure: (() => void) | undefined;
  const secondVault = { ...store(async ({ project: p, runId }) => { secondWrites++; if (p.runs.some((run) => run.state === "failed")) await new Promise<void>((resolve) => { releaseStaleFailure = resolve; }); const committed = receipt(p, runId); durable = committed.project; return committed; }), readAudio: async () => { secondReads++; return new Blob(["abc"], { type: "audio/mpeg" }); } };
  let secondSettled = false;
  const second = runTranscriptionQueue({ project: project(), chunkIds: ["c2"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: secondVault, provider: { transcribe: async (request, job) => runPaidRequest("openai", job, async (_signal, dispatched) => { dispatched(); return raw(request.chunk.id, request.runId); }) } }).then((result) => { secondSettled = true; return result; }, (error: unknown) => { secondSettled = true; return error; });
  await vi.waitFor(() => expect(secondSettled || releaseStaleFailure !== undefined).toBe(true));
  releaseFirst(); const firstResult = await first; expect(durable.rawTranscripts).toHaveLength(1);
  releaseStaleFailure?.(); const secondFailure = await second;
  expect(firstResult.project.rawTranscripts).toHaveLength(1); expect(durable.rawTranscripts).toEqual(firstResult.project.rawTranscripts); expect(durable.runs.every((run) => run.state === "saved")).toBe(true);
  expect(secondFailure).toBeInstanceOf(ProviderError); expect(secondFailure).toMatchObject({ code: "busy" }); expect(secondReads).toBe(0); expect(secondWrites).toBe(0);
 });
 it("releases queue admission after storage failure", async () => {
  const failed = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async () => { throw new Error("fixture quota"); }), provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } }); expect(failed.failure?.code).toBe("storage");
  const next = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: p, runId }) => receipt(p, runId)), provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } }); expect(next.failure).toBeNull(); expect(next.project.rawTranscripts).toHaveLength(1);
 });
 it("releases queue admission after an aborted epoch rejects local audio preparation", async () => {
  let started = false; let rejectRead!: (error: unknown) => void; const vault = { ...store(async ({ project: p, runId }) => receipt(p, runId)), readAudio: async () => { started = true; return new Promise<Blob>((_resolve, reject) => { rejectRead = reject; }); } };
  const aborted = runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault, provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } }); await vi.waitFor(() => expect(started).toBe(true)); cancelJobs(); rejectRead(new DOMException("fixture abort", "AbortError")); await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
  const next = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault: store(async ({ project: p, runId }) => receipt(p, runId)), provider: { transcribe: async (request) => raw(request.chunk.id, request.runId) } }); expect(next.failure).toBeNull();
 });
});

describe("review regressions: dispatched provider timeouts", () => {
 it.each([
  { name: "HTTP 408 JSON", status: 408, body: JSON.stringify({ error: { message: "Private fixture timeout" } }), expectedStatus: 408 },
  { name: "HTTP 504 JSON", status: 504, body: JSON.stringify({ error: { message: "Private fixture timeout" } }), expectedStatus: 504 },
  { name: "HTTP 408 malformed JSON", status: 408, body: "Private fixture timeout", expectedStatus: 408 },
  { name: "HTTP 504 malformed JSON", status: 504, body: "Private fixture timeout", expectedStatus: 504 },
  { name: "HTTP 200 body timeout code", status: 200, body: JSON.stringify({ error: { code: 504, message: "Private fixture timeout" } }), expectedStatus: 504 },
  { name: "HTTP 200 typed provider timeout", status: 200, body: JSON.stringify({ error: { metadata: { error_type: "provider_timeout" }, message: "Private fixture timeout" } }), expectedStatus: 200 },
 ])("persists outcome-unknown for $name and refuses automatic replay", async ({ status, body, expectedStatus }) => {
  const { createOpenAIProvider } = await import("../src/react-app/providers/openai");
  let calls = 0; let writes = 0; let reads = 0; const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => { calls++; return new Response(body, { status }); } });
  const vault = { ...store(async ({ project: p, runId }) => { writes++; return receipt(p, runId); }), readAudio: async () => { reads++; return new Blob(["abc"], { type: "audio/mpeg" }); } };
  const result = await runTranscriptionQueue({ project: project(), chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault, provider });
  expect(result.failure).toMatchObject({ code: "timeout", status: expectedStatus, outcomeUnknown: true }); expect(result.project.runs[0].state).toBe("outcome-unknown"); expect(calls).toBe(1); expect(writes).toBe(2); expect(result.project.rawTranscripts).toHaveLength(0);
  await expect(runTranscriptionQueue({ project: result.project, chunkIds: ["c1"], modelId: "gpt-transcribe", languages: [], job: createJobContext(), vault, provider })).rejects.toMatchObject({ code: "ambiguous-attempt" }); expect(calls).toBe(1); expect(writes).toBe(2); expect(reads).toBe(1); expect(JSON.stringify(result.failure)).not.toContain("Private fixture timeout");
  if (status === 408 || status === 504) expect(result.failure?.readSensitiveResponse()).toBeDefined();
 });
 it("upgrades only dispatched typed timeout and retains status, Retry-After and private payload", async () => {
  const payload = { text: "Private fixture timeout details" };
  const failure = await runPaidRequest("openai", createJobContext(), async (_signal, dispatched) => { dispatched(); throw new ProviderError("timeout", { status: 504, retryAt: 2000, sensitiveResponse: payload }); }).catch((error: ProviderError) => error);
  expect(failure).toMatchObject({ code: "timeout", status: 504, retryAt: 2000, outcomeUnknown: true }); expect(failure.readSensitiveResponse()).toEqual(payload); expect(JSON.stringify(failure)).not.toContain(payload.text);
  await expect(runPaidRequest("openai", createJobContext(), async () => { throw new ProviderError("timeout", { status: 408 }); })).rejects.toMatchObject({ outcomeUnknown: false });
 });
 it("keeps a read-only authentication-check timeout separate from paid ambiguity", async () => {
  const { createOpenAIProvider } = await import("../src/react-app/providers/openai");
  const provider = createOpenAIProvider({ getKey: () => "keyless-fixture-value", fetch: async () => new Response(JSON.stringify({ error: { code: 504 } }), { status: 504 }) });
  await expect(provider.checkConnection(createJobContext())).rejects.toMatchObject({ code: "timeout", outcomeUnknown: false });
 });
});
