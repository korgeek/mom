// Fixed protocol capacity, independent of recording length or storage latency.
export const PCM_PACKET_FRAMES = 4096;
export const PCM_PACKET_BYTES = PCM_PACKET_FRAMES * 2;
export function writePcm16(view: DataView, index: number, sample: number): void {
  if (!Number.isFinite(sample)) throw new RangeError('Invalid PCM sample');
  const value = Math.max(-1, Math.min(1, sample));
  view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
}
