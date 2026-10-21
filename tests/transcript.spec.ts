import { describe, expect, it } from "vitest";
import type { RawTranscript, SourceSegment, TranscriptVersion } from "../src/react-app/domain/types";
import { mergeTranscripts, withChunkSources } from "../src/react-app/transcript/merge";
import { editTranscript, reconcileBoundary, resolveBoundary } from "../src/react-app/transcript/versions";

// All speech and provider metadata below are keyless test fixtures.
function raw(id: string, segments: readonly [string, number, number][], overrides: Partial<RawTranscript> = {}): RawTranscript {
	return {
		id, chunkId: `chunk-${id}`, runId: `run-${id}`, response: { fixture: true, speaker: "A" },
		text: segments.map(([text]) => text).join(" "),
		segments: segments.map(([text, sourceStartMs, sourceEndMs], i) => ({
			id: `${id}-${i}`, text, sourceStartMs, sourceEndMs, rawIds: [id],
		})), timing: "segment", speakerScope: "none", execution: null, ...overrides,
	};
}

function texts(segments: readonly SourceSegment[]): string[] {
	return segments.map((segment) => segment.text);
}

const expectedChunks = [
	{ id: "chunk-a", sourceStartMs: 0, sourceEndMs: 600_000 },
	{ id: "chunk-b", sourceStartMs: 590_000, sourceEndMs: 1_190_000 },
	{ id: "chunk-c", sourceStartMs: 1_180_000, sourceEndMs: 1_300_000 },
];
const coverage = { expectedChunks, sourceEndMs: 1_300_000 };

describe("conservative transcript merge", () => {
	it("consolidates equal precise source times and content while retaining original text and both raw references", () => {
		const first = raw("a", [["  Budget approved. ", 590_000, 594_000]]);
		const second = raw("b", [["Budget   approved.", 590_000, 594_000]]);
		const result = mergeTranscripts([second, first]);
		expect(result.segments).toHaveLength(1);
		expect(result.segments[0]).toMatchObject({ sourceStartMs: 590_000, sourceEndMs: 594_000 });
		expect(result.segments[0].text).toBe("Budget   approved.");
		expect(result.segments[0].rawIds).toEqual(["b", "a"]);
		expect(result.rawIds).toEqual(["b", "a"]);
		expect(result.issues).toEqual([]);
		expect(result.parentId).toBeNull();
	});

	it("compares NFC without changing either original spelling", () => {
		const result = mergeTranscripts([raw("a", [["Café", 1_000, 2_000]]), raw("b", [["Cafe\u0301", 1_000, 2_000]])]);
		expect(texts(result.segments)).toEqual(["Café"]);
		expect(result.segments[0].rawIds).toEqual(["a", "b"]);
	});

	it.each([
		["We will ship.", "We will not ship."],
		["The budget is 15.", "The budget is 50."],
		["Mina will review.", "Nina will review."],
	])("retains conflicting speech %s / %s as unresolved alternatives", (first, second) => {
		const result = mergeTranscripts([raw("a", [[first, 590_000, 595_000]]), raw("b", [[second, 590_000, 595_000]])]);
		expect(texts(result.segments)).toEqual([first, second]);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].selected).toBeNull();
		expect(result.issues[0].rangeMs).toEqual([590_000, 595_000]);
		expect(result.issues[0].alternatives.map(texts)).toEqual([[first], [second]]);
	});

	it("retains repeated genuine speech at separate source times", () => {
		const result = mergeTranscripts([raw("a", [["Yes.", 1_000, 2_000], ["Yes.", 3_000, 4_000]]), raw("b", [["Yes.", 5_000, 6_000]])]);
		expect(texts(result.segments)).toEqual(["Yes.", "Yes.", "Yes."]);
		expect(result.issues).toEqual([]);
	});

	it("does not collapse two repeated entries from one provider response", () => {
		const result = mergeTranscripts([raw("a", [["Yes.", 1_000, 2_000], ["Yes.", 1_000, 2_000]])]);
		expect(result.segments).toHaveLength(2);
		expect(result.issues).toEqual([]);
	});

	it("does not consider similar text or partly overlapping times proof of a duplicate", () => {
		const result = mergeTranscripts([raw("a", [["Approved", 10_000, 12_000]]), raw("b", [["Approved", 11_000, 13_000]])]);
		expect(result.segments).toHaveLength(2);
		expect(result.issues).toHaveLength(1);
	});

	it("keeps chunk-only ranges without manufacturing precise utterance times", () => {
		const result = mergeTranscripts([
			raw("a", [["Repeated chunk text", 0, 600_000]], { timing: "chunk" }),
			raw("b", [["Repeated chunk text", 590_000, 1_190_000]], { timing: "chunk" }),
		]);
		expect(result.segments.map((segment) => [segment.sourceStartMs, segment.sourceEndMs])).toEqual([[0, 600_000], [590_000, 1_190_000]]);
		expect(result.issues[0].alternatives.map(texts)).toEqual([["Repeated chunk text"], ["Repeated chunk text"]]);
	});

	it("keeps three whole-chunk transcripts in two local overlap issues instead of one meeting-wide choice", () => {
		const inputs = [
			raw("a", [["First ten minutes including the first boundary.", 0, 600_000]], { timing: "chunk" }),
			raw("b", [["Middle ten minutes including both boundaries.", 590_000, 1_190_000]], { timing: "chunk" }),
			raw("c", [["Final minutes including the second boundary.", 1_180_000, 1_300_000]], { timing: "chunk" }),
		];
		const result = mergeTranscripts(inputs, coverage);
		expect(result.issues.map(({ rangeMs }) => rangeMs)).toEqual([[590_000, 600_000], [1_180_000, 1_190_000]]);
		expect(result.issues.map(({ alternatives }) => alternatives.map(texts))).toEqual([
			[[inputs[0].text], [inputs[1].text]], [[inputs[1].text], [inputs[2].text]],
		]);
		expect(texts(result.segments)).toEqual(inputs.map(({ text }) => text));
		for (const issue of result.issues) {
			for (const alternative of [0, 1]) expect(() => resolveBoundary(result, issue.id, alternative)).toThrow(/outside|reconcil/i);
		}
		expect(texts(result.segments)).toEqual(inputs.map(({ text }) => text));
	});

	it("rejects a fine-timing choice that would remove candidate speech outside the actual intersection", () => {
		const result = mergeTranscripts([raw("a", [["First two seconds.", 10_000, 12_000]]), raw("b", [["Last two seconds.", 11_000, 13_000]])]);
		expect(result.issues[0].rangeMs).toEqual([11_000, 12_000]);
		for (const alternative of [0, 1]) expect(() => resolveBoundary(result, result.issues[0].id, alternative)).toThrow(/outside|reconcil/i);
		expect(texts(result.segments)).toEqual(["First two seconds.", "Last two seconds."]);
	});

	it("does not infer shared identity from independent request-local speaker labels", () => {
		const first = raw("a", [["A: Approved.", 590_000, 594_000]], { speakerScope: "chunk" });
		const second = raw("b", [["A: Approved.", 590_000, 594_000]], { speakerScope: "chunk" });
		const result = mergeTranscripts([first, second]);
		expect(result.segments).toHaveLength(2);
		expect(result.issues[0].alternatives.map((alternative) => alternative[0].rawIds)).toEqual([["a"], ["b"]]);
		expect(first.response).toEqual({ fixture: true, speaker: "A" });
		expect(second.response).toEqual({ fixture: true, speaker: "A" });
	});

	it("groups connected overlapping alternatives without splitting whole source segments", () => {
		const result = mergeTranscripts([
			raw("a", [["Mina proposed it.", 10_000, 12_000], ["No decision yet.", 12_000, 14_000], ["Next topic.", 20_000, 21_000]]),
			raw("b", [["Nina proposed it; no decision yet.", 10_000, 14_000]]),
		]);
		expect(result.issues).toHaveLength(1);
		expect(result.issues[0].alternatives.map(texts)).toEqual([["Mina proposed it.", "No decision yet."], ["Nina proposed it; no decision yet."]]);
		expect(texts(result.segments)).toContain("Next topic.");
	});

	it("retains independent retry results of the same chunk for review", () => {
		const result = mergeTranscripts([raw("a", [["15", 1_000, 2_000]]), raw("retry", [["50", 1_000, 2_000]], { chunkId: "chunk-a" })]);
		expect(result.issues[0].alternatives.map(texts)).toEqual([["15"], ["50"]]);
	});

	it("detaches and freezes output without mutating raw provider data", () => {
		const first = raw("a", [["No approval.", 1_000, 2_000]]);
		const second = raw("b", [["Approval.", 1_000, 2_000]]);
		const before = structuredClone([first, second]);
		const result = mergeTranscripts([first, second]);
		expect([first, second]).toEqual(before);
		(first.segments[0] as { text: string }).text = "caller changed it";
		expect(texts(result.segments)).toEqual(["No approval.", "Approval."]);
		expect(() => { (result.segments as SourceSegment[]).pop(); }).toThrow(TypeError);
		expect(() => { (result.issues[0].alternatives[0][0] as { text: string }).text = "lost"; }).toThrow(TypeError);
		expect(() => { (result.rawIds as string[]).push("other"); }).toThrow(TypeError);
	});

	it("gives output segments independent IDs even if raw request IDs collide locally", () => {
		const a = raw("a", [["First", 0, 1_000]]);
		const b = raw("b", [["Second", 1_000, 2_000]], { segments: [{ ...a.segments[0], text: "Second", sourceStartMs: 1_000, sourceEndMs: 2_000, rawIds: ["b"] }] });
		const result = mergeTranscripts([a, b]);
		expect(new Set(result.segments.map(({ id }) => id)).size).toBe(2);
	});

	it("rejects invalid source times rather than inventing or correcting them", () => {
		for (const [start, end] of [[-1, 2], [3, 2], [1.5, 2], [0, Number.NaN]]) {
			expect(() => mergeTranscripts([raw("a", [["speech", start, end]])])).toThrow(/source.*range|source.*time/i);
		}
	});
});

describe("expected recording coverage", () => {
	it('enriches legacy selected sources without replacing edits or selecting an unselected result', () => {
		const selected = raw('a', [['Edited speech', 0, 1000]]), unselected = raw('b', [['Not selected', 590000, 591000]]);
		const legacy = mergeTranscripts([selected]), before = structuredClone(legacy);
		const enriched = withChunkSources(legacy, [unselected, selected], coverage.expectedChunks);
		expect(enriched.id).toBe(legacy.id); expect(enriched.segments).toBe(legacy.segments); expect(legacy).toEqual(before);
		expect(enriched.chunkSources).toEqual([{ rawId: 'a', chunkId: 'chunk-a', sourceStartMs: 0, sourceEndMs: 600000, timing: selected.timing }]);
		expect(mergeTranscripts([selected], coverage).chunkSources).toEqual(enriched.chunkSources);
		expect(editTranscript(enriched, [{ segmentId: enriched.segments[0].id, text: 'New edit' }]).chunkSources).toEqual(enriched.chunkSources);
	});
	it("warns about a missing middle chunk only where successful overlapping chunks do not cover it", () => {
		const result = mergeTranscripts([raw("a", [["First", 20_000, 21_000]]), raw("c", [["Last", 1_250_000, 1_251_000]])], coverage);
		expect(result.missingRanges).toEqual([[600_000, 1_180_000]]);
	});

	it("detects missing first and last chunks from explicit expected coverage", () => {
		expect(mergeTranscripts([raw("b", [["Middle", 700_000, 701_000]])], coverage).missingRanges).toEqual([[0, 590_000], [1_190_000, 1_300_000]]);
	});

	it("records all missing audio when no successful raw result exists", () => {
		expect(mergeTranscripts([], coverage).missingRanges).toEqual([[0, 1_300_000]]);
	});

	it("uses source end to warn about a trailing range even when no chunk was prepared for it", () => {
		const result = mergeTranscripts([raw("a", [["Speech", 10_000, 11_000]])], { expectedChunks: [expectedChunks[0]], sourceEndMs: 700_000 });
		expect(result.missingRanges).toEqual([[600_000, 700_000]]);
	});

	it("does not warn for an absent chunk fully covered by a successful expected chunk", () => {
		const result = mergeTranscripts([raw("a", [["Speech", 10_000, 11_000]])], { expectedChunks: [expectedChunks[0], { id: "absent", sourceStartMs: 590_000, sourceEndMs: 600_000 }] });
		expect(result.missingRanges).toEqual([]);
	});

	it("uses completed chunk coverage instead of interpreting pauses or silent responses as gaps", () => {
		const result = mergeTranscripts([raw("a", [["First", 20_000, 21_000]]), raw("b", []), raw("c", [["Last", 1_250_000, 1_251_000]])], coverage);
		expect(result.missingRanges).toEqual([]);
	});

	it("does not infer recording bounds or transcription gaps from raw speech alone", () => {
		expect(mergeTranscripts([raw("b", [["Only known speech", 700_000, 701_000]])]).missingRanges).toEqual([]);
		expect(mergeTranscripts([]).missingRanges).toEqual([]);
	});

	it("preserves text without segment timestamps using an explicitly known whole chunk range", () => {
		const input = raw("a", [], { text: "Only a whole-chunk transcript is available.", timing: "chunk" });
		const result = mergeTranscripts([input], coverage);
		expect(result.segments[0]).toMatchObject({ text: input.text, sourceStartMs: 0, sourceEndMs: 600_000, rawIds: ["a"] });
		expect(() => mergeTranscripts([input])).toThrow(/source.*range|chunk.*range/i);
	});

	it("rejects inconsistent expected chunk metadata", () => {
		expect(() => mergeTranscripts([], { expectedChunks: [{ id: "a", sourceStartMs: 2_000, sourceEndMs: 1_000 }] })).toThrow(/range/i);
		expect(() => mergeTranscripts([], { expectedChunks: [expectedChunks[0], expectedChunks[0]] })).toThrow(/duplicate/i);
		expect(() => mergeTranscripts([], { expectedChunks, sourceEndMs: -1 })).toThrow(/range/i);
	});
});

describe("immutable transcript versions", () => {
	function unresolved(): TranscriptVersion {
		return mergeTranscripts([raw("a", [["We will not ship.", 1_000, 2_000], ["Next topic.", 5_000, 6_000]]), raw("b", [["We will ship.", 1_000, 2_000]])], coverage);
	}

	it("edits create new versions preserving parent, timing, provenance and missing coverage", () => {
		const base = unresolved();
		const before = structuredClone(base);
		const segment = base.segments.find(({ text }) => text === "Next topic.")!;
		const next = editTranscript(base, [{ segmentId: segment.id, text: "Next topic: launch." }]);
		expect(base).toEqual(before);
		expect(next.id).not.toBe(base.id);
		expect(next.parentId).toBe(base.id);
		expect(next.rawIds).toEqual(base.rawIds);
		expect(next.missingRanges).toEqual(base.missingRanges);
		expect(next.segments.find(({ id }) => id === segment.id)).toEqual({ ...segment, text: "Next topic: launch." });
		expect(next.issues).toEqual(base.issues);
	});

	it("allows an empty human edit without deleting source or raw evidence", () => {
		const base = mergeTranscripts([raw("a", [["A mistaken word", 1_000, 2_000]])]);
		const next = editTranscript(base, [{ segmentId: base.segments[0].id, text: "" }]);
		expect(next.segments[0]).toEqual({ ...base.segments[0], text: "" });
		expect(base.segments[0].text).toBe("A mistaken word");
	});

	it("boundary choices retain unselected alternatives and do not affect other speech", () => {
		const base = unresolved();
		const before = structuredClone(base);
		const next = resolveBoundary(base, base.issues[0].id, 1);
		expect(texts(next.segments)).toEqual(["We will ship.", "Next topic."]);
		expect(next.parentId).toBe(base.id);
		expect(next.id).not.toBe(base.id);
		expect(next.issues[0].selected).toBe(1);
		expect(next.issues[0].alternatives.map(texts)).toEqual([["We will not ship."], ["We will ship."]]);
		expect(next.rawIds).toEqual(base.rawIds);
		expect(next.missingRanges).toEqual(base.missingRanges);
		expect(base).toEqual(before);
	});

	it("keeps human boundary edits in the new alternatives so another choice cannot revive stale text", () => {
		const base = unresolved();
		const original = base.segments.find(({ text }) => text === "We will not ship.")!;
		const edited = editTranscript(base, [{ segmentId: original.id, text: "We will not ship today." }]);
		const firstChoice = resolveBoundary(edited, base.issues[0].id, 1);
		const secondChoice = resolveBoundary(firstChoice, base.issues[0].id, 0);
		expect(texts(secondChoice.segments)).toEqual(["We will not ship today.", "Next topic."]);
		expect(base.issues[0].alternatives[0][0].text).toBe("We will not ship.");
		expect(secondChoice.parentId).toBe(firstChoice.id);
	});

	it("rejects unknown, repeated or invisible edit targets and invalid boundary choices", () => {
		const base = unresolved();
		const id = base.segments[0].id;
		expect(() => editTranscript(base, [{ segmentId: "missing", text: "x" }])).toThrow(/segment/i);
		expect(() => editTranscript(base, [{ segmentId: id, text: "x" }, { segmentId: id, text: "y" }])).toThrow(/duplicate/i);
		expect(() => resolveBoundary(base, "missing", 0)).toThrow(/issue/i);
		for (const alternative of [-1, 2, 0.5]) expect(() => resolveBoundary(base, base.issues[0].id, alternative)).toThrow(/alternative/i);
		const chosen = resolveBoundary(base, base.issues[0].id, 1);
		expect(() => editTranscript(chosen, [{ segmentId: id, text: "x" }])).toThrow(/segment/i);
	});

	it("deeply freezes detached edit and choice results, including alternate history and missing ranges", () => {
		const base = unresolved();
		const edited = editTranscript(base, [{ segmentId: base.segments[0].id, text: "Corrected text." }]);
		const chosen = resolveBoundary(edited, base.issues[0].id, 1);
		for (const result of [edited, chosen]) {
			expect(result.segments).not.toBe(base.segments);
			expect(() => { (result.issues[0] as { selected: number }).selected = 0; }).toThrow(TypeError);
			expect(() => { (result.missingRanges[0] as unknown as [number, number])[0] = 99; }).toThrow(TypeError);
			expect(() => { (result.segments[0].rawIds as string[]).push("lost"); }).toThrow(TypeError);
		}
	});

	it("explicitly reconciles coarse boundaries while retaining all whole source ranges and original candidate history", () => {
		const base = mergeTranscripts([
			raw("a", [["First ten minutes and duplicated phrase.", 0, 600_000]], { timing: "chunk" }),
			raw("b", [["Duplicated phrase and middle ten minutes.", 590_000, 1_190_000]], { timing: "chunk" }),
			raw("c", [["Final minutes.", 1_180_000, 1_300_000]], { timing: "chunk" }),
		], coverage);
		const original = structuredClone(base);
		const first = reconcileBoundary(base, base.issues[0].id, [{ segmentId: base.segments[0].id, text: "First ten minutes, manually reconciled boundary phrase." }]);
		expect(texts(first.segments)).toEqual(["First ten minutes, manually reconciled boundary phrase.", "Duplicated phrase and middle ten minutes.", "Final minutes."]);
		expect(first.segments.map(({ sourceStartMs, sourceEndMs }) => [sourceStartMs, sourceEndMs])).toEqual([[0, 600_000], [590_000, 1_190_000], [1_180_000, 1_300_000]]);
		expect(first.issues[0].selected).toBe(2);
		expect(first.issues[0].alternatives.slice(0, 2)).toEqual(base.issues[0].alternatives);
		expect(first.issues[0].alternatives[2].map(({ id }) => id)).toEqual(base.segments.slice(0, 2).map(({ id }) => id));
		expect(first.issues[1].selected).toBeNull();
		const second = reconcileBoundary(first, base.issues[1].id, []);
		expect(second.issues.every(({ selected }) => selected !== null)).toBe(true);
		expect(texts(second.segments)).toEqual(texts(first.segments));
		expect(second.rawIds).toEqual(["a", "b", "c"]);
		expect(second.parentId).toBe(first.id);
		expect(base).toEqual(original);
		expect(() => { (second.issues[0].alternatives[2][0] as { text: string }).text = "mutated"; }).toThrow(TypeError);
	});

	it("keeps reconciliation edits confined to the chosen issue and rejects hidden candidates", () => {
		const base = unresolved();
		const nextTopic = base.segments.find(({ text }) => text === "Next topic.")!;
		expect(() => reconcileBoundary(base, base.issues[0].id, [{ segmentId: nextTopic.id, text: "unrelated edit" }])).toThrow(/boundary|issue/i);
		expect(() => reconcileBoundary(base, "unknown", [])).toThrow(/issue/i);
		const selected = resolveBoundary(base, base.issues[0].id, 1);
		expect(() => reconcileBoundary(selected, base.issues[0].id, [{ segmentId: base.segments[0].id, text: "hidden" }])).toThrow(/segment/i);
	});
});
