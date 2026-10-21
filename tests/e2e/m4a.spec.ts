import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { MPEGDecoder } from 'mpg123-decoder';
import { clickAppAction, createVault, fixtureTransport, enterFixtureKeys, fixtureText, inspectVaultSentinels, unlock } from './helpers';

test('rejects ALAC safely and prepares real AAC M4A through encrypted saved results and reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls = await fixtureTransport(page);
  const captured: { bytes: number; durationMs: number; sampleRate: number; channels: number }[] = [];
  // Inspect only our synthetic outgoing audio. The existing helper fulfills every
  // provider request locally; no real key, inference or external upload occurs.
  await page.route('https://api.openai.com/v1/audio/transcriptions', async route => {
    const request = route.request(), body = request.postDataBuffer(); expect(body).not.toBeNull();
    const form = await new Response(new Uint8Array(body!), { headers: { 'content-type': request.headers()['content-type'] } }).formData();
    const audio = form.get('file'); expect(audio).toBeInstanceOf(Blob);
    const bytes = new Uint8Array(await (audio as Blob).arrayBuffer());
    const decoder = new MPEGDecoder(); await decoder.ready;
    try {
      const decoded = decoder.decode(bytes); expect(decoded.errors).toEqual([]); expect(decoded.sampleRate).toBe(16000);
      let start = 0;
      if (String.fromCharCode(...bytes.subarray(0, 3)) === 'ID3') start = 10 + bytes[6] * 2097152 + bytes[7] * 16384 + bytes[8] * 128 + bytes[9];
      const channels = (bytes[start + 3] >> 6) === 3 ? 1 : 2; expect(channels).toBe(1);
      captured.push({ bytes: bytes.length, durationMs: decoded.samplesDecoded * 1000 / decoded.sampleRate, sampleRate: decoded.sampleRate, channels });
    } finally { decoder.free(); }
    await route.fallback();
  });
  await createVault(page); await enterFixtureKeys(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.getByLabel('음성 파일 선택').setInputFiles(resolve('tests/fixtures/media/synthetic-alac.m4a'));
  await expect(page.getByRole('alert')).toContainText('ALAC');
  await expect(page.getByRole('alert')).toContainText('다시 내보내세요');
  expect(await page.getByRole('alert').innerText()).not.toContain('작업을 완료하지 못했어요');
  expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(0);

  await page.getByLabel('음성 파일 선택').setInputFiles(resolve('tests/fixtures/media/synthetic-aac.m4a'));
  await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('synthetic-aac.m4a', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
  await page.getByRole('button', { name: '음성 준비 · 전사 시작', exact: true }).click();
  await expect(page.getByText(fixtureText).first()).toBeVisible();
  await page.getByRole('button', { name: /음성 준비 · 전사/ }).first().click();
  await expect(page.getByText('1 / 1 저장됨').first()).toBeVisible();
  await expect(page.locator('.chunk-range')).toContainText('00:00–00:04');
  expect(captured).toHaveLength(1);
  expect(captured[0]).toMatchObject({ sampleRate: 16000, channels: 1 });
  expect(captured[0].bytes).toBeGreaterThan(0);
  expect(captured[0].durationMs).toBeGreaterThanOrEqual(4000);
  expect(captured[0].durationMs).toBeLessThan(4200);
  expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
  const stored = await inspectVaultSentinels(page, ['synthetic-aac.m4a', 'KEYLESS_BROWSER_OPENAI_TEST', 'KEYLESS_BROWSER_ROUTER_TEST', fixtureText]);
  expect(stored.records).toBeGreaterThan(0); expect(stored.leakedSentinelIndices).toEqual([]);

  await clickAppAction(page, '지금 잠그기');
  await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain('synthetic-aac.m4a');
  expect(await page.locator('body').innerText()).not.toContain(fixtureText);
  await page.reload(); await unlock(page);
  await page.getByRole('button', { name: /^열기 / }).click();
  await page.getByRole('button', { name: /음성 준비 · 전사/ }).first().click();
  await expect(page.getByText('1 / 1 저장됨').first()).toBeVisible();
  await page.getByRole('button', { name: /전사 검토/ }).first().click();
  await expect(page.getByText(fixtureText).first()).toBeVisible();
  expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
  expect(errors).toEqual([]);
});
