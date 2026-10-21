import type { SourceAsset, WavCaptureConfig } from '../domain/types';

export const MAX_WAV_BODY_BYTES = 0xffffffff - 36;
export function validateWavCapture(config: WavCaptureConfig): void {
  if (!config || ![1, 2].includes(config.channels) || ![8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000].includes(config.sampleRateHz)) throw new Error('Unsupported PCM16 WAV capture rate or channels');
}
export function createWavHeader(config: WavCaptureConfig, bodyBytes: number, sourceId: string, asset: SourceAsset): Uint8Array<ArrayBuffer> {
  validateWavCapture(config);
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes <= 0 || bodyBytes > MAX_WAV_BODY_BYTES) throw new Error('WAV body must fit the RIFF32 limit');
  if (bodyBytes % (config.channels * 2)) throw new Error('WAV body ends in an incomplete sample frame');
  const durationMs = Math.round(bodyBytes * 1000 / (config.channels * 2 * config.sampleRateHz));
  if (!asset || asset.id !== sourceId || typeof asset.fileName !== 'string' || !asset.fileName.length || asset.container !== 'wav' || asset.codec !== 'pcm_s16le' || asset.bytes !== bodyBytes + 44 || asset.channels !== config.channels || asset.sampleRateHz !== config.sampleRateHz || asset.durationMs !== durationMs || durationMs <= 0) throw new Error('WAV source identity, bytes, configuration or duration mismatch');
  const bytes = new Uint8Array(44), view = new DataView(bytes.buffer), text = (at: number, value: string) => bytes.set(new TextEncoder().encode(value), at);
  text(0, 'RIFF'); view.setUint32(4, bodyBytes + 36, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, config.channels, true); view.setUint32(24, config.sampleRateHz, true); view.setUint32(28, config.sampleRateHz * config.channels * 2, true);
  view.setUint16(32, config.channels * 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bodyBytes, true);
  return bytes;
}
