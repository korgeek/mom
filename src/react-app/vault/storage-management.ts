import type { DeletionConfirmation, DeletionPlan, MeetingProject, RetainedAudio } from "../domain/types";

// A missing legacy field is unknown, not evidence that descriptor audio exists.
export function audioAvailability(project: MeetingProject, verifiedLegacy?: RetainedAudio): RetainedAudio | null {
    const value = project.retainedAudio ?? verifiedLegacy;
    if (!value) return null;
    const sources = new Set(project.sourceAssets.map(source => source.id));
    const chunks = new Set(project.preparedChunks.map(chunk => chunk.id));
    if (!Array.isArray(value.sourceIds) || !Array.isArray(value.chunkIds) || new Set(value.sourceIds).size !== value.sourceIds.length || new Set(value.chunkIds).size !== value.chunkIds.length || value.sourceIds.some(id => !sources.has(id)) || value.chunkIds.some(id => !chunks.has(id)))
        throw new Error("Invalid retained audio availability");
    return Object.freeze({ sourceIds: Object.freeze([...value.sourceIds]), chunkIds: Object.freeze([...value.chunkIds]) });
}
export function hasRetainedAudio(project: MeetingProject, kind: "source" | "chunk", id: string, verifiedLegacy?: RetainedAudio): boolean {
    const value = audioAvailability(project, verifiedLegacy);
    return !!value && (kind === "source" ? value.sourceIds : value.chunkIds).includes(id);
}
export class DeletionPlans {
    private issued: { plan: DeletionPlan; revision: string } | null = null;
    issue(plan: DeletionPlan, revision: string): DeletionPlan { this.issued = { plan, revision }; return plan; }
    accept(plan: DeletionPlan, confirmation: DeletionConfirmation): Readonly<{ plan: DeletionPlan; revision: string }> {
        const issued = this.issued;
        if (!issued || !confirmation || confirmation.accepted !== true || confirmation.token !== plan?.versionToken || JSON.stringify(plan) !== JSON.stringify(issued.plan))
            throw new Error("An exact current deletion plan and explicit confirmation are required");
        if (plan.scope === "vault" && confirmation.typedPhrase?.toLowerCase() !== "delete")
            throw new Error("The vault deletion phrase is required");
        this.issued = null;
        // Never carry a caller's mutable plan alias across asynchronous cleanup.
        return Object.freeze({ plan: issued.plan, revision: issued.revision });
    }
    clear(): void { this.issued = null; }
}
export async function originStorageEstimate(): Promise<{ originUsage: number | null; originQuota: number | null }> {
    let originUsage: number | null = null, originQuota: number | null = null;
    try {
        if (typeof navigator !== "undefined" && navigator.storage?.estimate) {
            const estimate = await navigator.storage.estimate();
            if (typeof estimate.usage === "number" && Number.isFinite(estimate.usage) && estimate.usage >= 0) originUsage = estimate.usage;
            if (typeof estimate.quota === "number" && Number.isFinite(estimate.quota) && estimate.quota >= 0) originQuota = estimate.quota;
        }
    } catch { /* Origin-wide estimates are optional and not owned-byte evidence. */ }
    return { originUsage, originQuota };
}
