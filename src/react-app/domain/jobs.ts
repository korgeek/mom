import type { Checkpoint, JobContext, MeetingProject, MinutesSettings, RunRecord, RunState } from "./types";

let epoch = 0;
let controller = new AbortController();

// One active vault owner per tab; cancellation invalidates every operation in it.
export function createJobContext(): JobContext {
	const signal = controller.signal;
	const jobEpoch = epoch;
	return Object.freeze({
		signal, epoch: jobEpoch,
		assertActive() {
			if (signal.aborted || jobEpoch !== epoch) throw new DOMException("Job no longer active", "AbortError");
		},
	});
}

export function cancelJobs(): void {
	epoch += 1;
	controller.abort();
	controller = new AbortController();
}

function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value)) freeze(child);
	}
	return value;
}

// Audio lives in separate records. Project payloads and raw provider responses
// must be JSON data; the vault validates that boundary before serialization.
export function snapshotProject(project: MeetingProject): MeetingProject {
	return freeze(structuredClone(project));
}

export function updateMinutesSettings(project: MeetingProject, settings: MinutesSettings): MeetingProject {
	return Object.freeze({ ...project, minutesSettings: freeze(structuredClone(settings)) });
}

const transitions: Record<RunState, readonly RunState[]> = {
	queued: ["requesting", "failed", "cancelled"],
	requesting: ["response-received", "failed", "cancelled", "outcome-unknown"],
	"response-received": ["saving", "failed"],
	saving: ["saved", "failed"],
	saved: [], failed: [], cancelled: [], "outcome-unknown": [],
};

export function transitionRunState(run: RunRecord, next: RunState, checkpoint?: Checkpoint): RunRecord {
	if (next === "saved" && (
		!checkpoint || checkpoint.runId !== run.id || checkpoint.projectId !== run.projectId || !checkpoint.id.trim() ||
		checkpoint.recordIds.length === 0 || checkpoint.recordIds.some((id) => !id.trim()) ||
		!checkpoint.committedAt.endsWith("Z") || !Number.isFinite(Date.parse(checkpoint.committedAt))
	)) {
		throw new Error("A matching completed encrypted checkpoint is required");
	}
	if (!transitions[run.state].includes(next)) throw new Error(`Invalid run transition: ${run.state} → ${next}`);
	return freeze({ ...run, state: next, checkpoint: next === "saved" ? structuredClone(checkpoint!) : null });
}
