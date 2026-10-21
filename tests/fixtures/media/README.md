# Synthetic media fixtures

These fixtures contain generated tones, not speech, recordings or credentials. Product code does not import them. Generate large files in a temporary directory and keep them out of Git.

## Committed inputs

| File | Purpose |
| --- | --- |
| [synthetic-aac.m4a](synthetic-aac.m4a) | Four-second 44.1 kHz mono AAC-LC tone; valid M4A metadata, gapless trimming and native decoding tests. |
| [synthetic-alac.m4a](synthetic-alac.m4a) | Four-second 44.1 kHz mono ALAC tone; explicit unsupported-codec rejection. |

Both were encoded locally with macOS `afconvert`. In the AAC fixture the sample entry advertises two channels but AudioSpecificConfig identifies one; the parser uses the codec configuration. Its 175 access units include 2,112 priming samples and 688 padding samples, leaving 176,400 samples / 4,000 ms. See [M4A tests](../../m4a.spec.ts) for the assertions.

## Generate temporary inputs

From the repository root, after `npm ci`:

```sh
node tests/fixtures/media/generate.mjs 3600 /tmp/mom-synthetic-one-hour.mp3
node tests/fixtures/media/generate.mjs 7200 /tmp/mom-synthetic-two-hour.mp3
```

[generate.mjs](generate.mjs) reuses a one-second 440 Hz PCM block and writes 16 kHz mono MP3 at 32 kbps with the pinned LAME encoder. Encoder padding can make the measured duration differ from the requested tone length; tests must inspect actual media timing.

For AAC M4A on macOS:

```sh
node tests/fixtures/media/generate-m4a.mjs 960 /tmp/mom-synthetic-16min.m4a 48000 1
```

[generate-m4a.mjs](generate-m4a.mjs) streams PCM16 WAV into a temporary directory, runs the system `/usr/bin/afconvert`, and removes the intermediate PCM on success or failure. Arguments are duration in seconds, output path, sample rate and channels. Supported sample rates are 16,000 / 44,100 / 48,000 Hz, with one or two channels. It adds no npm dependency.

## Run related checks

Choose checks that match the change; generating a long tone alone is not a long-recording test.

```sh
npm run test:unit -- tests/m4a.spec.ts tests/source-media.spec.ts
npm run build
npm run test:e2e -- m4a.spec.ts
```

The [browser scenario](../../e2e/m4a.spec.ts) uses the committed files with the real app, media Worker, encrypted persistence and an independent MP3 decoder. Provider requests are intercepted locally. Playwright opens visible sandboxed Chrome against the local production preview, so it requires installed Chrome and a desktop display.

Node tests inspect real M4A metadata/sample tables; substituted native decoders verify lifecycle, cancellation, backpressure and trimming. Actual AAC decode requires browser WebCodecs support. Synthetic fixtures and intercepted responses do not verify microphone hardware, real speech quality or authenticated provider inference. Long-input preparation measurements are recorded separately in [verification evidence](../../../docs/superpowers/evidence/).
