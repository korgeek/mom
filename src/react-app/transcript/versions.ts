import type { TranscriptVersion } from "../domain/types";

function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		Object.freeze(value);
		for (const child of Object.values(value)) freeze(child);
	}
	return value;
}

/** Creates a detached immutable version; IDs contain no transcript content. */
export function createTranscriptVersion(fields: Omit<TranscriptVersion, "id">): TranscriptVersion {
	return freeze(structuredClone({ ...fields, id: crypto.randomUUID() }));
}

export type TranscriptEdit = Readonly<{ segmentId: string; text: string }>;

function editedFields(base: TranscriptVersion, edits: readonly TranscriptEdit[]): Pick<TranscriptVersion, "segments" | "issues"> {
	const changes = new Map<string, string>();
	const visible = new Set(base.segments.map(({ id }) => id));
	for (const edit of edits) {
		if (!visible.has(edit.segmentId)) throw new Error("Unknown or unselected transcript segment");
		if (changes.has(edit.segmentId)) throw new Error("Duplicate segment edit");
		changes.set(edit.segmentId, edit.text);
	}
	function apply(segment: TranscriptVersion["segments"][number]): TranscriptVersion["segments"][number] {
		return changes.has(segment.id) ? { ...segment, text: changes.get(segment.id)! } : segment;
	}
	return {
		segments: base.segments.map(apply),
		// Selecting an alternate later must retain edits made to its visible text.
		issues: base.issues.map((issue) => ({ ...issue, alternatives: issue.alternatives.map((segments) => segments.map(apply)) })),
	};
}

export function editTranscript(base: TranscriptVersion, edits: readonly TranscriptEdit[]): TranscriptVersion {
	return createTranscriptVersion({ ...base, ...editedFields(base, edits), parentId: base.id });
}

export function resolveBoundary(base: TranscriptVersion, issueId: string, alternative: number): TranscriptVersion {
	const issue = base.issues.find(({ id }) => id === issueId);
	if (!issue) throw new Error("Unknown boundary issue");
	if (!Number.isInteger(alternative) || alternative < 0 || alternative >= issue.alternatives.length) {
		throw new Error("Invalid boundary alternative");
	}
	const candidateIds = new Set(issue.alternatives.flatMap((segments) => segments.map(({ id }) => id)));
	const selectedSegments = issue.alternatives[alternative];
	const selectedIds = new Set(selectedSegments.map(({ id }) => id));
	const discarded = issue.alternatives.flat().filter(({ id }) => !selectedIds.has(id));
	if (discarded.some((segment) => segment.sourceStartMs < issue.rangeMs[0] || segment.sourceEndMs > issue.rangeMs[1])) {
		throw new Error("Boundary choice would discard speech outside the overlap; reconcile full segments explicitly");
	}
	const discardedIds = new Set(discarded.map(({ id }) => id));
	if (base.issues.some((other) => other.id !== issueId && other.alternatives.some((segments) => segments.some(({ id }) => discardedIds.has(id))))) {
		throw new Error("Boundary choice affects another boundary; reconcile full segments explicitly");
	}
	const segments = [...base.segments.filter(({ id }) => !candidateIds.has(id)), ...selectedSegments]
		.sort((a, b) => a.sourceStartMs - b.sourceStartMs || a.sourceEndMs - b.sourceEndMs);
	return createTranscriptVersion({
		...base, parentId: base.id, segments,
		// Every other candidate remains in this issue and in the previous version.
		issues: base.issues.map((candidate) => candidate.id === issueId ? { ...candidate, selected: alternative } : candidate),
	});
}

/** Explicit human reconciliation keeps whole visible candidates and their source
 * ranges. Empty edits mean the user deliberately retained both versions of the
 * boundary. No automatic text splitting or finer timing is introduced.
 */
export function reconcileBoundary(base: TranscriptVersion, issueId: string, edits: readonly TranscriptEdit[]): TranscriptVersion {
	const issue = base.issues.find(({ id }) => id === issueId);
	if (!issue) throw new Error("Unknown boundary issue");
	const candidateIds = new Set(issue.alternatives.flatMap((segments) => segments.map(({ id }) => id)));
	if (edits.some(({ segmentId }) => !candidateIds.has(segmentId))) throw new Error("Edit does not belong to this boundary issue");
	const fields = editedFields(base, edits);
	const reconciled = fields.segments.filter(({ id }) => candidateIds.has(id));
	return createTranscriptVersion({
		...base, ...fields, parentId: base.id,
		issues: fields.issues.map((other) => other.id === issueId ? {
			...issue, alternatives: [...issue.alternatives, reconciled], selected: issue.alternatives.length,
		} : other),
	});
}
