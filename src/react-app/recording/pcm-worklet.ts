import { PCM_PACKET_BYTES, PCM_PACKET_FRAMES, writePcm16 } from './wav';

declare const AudioWorkletProcessor: { new(): { readonly port: MessagePort } };
declare const sampleRate: number;
declare function registerProcessor(name: string, processor: typeof MicrophonePCMProcessor): void;

/** A single partial buffer and two granted packets. Storage cannot backpressure
 * a live microphone indefinitely: exhaustion fails rather than dropping audio. */
class MicrophonePCMProcessor extends AudioWorkletProcessor {
  private mode: 'idle' | 'recording' | 'paused' | 'stopping' | 'stopped' | 'error' = 'idle';
  private bytes = new ArrayBuffer(PCM_PACKET_BYTES);
  private view = new DataView(this.bytes);
  private frames = 0;
  private total = 0;
  private credits = 0;
  private packetId = 0;
  private ackId = 0;
  private commandId = 0;
  private pending: { type: 'paused' | 'stopped'; commandId: number } | null = null;

  constructor() {
    super();
    this.port.onmessage = ({ data }: MessageEvent<unknown>) => this.command(data);
    this.port.postMessage({ type: 'ready', sampleRateHz: sampleRate });
  }
  private fail(code: 'backpressure' | 'invalid-pcm' = 'invalid-pcm'): void {
    if (this.mode === 'error' || this.mode === 'stopped') return;
    this.mode = 'error'; new Uint8Array(this.bytes).fill(0); this.frames = 0; this.pending = null;
    this.port.postMessage({ type: 'error', code });
  }
  private flush(): boolean {
    if (this.frames && !this.credits) return false;
    if (this.frames) {
      const frames = this.frames, bytes = this.bytes.slice(0, frames * 2);
      new Uint8Array(this.bytes).fill(0); this.frames = 0; this.credits--;
      this.port.postMessage({ type: 'pcm', packetId: ++this.packetId, frames, bytes }, [bytes]);
    }
    if (this.pending) {
      const pending = this.pending; this.pending = null;
      if (pending.type === 'stopped') this.mode = 'stopped';
      this.port.postMessage({ ...pending, type: pending.type, packetId: this.packetId, samples: this.total });
    }
    return true;
  }
  private command(value: unknown): void {
    if (!value || typeof value !== 'object') { this.fail(); return; }
    const data = value as Record<string, unknown>;
    if (data.type === 'ack') {
      if (this.mode === 'error' || this.mode === 'stopped') return;
      if (data.packetId !== this.ackId + 1 || (data.packetId as number) > this.packetId || this.credits >= 2) { this.fail(); return; }
      this.ackId++; this.credits++; if (this.pending || this.frames === PCM_PACKET_FRAMES) this.flush(); return;
    }
    if (data.commandId !== this.commandId + 1) { this.fail(); return; }
    this.commandId++;
    if (data.type === 'start' && this.mode === 'idle' && data.credits === 2) {
      this.credits = 2; this.mode = 'recording'; this.port.postMessage({ type: 'running', commandId: this.commandId });
    } else if (data.type === 'pause' && this.mode === 'recording') {
      this.mode = 'paused'; this.pending = { type: 'paused', commandId: this.commandId }; this.flush();
    } else if (data.type === 'resume' && this.mode === 'paused' && !this.pending) {
      this.mode = 'recording'; this.port.postMessage({ type: 'running', commandId: this.commandId });
    } else if (data.type === 'stop' && ['recording', 'paused'].includes(this.mode)) {
      this.mode = 'stopping'; this.pending = { type: 'stopped', commandId: this.commandId }; this.flush();
    } else this.fail();
  }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    // Connect a silent output to keep the rendering graph alive, without playing
    // the microphone back to its speakers or retaining a monitor buffer.
    for (const output of outputs) for (const channel of output) channel.fill(0);
    if (this.mode === 'error' || this.mode === 'stopped') return false;
    if (this.mode !== 'recording') return true;
    const channels = inputs[0]; if (!channels?.length) return true;
    if (channels.length !== 1) { this.fail(); return false; }
    try {
      for (const sample of channels[0]) {
        if (this.frames === PCM_PACKET_FRAMES && !this.flush()) { this.fail('backpressure'); return false; }
        writePcm16(this.view, this.frames++, sample); this.total++;
        if (this.frames === PCM_PACKET_FRAMES) this.flush();
      }
    } catch { this.fail(); return false; }
    return true;
  }
}
registerProcessor('mom-microphone-pcm16', MicrophonePCMProcessor);
