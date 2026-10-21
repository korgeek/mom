import type { JobContext, SourceAsset, SourceWriter, WavCaptureConfig } from '../domain/types';
import { MAX_WAV_BODY_BYTES } from '../media/wav-header';
import { PCM_PACKET_BYTES, PCM_PACKET_FRAMES } from './wav';
import workletUrl from './pcm-worklet.ts?worker&url';

export type RecordingState = 'idle' | 'permission' | 'recording' | 'paused' | 'saving' | 'saved' | 'error' | 'aborted';
export type RecordingFailure = 'unsupported' | 'permission' | 'sample-rate' | 'backpressure' | 'invalid-pcm' | 'storage' | 'empty' | 'busy' | 'capture-ended' | 'size-limit';
export class RecordingError extends Error {
  constructor(readonly code: RecordingFailure) { super(`Microphone recording failed: ${code}`); this.name = 'RecordingError'; }
}
export type RecordingSnapshot = Readonly<{
  state: RecordingState; sampleRateHz: number | null; acceptedSamples: number; committedSamples: number;
  bodyBytes: number; committedBytes: number; durationMs: number; inputLevel: number; source: SourceAsset | null; error: RecordingFailure | null;
}>;
export interface RecordingDependencies {
  supported(): boolean;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  createAudioContext(sampleRateHz?: number): AudioContext;
  createWorkletNode(context: AudioContext): AudioWorkletNode;
}
export type MicrophoneRecorderOptions = Readonly<{
  sourceId: string; fileName: string; job: JobContext; sampleRateHz?: 16000 | 44100 | 48000;
  // A fresh source ID/writer is required. Resuming an old draft is a separate
  // explicit recovery flow; this core cannot infer its prior sample clock.
  createWriter(config: WavCaptureConfig, job: JobContext): Promise<SourceWriter>;
  onState?(snapshot: RecordingSnapshot): void;
  dependencies?: RecordingDependencies;
}>;
export interface MicrophoneRecorder {
  getSnapshot(): RecordingSnapshot;
  start(): Promise<void>; pause(): Promise<void>; resume(): Promise<void>;
  stop(): Promise<SourceAsset>; abort(): Promise<void>;
}
type Packet = { packetId: number; frames: number; bytes: ArrayBuffer };
type Waiter = { type: 'ready' | 'running' | 'paused' | 'stopped'; commandId?: number; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
const cancelled = () => new DOMException('Microphone recording stopped', 'AbortError');
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

const nativeDependencies: RecordingDependencies = {
  supported: () => globalThis.isSecureContext === true && typeof navigator?.mediaDevices?.getUserMedia === 'function' && typeof AudioContext === 'function' && typeof AudioWorkletNode === 'function',
  getUserMedia: constraints => navigator.mediaDevices.getUserMedia(constraints),
  createAudioContext: rate => new AudioContext(rate ? { sampleRate: rate } : undefined),
  createWorkletNode: context => new AudioWorkletNode(context, 'mom-microphone-pcm16', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }),
};

/** Single-use capture owner. Manual pause keeps the owned microphone tracks;
 * stop, abort and the original job signal always stop them immediately. */
export function createMicrophoneRecorder(options: MicrophoneRecorderOptions): MicrophoneRecorder {
  const deps = options.dependencies ?? nativeDependencies;
  let snapshot: RecordingSnapshot = Object.freeze({ state: 'idle', sampleRateHz: null, acceptedSamples: 0, committedSamples: 0, bodyBytes: 0, committedBytes: 0, durationMs: 0, inputLevel: 0, source: null, error: null });
  let generation = 0, commandId = 0, packetId = 0;
  let stream: MediaStream | null = null, context: AudioContext | null = null, sourceNode: MediaStreamAudioSourceNode | null = null, node: AudioWorkletNode | null = null, writer: SourceWriter | null = null;
  let waiter: Waiter | null = null, append: Promise<void> | null = null, queued: Packet | null = null, activePacket: Packet | null = null;
  let stopPromise: Promise<SourceAsset> | null = null, abortPromise: Promise<void> | null = null;
  let writerDrain: Promise<void> | null = null;
  let lastFailure: RecordingError | null = null, captureStarted = false, pauseConfirmed = false, stopConfirmed = false;
  // Async callbacks can replace the snapshot during any awaited operation.
  const state = () => snapshot.state;
  const publish = (patch: Partial<RecordingSnapshot> = {}) => {
    const next = { ...snapshot, ...patch };
    snapshot = Object.freeze({ ...next, inputLevel: next.state === 'recording' ? next.inputLevel : 0, bodyBytes: next.acceptedSamples * 2, committedBytes: next.committedSamples * 2, durationMs: next.sampleRateHz ? Math.round(next.acceptedSamples * 1000 / next.sampleRateHz) : 0 });
    options.onState?.(snapshot);
  };
  const active = (token: number) => {
    if (snapshot.state === 'error' && lastFailure) throw lastFailure;
    if (token !== generation || snapshot.state === 'aborted') throw cancelled();
    options.job.assertActive();
  };
  const clearWaiter = (error: Error) => { const pending = waiter; waiter = null; if (pending) { clearTimeout(pending.timer); pending.reject(error); } };
  const ended = () => { if (['permission', 'recording', 'paused'].includes(snapshot.state)) fail('capture-ended'); };
  const stopTracks = () => {
    const owned = stream; stream = null;
    for (const track of owned?.getTracks() ?? []) { track.removeEventListener('ended', ended); track.stop(); }
    sourceNode?.disconnect(); sourceNode = null;
  };
  const closeGraph = () => {
    stopTracks();
    const ownedNode = node, ownedContext = context; node = null; context = null;
    if (ownedNode) { ownedNode.port.onmessage = null; ownedNode.port.onmessageerror = null; ownedNode.onprocessorerror = null; ownedNode.port.close(); ownedNode.disconnect(); }
    if (ownedContext) { ownedContext.onstatechange = null; void ownedContext.close().catch(() => {}); }
  };
  const clearPCM = () => {
    // Clear the buffers this owner can reach immediately. The writer copies and
    // revokes its own pending bytes; this is not full browser-memory zeroization.
    if (activePacket) new Uint8Array(activePacket.bytes).fill(0);
    if (queued) new Uint8Array(queued.bytes).fill(0); queued = null;
  };
  const revokeWriter = () => {
    const owned = writer; writer = null;
    if (owned) {
      try { writerDrain = owned.abort(); } catch (error) { writerDrain = Promise.reject(error); }
      // Failure callbacks cut off synchronously; retain their drain for a later
      // explicit Abort/lock handback rather than losing the owned operation.
      void writerDrain.catch(() => {});
    }
    return writerDrain ?? Promise.resolve();
  };
  const fail = (code: RecordingFailure) => {
    if (snapshot.state === 'error' || snapshot.state === 'aborted' || snapshot.state === 'saved') return;
    lastFailure = new RecordingError(code); generation++;
    closeGraph(); clearWaiter(lastFailure); clearPCM();
    void revokeWriter();
    publish({ state: 'error', error: code, source: null });
  };
  const wait = (type: Waiter['type'], id?: number) => new Promise<void>((resolve, reject) => {
    if (waiter) { reject(new RecordingError('busy')); return; }
    waiter = { type, commandId: id, resolve, reject, timer: setTimeout(() => fail('capture-ended'), 5000) };
  });
  const control = (type: 'start' | 'pause' | 'resume' | 'stop', expected: Waiter['type']) => {
    const id = ++commandId, result = wait(expected, id);
    try { node!.port.postMessage({ type, commandId: id, ...(type === 'start' ? { credits: 2 } : {}) }); }
    catch { fail('capture-ended'); }
    return result;
  };
  const startAppend = (packet: Packet, token: number) => {
    const ownedWriter = writer!;
    activePacket = packet;
    // Defer invocation until `action` is assigned, including a synchronous
    // storage throw. Only one action and one next packet are admitted.
    const action = Promise.resolve().then(async () => {
      try { active(token); await ownedWriter.append(new Uint8Array(packet.bytes), options.job); active(token); publish({ committedSamples: snapshot.committedSamples + packet.frames }); }
      catch { if (token === generation && snapshot.state !== 'aborted') fail('storage'); }
      finally {
        new Uint8Array(packet.bytes).fill(0);
        if (activePacket === packet) activePacket = null;
        if (append === action) append = null;
        if (token === generation && !['error', 'aborted'].includes(snapshot.state)) {
          const next = queued; queued = null; if (next) startAppend(next, token);
          try { node?.port.postMessage({ type: 'ack', packetId: packet.packetId }); } catch { fail('capture-ended'); }
        }
      }
    });
    append = action;
  };
  const message = (data: unknown, token: number) => {
    if (token !== generation || ['error', 'aborted', 'saved'].includes(snapshot.state)) { if (object(data) && data.bytes instanceof ArrayBuffer) new Uint8Array(data.bytes).fill(0); return; }
    try { active(token); } catch { void abort(); return; }
    if (!object(data)) { fail('invalid-pcm'); return; }
    if (data.type === 'pcm') {
      if (!captureStarted || pauseConfirmed || stopConfirmed || !writer || data.packetId !== packetId + 1 || !Number.isSafeInteger(data.frames) || (data.frames as number) <= 0 || (data.frames as number) > PCM_PACKET_FRAMES || !(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== (data.frames as number) * 2 || data.bytes.byteLength > PCM_PACKET_BYTES || (append && queued)) {
        if (data.bytes instanceof ArrayBuffer) new Uint8Array(data.bytes).fill(0); fail(append && queued ? 'backpressure' : 'invalid-pcm'); return;
      }
      const samples = snapshot.acceptedSamples + (data.frames as number);
      if (!Number.isSafeInteger(samples) || samples * 2 > MAX_WAV_BODY_BYTES) { new Uint8Array(data.bytes).fill(0); fail('size-limit'); return; }
      const packet = data as unknown as Packet, pcm = new DataView(packet.bytes);
      let squares = 0;
      for (let frame = 0; frame < packet.frames; frame++) squares += (pcm.getInt16(frame * 2, true) / 32768) ** 2;
      packetId++; publish({ acceptedSamples: samples, inputLevel: Math.sqrt(squares / packet.frames) });
      if (append) queued = packet; else startAppend(packet, token); return;
    }
    if (data.type === 'error') { fail(data.code === 'backpressure' ? 'backpressure' : 'invalid-pcm'); return; }
    // Stop supersedes a still-delivering Pause/Resume acknowledgment. Those
    // replies carry no PCM, so ignore only known earlier control identities.
    if (snapshot.state === 'saving' && ['running', 'paused'].includes(String(data.type)) && Number.isSafeInteger(data.commandId) && (data.commandId as number) > 0 && (data.commandId as number) < commandId) return;
    const pending = waiter;
    if (!pending || pending.type !== data.type || (pending.commandId !== undefined && data.commandId !== pending.commandId)) { fail('invalid-pcm'); return; }
    if (data.type === 'ready') {
      if (data.sampleRateHz !== context!.sampleRate) { fail('sample-rate'); return; }
    } else if (data.type !== 'running' && (data.packetId !== packetId || data.samples !== snapshot.acceptedSamples)) { fail('invalid-pcm'); return; }
    if (data.type === 'paused') pauseConfirmed = true;
    if (data.type === 'stopped') stopConfirmed = true;
    waiter = null; clearTimeout(pending.timer); pending.resolve();
  };
  const busy = () => { if (snapshot.state === 'aborted') return Promise.reject(cancelled()); publish({ error: 'busy' }); return Promise.reject(new RecordingError('busy')); };
  async function start(): Promise<void> {
    if (snapshot.state !== 'idle') return busy();
    const token = ++generation; let failurePhase: RecordingFailure = 'permission'; publish({ state: 'permission', error: null });
    try {
      options.job.assertActive();
      if (!deps.supported()) throw new RecordingError('unsupported');
      const acquired = await deps.getUserMedia({ audio: true, video: false });
      if (token !== generation || options.job.signal.aborted) { for (const track of acquired.getTracks()) track.stop(); throw cancelled(); }
      stream = acquired; active(token);
      if (!stream.getAudioTracks().length || stream.getTracks().some(track => track.kind !== 'audio' || track.readyState !== 'live')) throw new RecordingError('capture-ended');
      for (const track of stream.getTracks()) track.addEventListener('ended', ended);
      failurePhase = 'unsupported'; context = deps.createAudioContext(options.sampleRateHz);
      if (![16000, 44100, 48000].includes(context.sampleRate) || (options.sampleRateHz !== undefined && context.sampleRate !== options.sampleRateHz)) throw new RecordingError('sample-rate');
      publish({ sampleRateHz: context.sampleRate });
      failurePhase = 'capture-ended'; await context.audioWorklet.addModule(workletUrl); active(token);
      node = deps.createWorkletNode(context); const ready = wait('ready'); node.port.onmessage = ({ data }) => message(data, token); node.port.onmessageerror = () => fail('invalid-pcm'); node.onprocessorerror = () => fail('capture-ended');
      await ready; active(token); await context.resume(); active(token);
      if (context.state !== 'running') throw new RecordingError('capture-ended');
      failurePhase = 'storage'; const created = await options.createWriter({ sampleRateHz: context.sampleRate, channels: 1 }, options.job);
      if (token !== generation || options.job.signal.aborted) { await created.abort(); throw cancelled(); }
      writer = created; active(token); failurePhase = 'capture-ended';
      context.onstatechange = () => { if (['recording', 'paused'].includes(snapshot.state) && context?.state !== 'running') fail('capture-ended'); };
      sourceNode = context.createMediaStreamSource(stream!); sourceNode.connect(node); node.connect(context.destination);
      captureStarted = true; await control('start', 'running'); active(token); publish({ state: 'recording', error: null });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') { if (state() !== 'error') void abort(); throw lastFailure ?? cancelled(); }
      if (token === generation) fail(error instanceof RecordingError ? error.code : failurePhase);
      throw token !== generation && state() === 'aborted' ? cancelled() : lastFailure ?? error;
    }
  }
  async function pause(): Promise<void> {
    if (snapshot.state !== 'recording' || waiter) return busy();
    const token = generation; publish({ state: 'paused', error: null });
    try { await control('pause', 'paused'); active(token); } catch (error) { if (token === generation && state() !== 'saving') fail('capture-ended'); throw error; }
  }
  async function resume(): Promise<void> {
    if (snapshot.state !== 'paused' || waiter) return busy();
    const token = generation;
    try { active(token); pauseConfirmed = false; await control('resume', 'running'); active(token); publish({ state: 'recording', error: null }); } catch (error) { if (token === generation && state() !== 'saving') fail('capture-ended'); throw error; }
  }
  function stop(): Promise<SourceAsset> {
    if (snapshot.state === 'aborted' || options.job.signal.aborted) return Promise.reject(cancelled());
    if (stopPromise) return stopPromise;
    if (!['recording', 'paused'].includes(snapshot.state)) {
      if (snapshot.state === 'idle' || snapshot.state === 'permission') { void abort(); return stopPromise = Promise.reject(cancelled()); }
      return Promise.reject(lastFailure ?? cancelled());
    }
    const token = generation; publish({ state: 'saving', error: null }); stopTracks(); clearWaiter(cancelled());
    stopPromise = (async () => {
      try {
        await control('stop', 'stopped'); active(token);
        while (append) { await append; active(token); }
        active(token); closeGraph();
        if (!snapshot.committedSamples || snapshot.committedSamples !== snapshot.acceptedSamples || snapshot.durationMs <= 0) throw new RecordingError('empty');
        const asset: SourceAsset = Object.freeze({ id: options.sourceId, fileName: options.fileName, bytes: snapshot.committedBytes + 44, container: 'wav', codec: 'pcm_s16le', durationMs: snapshot.durationMs, channels: 1, sampleRateHz: snapshot.sampleRateHz! });
        const result = await writer!.finalize(asset, options.job); active(token);
        const sources = result.project.sourceAssets.filter(source => source.id === asset.id);
        const checkpoint = result.checkpoint;
        if (!checkpoint.id.trim() || checkpoint.projectId !== result.project.id || checkpoint.runId !== null || !checkpoint.recordIds.includes(asset.id) || checkpoint.recordIds.some(id => !id.trim()) || !checkpoint.committedAt.endsWith('Z') || !Number.isFinite(Date.parse(checkpoint.committedAt)) || sources.length !== 1 || Object.keys(asset).some(key => sources[0][key as keyof SourceAsset] !== asset[key as keyof SourceAsset])) throw new RecordingError('storage');
        writer = null; publish({ state: 'saved', source: asset }); return asset;
      } catch (error) {
        if (token === generation) fail(error instanceof RecordingError ? error.code : 'storage');
        throw snapshot.state === 'aborted' ? cancelled() : lastFailure ?? error;
      }
    })();
    return stopPromise;
  }
  function abort(): Promise<void> {
    if (abortPromise) return abortPromise;
    generation++; closeGraph(); clearWaiter(cancelled()); clearPCM();
    const draining = revokeWriter(); options.job.signal.removeEventListener('abort', onAbort);
    publish({ state: 'aborted', source: null, error: null });
    return abortPromise = draining;
  }
  const onAbort = () => { void abort().catch(() => {}); };
  options.job.signal.addEventListener('abort', onAbort, { once: true });
  return Object.freeze({ getSnapshot: () => snapshot, start, pause, resume, stop, abort });
}
