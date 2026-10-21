import { afterEach, expect, it } from 'vitest';
import { cancelJobs, createJobContext } from '../src/react-app/domain/jobs';
import { runTranscriptionQueue } from '../src/react-app/domain/pipeline';
import type { MeetingProject, VaultStore } from '../src/react-app/domain/types';
import { createSTTBatch, replaceSTTBatch, validateSTTBatch, sttActionToken } from '../src/react-app/transcript/batches';

afterEach(cancelJobs);
const date = '2026-10-17T00:00:00.000Z';
function project(): MeetingProject {
  return { id: 'registered-project', title: 'Synthetic registered batch', icon: 'mic', color: 'blue', pinned: false, createdAt: date, updatedAt: date,
    sourceAssets: [{ id: 'source', fileName: 'SYNTHETIC.mp3', bytes: 3, container: 'mp3', codec: 'mp3', durationMs: 1000, channels: 1, sampleRateHz: 16000 }],
    audioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: [], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [{ id: 'chunk', sourceId: 'source', index: 0, sourceStartMs: 0, sourceEndMs: 1000, encodingOffsetMs: 0, encodedBytes: 3, mimeType: 'audio/mpeg', codec: 'mp3', audioRecordId: 'audio' }],
    rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null, minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
const snapshot = { id: 'local-stt', name: 'Synthetic local STT', stage: 'stt', adapter: 'openai-compatible', endpointUrl: 'http://127.0.0.1:8000/v1/audio/transcriptions', baseUrl: 'http://127.0.0.1:8000/v1', modelId: 'custom-asr', auth: 'none', credentialOrigin: null, credentialVersion: 0, revision: 1, enabled: true, keyStorage: 'encrypted', stt: { responseFormat: 'json', languageMode: 'none', termMode: 'none', timestamps: 'none', formats: ['mp3'], maxBytes: 16000000 } } as const;
const route = { connectionId: snapshot.id, provider: 'openai-compatible', stage: 'stt', modelId: snapshot.modelId, endpointTag: null } as const;

it.each([false,true])('binds the exact registered snapshot and frozen hints before dispatch, legacy=%s', async legacy => {
  const base=project(), hints={terms:['SYNTHETIC_ORIGINAL'],context:'Original context'};
  const p={...base,audioOptions:{...base.audioOptions,transcriptionHints:hints}};
  const created = createSTTBatch(p, { purpose: 'initial', chunkIds: ['chunk'], modelId: snapshot.modelId, languages: [], route, modelSnapshot: snapshot } as never);
  const batch=legacy?{...created,transcriptionHints:undefined}:created;
  const changed={...p,audioOptions:{...p.audioOptions,transcriptionHints:{terms:['SYNTHETIC_CHANGED'],context:'Changed context'}}};
  const action={purpose:'initial' as const,chunkIds:['chunk'],modelId:snapshot.id};
  expect(sttActionToken('same',p,action)).not.toBe(sttActionToken('same',changed,action));
  let calls = 0;
  const vault: VaultStore = { listProjects: async () => [], readProject: async () => null, readAudio: async () => new Blob(['abc'], { type: 'audio/mpeg' }), deleteProject: async () => {},
    checkpoint: async ({ project, runId }) => {
      const checkpoint = { id: crypto.randomUUID(), projectId: project.id, runId, recordIds: [project.id], committedAt: date };
      return { project: { ...project, runs: project.runs.map(run => run.id === runId ? { ...run, state: 'saved', checkpoint } : run) }, checkpoint };
    } };
  const result = await runTranscriptionQueue({ project: replaceSTTBatch(changed, batch), batch, chunkIds: ['chunk'], modelId: snapshot.modelId, languages: [], job: createJobContext(), vault,
    provider: { transcribe: async request => {
      calls++; expect(request.transcriptionHints).toEqual(legacy?undefined:hints);
      return { id: 'raw', chunkId: request.chunk.id, runId: request.runId, response: { text: 'synthetic speech' }, text: 'synthetic speech', segments: [], timing: 'chunk', speakerScope: 'none', execution: null };
    } } });
  expect(result.failure).toBeNull(); expect(calls).toBe(1);
  expect(result.project.runs[0].intent?.requestedEndpoint).toBe(snapshot.endpointUrl);
  expect(result.project.runs[0].intent?.modelSnapshot).toEqual(snapshot);
  const stored = result.project.sttBatches![0];
  expect(() => validateSTTBatch(result.project, { ...stored, modelSnapshot: { ...snapshot, endpointUrl: 'https://other.example/v1/audio/transcriptions' } } as never)).toThrow();
});
