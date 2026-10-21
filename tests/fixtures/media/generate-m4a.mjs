// Synthetic tones only. Stream bounded PCM to disk; never read a user recording.
// macOS: node generate-m4a.mjs [seconds] [output.m4a] [sampleRate] [channels]
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const seconds = Number(process.argv[2] ?? 4), destination = resolve(process.argv[3] ?? '/tmp/mom-synthetic-aac.m4a');
const sampleRate = Number(process.argv[4] ?? 44100), channels = Number(process.argv[5] ?? 1);
if (!Number.isSafeInteger(seconds) || seconds < 1 || ![16000, 44100, 48000].includes(sampleRate) || ![1, 2].includes(channels)) throw new Error('Use positive integer seconds,16/44.1/48kHz and one/two channels.');
const bytes = seconds * sampleRate * channels * 2;
if (bytes > 0xffffffff - 36) throw new Error('Synthetic WAV exceeds RIFF32 capacity.');
const temporary = await mkdtemp(join(tmpdir(), 'mom-synthetic-aac-')), input = join(temporary, 'tone.wav');
try {
  const file = await open(input, 'w');
  try {
    const header = Buffer.alloc(44);
    header.write('RIFF'); header.writeUInt32LE(bytes + 36, 4); header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28);
    header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes, 40);
    await file.write(header);
    const block = Buffer.alloc(sampleRate * channels * 2);
    for (let sample = 0; sample < sampleRate; sample++) for (let channel = 0; channel < channels; channel++) block.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * (440 + channel * 220) * sample / sampleRate)), (sample * channels + channel) * 2);
    for (let second = 0; second < seconds; second++) await file.write(block);
  } finally { await file.close(); }
  const encoded = spawnSync('/usr/bin/afconvert', ['-f', 'm4af', '-d', `aac@${sampleRate}`, '-b', String(sampleRate === 16000 && channels === 1 ? 32000 : 64000), input, destination], { encoding: 'utf8' });
  if (encoded.error || encoded.status !== 0) throw new Error('System AAC fixture encoder unavailable or failed.');
  console.log(`Created synthetic AAC: ${seconds}s,${sampleRate}Hz,${channels}channel(s): ${destination}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
