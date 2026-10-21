import type { CheckpointResult, JobContext, SourceAsset, SourceWriter } from '../domain/types';

export const SOURCE_APPEND_LIMIT = 1024 * 1024;
type Backend = {
  append(bytes: Uint8Array<ArrayBuffer>, guard: () => void): Promise<void>;
  finalize(asset: SourceAsset, guard: () => void): Promise<CheckpointResult>;
  delivered(): void;
  release(): void;
};
// One live handle, one copied append buffer, no waiting append queue. The vault
// supplies serialization, encryption, ownership and the actual commit barrier.
export function createBoundSourceWriter(openingJob: JobContext, backend: Backend): SourceWriter {
  openingJob.assertActive(); let closed = false, pendingBytes: Uint8Array<ArrayBuffer> | null = null, inFlight: Promise<unknown> | null = null;
  const revoke = () => { if (closed) return; closed = true; pendingBytes?.fill(0); pendingBytes = null; openingJob.signal.removeEventListener('abort', revoke); backend.release(); };
  const guard = (job: JobContext) => { if (closed) throw new Error('Source writer was revoked'); openingJob.assertActive(); job.assertActive(); if (job.signal !== openingJob.signal || job.epoch !== openingJob.epoch) throw new Error('Source writer job mismatch'); };
  const admit = (job: JobContext) => { guard(job); if (inFlight) throw new Error('A source write is already pending'); };
  openingJob.signal.addEventListener('abort', revoke, { once: true });
  return Object.freeze({
    append(bytes: Uint8Array, job: JobContext) {
      try {
        admit(job); if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > SOURCE_APPEND_LIMIT) throw new RangeError('Append requires 1 byte to 1MiB per block');
        const copy = new Uint8Array(bytes); pendingBytes = copy;
        const action = backend.append(copy, () => guard(job)).finally(() => { copy.fill(0); pendingBytes = null; inFlight = null; }); inFlight = action; return action;
      } catch (error) { return Promise.reject(error); }
    },
    finalize(asset: SourceAsset, job: JobContext) {
      try {
        admit(job); const copy = Object.freeze({ ...asset });
        const action = backend.finalize(copy, () => guard(job)).then(result => { guard(job); backend.delivered(); revoke(); return result; }).finally(() => { inFlight = null; }); inFlight = action; return action;
      } catch (error) { return Promise.reject(error); }
    },
    async abort() { revoke(); if (inFlight) await Promise.allSettled([inFlight]); },
  });
}
