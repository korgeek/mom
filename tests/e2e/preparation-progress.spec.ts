import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault, enterFixtureKeys, fixtureText, fixtureTransport, prepareForTranscription, toneWav, unlock } from './helpers';

const evidence = '.superpowers/sdd/remaining-work/task-workflow-3a/preparation';
type Evidence = { sourceTimes: number[]; stages: string[]; receipts: string[] };
function boundaryTone() {
  const samples = 301 * 16000, data = Buffer.alloc(44 + samples * 2), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  data.write('RIFF'); view.setUint32(4, data.length - 8, true); data.write('WAVE', 8); data.write('fmt ', 12);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); data.write('data', 36); view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index++) view.setInt16(44 + index * 2, Math.round(1500 * Math.sin(index * .1)), true);
  return data;
}

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) test.describe(`preparation at ${viewport.width}`, () => {
  test.use({ viewport, hasTouch: viewport.width === 360 });
  test('actual 5/5 Worker preparation, durable saves and encrypted legacy reload', async ({ page, context }) => {
    expect(context.browser()?.browserType().name()).toBe('chromium');
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // Only the intercepted provider is held. Local Worker/codec/checkpoint work runs normally.
    let releaseProvider!: () => void;
    const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
    const calls = await fixtureTransport(page, { delaySTT: providerGate });
    await page.addInitScript(() => {
      const state = window as unknown as { preparationEvidence: Evidence }; state.preparationEvidence = { sourceTimes: [], stages: [], receipts: [] };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) { super(url, options); this.addEventListener('message', event => {
          if (event.data?.progress) state.preparationEvidence.sourceTimes.push(event.data.progress.sourceProcessedMs);
        }); }
      };
      new MutationObserver(() => {
        const statuses = [...document.querySelectorAll('.stages span, [role=status]')].map(element => element.textContent ?? '');
        for (const text of statuses) if (text && !state.preparationEvidence.stages.includes(text)) state.preparationEvidence.stages.push(text);
        const region = document.querySelector('[aria-label="로컬 음성 준비"]');
        const receipt = region?.textContent ?? '';
        if (receipt && state.preparationEvidence.receipts.at(-1) !== receipt) state.preparationEvidence.receipts.push(receipt);
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
    });
    await createVault(page); await enterFixtureKeys(page);
    await clickAppAction(page, '설정');
    await page.getByRole('tab', { name: '처리 기본값', exact: true }).click();
    await expect(page.getByRole('group', { name: '기본 청크 길이' }).getByRole('button', { name: '5 분', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('group', { name: '기본 겹침' }).getByRole('button', { name: '5 초', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
    await expect(page.getByText('5 분 · 5 초 겹침 · 32 kbps')).toBeVisible();
    await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_301_SECOND_TONE.wav', mimeType: 'audio/wav', buffer: boundaryTone() });
    await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('SYNTHETIC_301_SECOND_TONE.wav')).toBeVisible();
    await page.getByRole('button', { name: '전사 준비', exact: true }).click();
    try {
      await expect(page.getByText('로컬 음성 준비 완료', { exact: true })).toBeVisible();
      await expect(page.getByText('암호화 저장된 음성 청크: 2 / 계획 2')).toBeVisible();
      expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(0);
      const actual = await page.evaluate(() => (window as unknown as { preparationEvidence: Evidence }).preparationEvidence);
      expect(actual.sourceTimes.some(time => time > 0 && time < 300000)).toBe(true); expect(actual.sourceTimes.at(-1)).toBe(301000);
      expect(actual.stages).toContain('이 브라우저에서 음성 파일 확인 중…');
      expect(actual.stages).toContain('로컬 음성 분할 · 압축 중…'); expect(actual.stages).toContain('음성 청크 암호화 저장 중…');
      expect(actual.receipts.some(text => text.includes('암호화 저장된 음성 청크: 0 / 계획 2'))).toBe(true);
      expect(actual.receipts.some(text => text.includes('암호화 저장된 음성 청크: 1 / 계획 2'))).toBe(true);
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
        mainWidth: document.querySelector('main')!.clientWidth, mainScroll: document.querySelector('main')!.scrollWidth }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
      await mkdir(evidence, { recursive: true });
      await writeFile(`${evidence}/${viewport.width}-actual-events.json`, JSON.stringify(actual, null, 2));
      await page.getByRole('region', { name: '로컬 음성 준비' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/${viewport.width}-local-complete-no-provider.png`, fullPage: true });
      await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
      await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
      await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
      await page.getByRole('button', { name: '전사 실행', exact: true }).click();
      await expect.poll(() => calls.filter(call => call.url.endsWith('/audio/transcriptions')).length).toBe(1);
      await expect(page.getByRole('progressbar', { name: '청크 1 전사 중' })).not.toHaveAttribute('value');
      await page.screenshot({ path: `${evidence}/${viewport.width}-stt-provider-fixture-pending.png`, fullPage: true });
    } finally { releaseProvider(); }
    await expect(page.getByText(fixtureText).first()).toBeVisible();
    await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button', { name: /전사$/ }).click();
    await expect(page.getByText('2 / 2 저장됨').first()).toBeVisible();
    await page.screenshot({ path: `${evidence}/${viewport.width}-saved-results.png`, fullPage: true });

    // Legacy 10/15 values are chosen and saved through the normal UI, then reloaded.
    await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
    await page.locator('summary').filter({ hasText: '청크·압축' }).click();
    await page.getByRole('group', { name: '청크 길이', exact: true }).getByRole('button', { name: '10 분', exact: true }).click();
    await page.getByRole('group', { name: '겹침', exact: true }).getByRole('button', { name: '15 초', exact: true }).click();
    await expect(page.getByRole('group', { name: '겹침', exact: true }).getByRole('button', { name: '15 초', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('input[type=file]')).toBeEnabled();
    await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_LEGACY_TONE.wav', mimeType: 'audio/wav', buffer: toneWav() });
    await expect(page.getByRole('region', { name: /^(전사 준비|Prepare transcription)$/ }).getByText('SYNTHETIC_LEGACY_TONE.wav')).toBeVisible();
    await prepareForTranscription(page);
    await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
    await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
    await page.getByRole('button', { name: '전사 실행', exact: true }).click();
    await expect(page.getByText(fixtureText).first()).toBeVisible();
    const count = calls.filter(call => call.url.endsWith('/audio/transcriptions')).length; expect(count).toBe(3);
    await clickAppAction(page, '지금 잠그기');
    await page.reload(); await unlock(page);
    await page.getByRole('button', { name: /열기/ }).first().click();
    await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button', { name: /전사$/ }).click();
    await expect(page.getByText('10 분 · 15 초 겹침 · 32 kbps')).toBeVisible();
    await expect(page.getByText('1 / 1 저장됨').first()).toBeVisible();
    expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(count);
    await page.screenshot({ path: `${evidence}/${viewport.width}-legacy-reloaded.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
});
