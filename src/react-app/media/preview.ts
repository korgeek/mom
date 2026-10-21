import type { JobContext, SourceAsset } from '../domain/types';
import { isSourceReader, readMediaRange, type MediaInput } from './io';
import { MAX_SOURCE_READ_BYTES } from './source';
import { createBrowserMediaWorker, type MediaWorker } from './worker';

// shortcut: native seek playback reconstructs at most 64 MiB, use a range-serving encrypted transport for larger retained originals.
export const MAX_RESTORED_PREVIEW_BYTES = 64 * 1024 * 1024;
export async function loadSourcePreview(input: MediaInput, source: SourceAsset, job: JobContext, workerFactory: () => MediaWorker = createBrowserMediaWorker): Promise<{ audio: Blob | null; peaks: readonly number[] | null }> {
  job.assertActive();
  const parts: Blob[] = [];
  let worker: MediaWorker | null = null, audio: Blob | null = null;
  const stop = () => { worker?.terminate(); parts.length = 0; audio = null; };
  job.signal.addEventListener('abort', stop, { once: true });
  try {
    if (!isSourceReader(input)) audio = input;
    else if (input.size <= MAX_RESTORED_PREVIEW_BYTES) {
      for (let start = 0; start < input.size; start += MAX_SOURCE_READ_BYTES) {
        const bytes = await readMediaRange(input, start, Math.min(input.size, start + MAX_SOURCE_READ_BYTES), job);
        try { job.assertActive(); parts.push(new Blob([bytes])); } finally { new Uint8Array(bytes).fill(0); }
      }
      job.assertActive();
      audio = new Blob(parts, { type: source.container === 'mp3' ? 'audio/mpeg' : source.container === 'm4a' ? 'audio/mp4' : 'audio/wav' });
      parts.length = 0;
    }
    try {
      worker = workerFactory();
      if (!worker.waveform) throw new Error('Waveform processing is unavailable.');
      const peaks = await worker.waveform(input, source, job);
      job.assertActive(); return { audio, peaks };
    } catch { job.assertActive(); return { audio, peaks: null }; }
  } finally { job.signal.removeEventListener('abort', stop); stop(); }
}
