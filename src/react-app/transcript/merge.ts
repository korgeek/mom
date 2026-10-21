import type { BoundaryIssue, PreparedChunk, RawTranscript, SourceSegment, TranscriptVersion } from "../domain/types";
import { createTranscriptVersion } from "./versions";

export type MergeCoverage = Readonly<{
	expectedChunks: readonly Pick<PreparedChunk, "id" | "sourceStartMs" | "sourceEndMs">[];
	sourceStartMs?: number;
	sourceEndMs?: number;
}>;

type Entry = {
	segment: SourceSegment;
	requestIds: string[];
	canDeduplicate: boolean;
};

/** Enrich legacy selected versions from retained metadata without changing their speech or selection. */
export function withChunkSources(version: TranscriptVersion, raw: readonly RawTranscript[], chunks: MergeCoverage['expectedChunks']): TranscriptVersion {
	if (version.chunkSources) return version;
	const chunkSources = version.rawIds.flatMap(rawId => {
		const result = raw.find(item => item.id === rawId), chunk = chunks.find(item => item.id === result?.chunkId);
		return result && chunk ? [{ rawId, chunkId: chunk.id, sourceStartMs: chunk.sourceStartMs, sourceEndMs: chunk.sourceEndMs, timing: result.timing }] : [];
	});
	return chunkSources.length ? { ...version, chunkSources } : version;
}

function validateRange(start: number, end: number): void {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
		throw new Error("Invalid source time range");
	}
}

function expectedCoverage(raw: readonly RawTranscript[], coverage?: MergeCoverage): [number, number][] {
	// Speech timestamps alone cannot distinguish pauses from missing requests or
	// establish the recording end. Only prepared/completed chunk ranges do that.
	if (!coverage) return [];
	const chunks = new Map<string, MergeCoverage["expectedChunks"][number]>();
	for (const chunk of coverage.expectedChunks) {
		validateRange(chunk.sourceStartMs, chunk.sourceEndMs);
		if (chunks.has(chunk.id)) throw new Error("Duplicate expected chunk ID");
		chunks.set(chunk.id, chunk);
	}
	const start = coverage.sourceStartMs ?? 0;
	const end = coverage.sourceEndMs ?? coverage.expectedChunks.reduce((max, chunk) => Math.max(max, chunk.sourceEndMs), start);
	validateRange(start, end);
	const completed = new Set(raw.map(({ chunkId }) => chunkId));
	const ranges = coverage.expectedChunks.filter(({ id }) => completed.has(id))
		.map((chunk) => [Math.max(start, chunk.sourceStartMs), Math.min(end, chunk.sourceEndMs)] as const)
		.filter(([from, to]) => from < to)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const missing: [number, number][] = [];
	let cursor = start;
	for (const [from, to] of ranges) {
		if (from > cursor) missing.push([cursor, from]);
		cursor = Math.max(cursor, to);
	}
	if (cursor < end) missing.push([cursor, end]);
	return missing;
}

function boundaryIssues(entries: readonly Entry[], rawIds: readonly string[]): BoundaryIssue[] {
	// Keep conflicts local to a pair of requests. A whole chunk can participate
	// in two boundaries without chaining every chunk into one meeting-wide choice.
	type Edge = { left: Entry; right: Entry; from: number; to: number };
	const pairs = new Map<string, { ids: readonly [string, string]; edges: Edge[] }>();
	const order = new Map(rawIds.map((id, i) => [id, i]));
	let active: number[] = [];
	for (let i = 0; i < entries.length; i++) {
		const current = entries[i];
		active = active.filter((j) => entries[j].segment.sourceEndMs > current.segment.sourceStartMs);
		for (const j of active) {
			const previous = entries[j];
			if (current.segment.sourceEndMs <= previous.segment.sourceStartMs) continue;
			for (const left of previous.requestIds) {
				for (const right of current.requestIds) {
					if (left === right) continue;
					const ids: readonly [string, string] = order.get(left)! < order.get(right)! ? [left, right] : [right, left];
					const key = JSON.stringify(ids);
					const pair = pairs.get(key) ?? { ids, edges: [] };
					pair.edges.push({
						left: previous, right: current,
						from: Math.max(previous.segment.sourceStartMs, current.segment.sourceStartMs),
						to: Math.min(previous.segment.sourceEndMs, current.segment.sourceEndMs),
					});
					pairs.set(key, pair);
				}
			}
		}
		active.push(i);
	}
	const issues: BoundaryIssue[] = [];
	for (const { ids, edges } of pairs.values()) {
		edges.sort((a, b) => a.from - b.from || a.to - b.to);
		let from = edges[0].from;
		let to = edges[0].to;
		let candidates = new Set<Entry>();
		function append(): void {
			const group = [...candidates].sort((a, b) => a.segment.sourceStartMs - b.segment.sourceStartMs || a.segment.sourceEndMs - b.segment.sourceEndMs);
			issues.push({
				id: crypto.randomUUID(), rangeMs: [from, to], selected: null,
				alternatives: ids.map((id) => group.filter((entry) => entry.requestIds.includes(id)).map(({ segment }) => segment)),
			});
		}
		for (const edge of edges) {
			if (edge.from > to) {
				append();
				from = edge.from;
				to = edge.to;
				candidates = new Set<Entry>();
			}
			to = Math.max(to, edge.to);
			candidates.add(edge.left);
			candidates.add(edge.right);
		}
		append();
	}
	return issues.sort((a, b) => a.rangeMs[0] - b.rangeMs[0] || a.rangeMs[1] - b.rangeMs[1]);
}

/** Provider segments already contain global source times; offsets are never added here.
 * Pass expected coverage for complete-recording generation. Without it, [] means
 * no known missing ranges, not proof that all recording audio was transcribed.
 */
export function mergeTranscripts(raw: readonly RawTranscript[], coverage?: MergeCoverage): TranscriptVersion {
	const missingRanges = expectedCoverage(raw, coverage);
	const rawIds = raw.map(({ id }) => id);
	if (new Set(rawIds).size !== rawIds.length) throw new Error("Duplicate raw transcript ID");
	const entries: Entry[] = [];
	const duplicateCandidates = new Map<string, Entry[]>();
	for (const transcript of raw) {
		let segments = transcript.segments;
		let timing = transcript.timing;
		if (!segments.length && transcript.text.length) {
			const chunk = coverage?.expectedChunks.find(({ id }) => id === transcript.chunkId);
			if (!chunk) throw new Error("Whole chunk source range required for transcript without segment timing");
			segments = [{ id: "", text: transcript.text, sourceStartMs: chunk.sourceStartMs, sourceEndMs: chunk.sourceEndMs, rawIds: [transcript.id] }];
			timing = "chunk";
		}
		for (const original of segments) {
			validateRange(original.sourceStartMs, original.sourceEndMs);
			const normalized = original.text.normalize("NFC").replace(/\s+/gu, " ").trim();
			const canDeduplicate = timing !== "chunk" && transcript.speakerScope === "none" &&
				original.sourceEndMs > original.sourceStartMs && normalized.length > 0;
			const key = JSON.stringify([original.sourceStartMs, original.sourceEndMs, normalized]);
			const candidates = duplicateCandidates.get(key) ?? [];
			const duplicate = canDeduplicate ? candidates.find((entry) => entry.canDeduplicate && !entry.requestIds.includes(transcript.id)) : undefined;
			const references = [...new Set([...original.rawIds, transcript.id])];
			if (duplicate) {
				duplicate.segment = { ...duplicate.segment, rawIds: [...new Set([...duplicate.segment.rawIds, ...references])] };
				duplicate.requestIds.push(transcript.id);
			} else {
				const entry: Entry = {
					segment: { ...original, id: crypto.randomUUID(), rawIds: references },
					requestIds: [transcript.id], canDeduplicate,
				};
				entries.push(entry);
				candidates.push(entry);
				duplicateCandidates.set(key, candidates);
			}
		}
	}
	entries.sort((a, b) => a.segment.sourceStartMs - b.segment.sourceStartMs || a.segment.sourceEndMs - b.segment.sourceEndMs);
	const version = createTranscriptVersion({
		parentId: null, rawIds, segments: entries.map(({ segment }) => segment),
		issues: boundaryIssues(entries, rawIds), missingRanges,
	});
	return coverage ? createTranscriptVersion(withChunkSources(version, raw, coverage.expectedChunks)) : version;
}
