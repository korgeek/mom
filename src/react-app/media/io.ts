import type { JobContext } from '../domain/types';
import { MediaError } from './errors';
import { MAX_SOURCE_READ_BYTES, type SourceReader } from './source';

export type NamedSourceReader = SourceReader & Readonly<{ name: string }>;
export type MediaInput = File | NamedSourceReader;
export type MediaBytes = Blob | SourceReader;
// Only the existing bounded M4A metadata allocation may exceed a single pull.
const MAX_ASSEMBLY_BYTES = 8 * MAX_SOURCE_READ_BYTES;
const damaged = () => new MediaError('damaged-input', 'The bounded audio read is invalid or incomplete.');

export function isSourceReader(input: MediaBytes): input is SourceReader {
  return 'read' in input && typeof input.read === 'function';
}
export function namedSourceReader(reader: SourceReader, name: string): NamedSourceReader {
  return Object.freeze({ name, size: reader.size, read: (start: number, end: number, job: JobContext) => reader.read(start, end, job) });
}
/** A held late read belongs to this consumer. Clear it before rejecting, while
 * making no claim that all browser/codec memory can be zeroized. */
export function fenceMediaBuffer(bytes: ArrayBuffer, job: JobContext): void {
  try { job.assertActive(); }
  catch (error) { if (bytes instanceof ArrayBuffer) new Uint8Array(bytes).fill(0); throw error; }
}
/** Sequential <=1MiB reads; never allocate a source-sized Blob or PCM buffer.
 * An explicit larger bound is solely for already-capped M4A metadata. */
export async function readMediaRange(input: MediaBytes, start: number, end: number, job: JobContext, allocationLimit = MAX_SOURCE_READ_BYTES): Promise<ArrayBuffer> {
  job.assertActive();
  if (![input.size, start, end, allocationLimit].every(Number.isSafeInteger) || input.size < 0 || start < 0 || end < start || end > input.size || allocationLimit < 1 || allocationLimit > MAX_ASSEMBLY_BYTES || end - start > allocationLimit) throw damaged();
  if (start === end) return new ArrayBuffer(0);
  const output = end - start > MAX_SOURCE_READ_BYTES ? new Uint8Array(end - start) : null;
  try {
    for (let at = start; at < end;) {
      job.assertActive();
      const next = Math.min(end, at + MAX_SOURCE_READ_BYTES);
      const bytes = await (isSourceReader(input) ? input.read(at, next, job) : input.slice(at, next).arrayBuffer());
      fenceMediaBuffer(bytes, job);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== next - at) { if (bytes instanceof ArrayBuffer) new Uint8Array(bytes).fill(0); throw damaged(); }
      if (!output) return bytes;
      output.set(new Uint8Array(bytes), at - start); new Uint8Array(bytes).fill(0); at = next;
    }
    job.assertActive(); return output!.buffer;
  } catch (error) { output?.fill(0); job.assertActive(); throw error; }
}
