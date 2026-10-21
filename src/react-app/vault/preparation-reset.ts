import type { AudioOptions } from "../domain/types";

export type PreparationResetPlan = Readonly<{
    projectId: string;
    audioOptions: AudioOptions;
    versionToken: string;
    counts: Readonly<{ chunks: number; transcriptVersions: number; minutesRevisions: number }>;
}>;

export class PreparationResetPlans {
    private issued: Readonly<{ plan: PreparationResetPlan; revision: string }> | null = null;
    issue(plan: PreparationResetPlan, revision: string): PreparationResetPlan { this.issued = { plan, revision }; return plan; }
    accept(plan: PreparationResetPlan, token: string): Readonly<{ plan: PreparationResetPlan; revision: string }> {
        const issued = this.issued;
        if (!issued || token !== issued.plan.versionToken || JSON.stringify(plan) !== JSON.stringify(issued.plan))
            throw new Error("An exact current preparation reset plan and confirmation token are required");
        this.issued = null;
        return issued;
    }
    clear(): void { this.issued = null; }
}
