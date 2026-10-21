import type { JobContext } from "../domain/types";

// Admission bounds one output allocation, not the total retained source size.
// Consumers split larger requests and await each read before requesting another.
export const MAX_SOURCE_READ_BYTES = 1024 * 1024;

export interface SourceReader {
    readonly size: number;
    // Half-open [start, end), with safe integer offsets and at most 1 MiB/read.
    // The opening job and this read's job must both remain active. The returned
    // buffer belongs to the consumer; lock cannot retract an already returned copy.
    read(start: number, end: number, job: JobContext): Promise<ArrayBuffer>;
}
