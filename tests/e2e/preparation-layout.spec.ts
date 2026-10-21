import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { clickAppAction, createVault, toneWav, unlock } from './helpers';

const evidence = 'docs/superpowers/evidence/2026-10-17-preparation-layout';
async function blockProviders(page: Page) {
  const inference: string[] = [];
  await page.route('https://**/*', async route => {
    if (/\/audio\/transcriptions|\/chat\/completions/.test(route.request().url())) inference.push(route.request().url());
    if (route.request().url() === 'https://openrouter.ai/api/v1/models') await route.fulfill({ contentType: 'application/json', body: '{"data":[]}' });
    else await route.abort();
  });
  return inference;
}

for (const [width, language] of [[1440, 'ko'], [1440, 'en'], [360, 'ko'], [360, 'en'], [960, 'ko']] as const) {
  test.describe(`${width} ${language} preparation layout`, () => {
    test.use({ viewport: { width, height: width === 360 ? 800 : 900 }, hasTouch: width === 360 });
    test('keeps memo details, local actions, recording and upload reachable before provider confirmation', async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      const inference = await blockProviders(page), t = (ko: string, en: string) => language === 'ko' ? ko : en;
      await createVault(page);
      if (language === 'en') {
        await clickAppAction(page, '설정');
        await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
        await page.getByRole('button', { name: 'English', exact: true }).click();
        await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
      }
      await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
      const memo = page.getByRole('region', { name: t('메모 정보', 'Memo details'), exact: true });
      const actions = page.getByRole('region', { name: t('전사 준비', 'Prepare transcription'), exact: true });
      const inputs = page.getByRole('region', { name: t('음성 추가', 'Add audio'), exact: true });
      const uploadTab = page.getByRole('tab', { name: t('파일 업로드', 'File upload'), exact: true });
      const upload = page.getByRole('tabpanel', { name: t('파일 업로드', 'File upload'), exact: true });
      const prepare = actions.getByRole('button', { name: t('전사 준비', 'Prepare transcription'), exact: true });
      const transcribe = actions.getByRole('button', { name: t('전사하기 →', 'Transcribe →'), exact: true });
      await expect(prepare).toBeDisabled(); await expect(transcribe).toBeDisabled();
      const boxes = await Promise.all([memo, inputs, actions].map(region => region.boundingBox()));
      expect(boxes.every(Boolean)).toBe(true);
      const [left, top, preparation] = boxes.map(box => box!);
      if (width > 960) { expect(left.x + left.width).toBeLessThan(top.x); expect(top.width / left.width).toBeCloseTo(1.5, 1); }
      else { expect(top.x).toBe(left.x); expect(top.y).toBeGreaterThanOrEqual(left.y + left.height); }
      expect(preparation.y).toBeGreaterThanOrEqual(top.y + top.height);
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: `${evidence}/${width}-${language}-empty.png`, fullPage: true });
      if (width === 1440 && language === 'ko') {
        await page.setViewportSize({ width, height: 1100 });
        await page.screenshot({ path: `${evidence}/1440-ko-overview.png`, fullPage: true });
        await page.setViewportSize({ width, height: 900 });
      }

      await uploadTab.click();
      for (const summary of [memo.getByText(t('언어 안내', 'Language guidance'), { exact: true }), actions.locator('summary').filter({ hasText: t('청크·압축', 'Chunks & compression') }), upload.getByText(t('지원 형식 보기', 'Supported formats'), { exact: true })]) {
        await expect(summary.locator('..')).not.toHaveAttribute('open');
        await summary.focus(); await page.keyboard.press('Enter'); await expect(summary.locator('..')).toHaveAttribute('open');
        await page.keyboard.press('Space'); await expect(summary.locator('..')).not.toHaveAttribute('open');
      }
      const title = `TEST_ONLY_LAYOUT_${'LongMemoTitle'.repeat(8)}`;
      await memo.getByRole('textbox', { name: t('메모 제목', 'Memo title'), exact: true }).fill(title);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      const filename = `SYNTHETIC_${'long_file_name_'.repeat(8)}.wav`;
      await page.getByLabel(t('음성 파일 선택', 'Audio file'), { exact: true }).setInputFiles({ name: filename, mimeType: 'audio/wav', buffer: toneWav() });
      await expect(actions.getByText(filename, { exact: true })).toBeVisible(); await expect(prepare).toBeEnabled();
      await page.getByRole('tab', { name: t('마이크 녹음', 'Microphone recording'), exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: t('마이크 녹음', 'Microphone recording'), exact: true }).getByRole('button', { name: t('새 음성 메모 만들기', 'New voice memo'), exact: true })).toBeEnabled();
      await prepare.click();
      await expect(actions.getByText(t('로컬 음성 준비 완료', 'Local audio preparation complete'), { exact: true })).toBeVisible();
      await expect(transcribe).toBeEnabled(); await expect(prepare).toBeDisabled();
      const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')!.clientWidth, mainScroll: document.querySelector('main')!.scrollWidth }));
      expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
      await actions.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${width}-${language}-ready.png`, fullPage: true });
      await actions.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${width}-${language}-upload.png`, fullPage: true });
      await transcribe.click();
      await expect(page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above"), exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: t('전사 실행', 'Transcribe'), exact: true })).toBeDisabled();
      expect(inference).toEqual([]); expect(errors).toEqual([]);
      await clickAppAction(page, t('지금 잠그기', 'Lock now'));
      await expect(page.getByRole('main')).toHaveCount(0); await expect(page.getByText(filename, { exact: true })).toHaveCount(0);
    });
  });
}

test('preparation cancellation and storage failure remain actionable and never enable unsaved transcription', async ({ page }) => {
  const inference = await blockProviders(page);
  await createVault(page); await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_CANCEL.wav', mimeType: 'audio/wav', buffer: toneWav(301) });
  const actions = page.getByRole('region', { name: '전사 준비', exact: true });
  await actions.getByRole('button', { name: '전사 준비', exact: true }).click();
  await actions.getByRole('button', { name: '음성 준비 취소', exact: true }).click();
  await expect(page.getByText('로컬 음성 준비를 중지했어요. 암호화 저장된 청크는 유지돼요.', { exact: true })).toBeVisible();
  await expect(actions.getByRole('button', { name: '전사하기 →', exact: true })).toBeDisabled();
  await expect(actions.getByRole('button', { name: '전사 준비', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
      if (this.name === 'records') throw new DOMException('TEST_ONLY_QUOTA_FAILURE', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  await actions.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(actions.getByRole('button', { name: '전사하기 →', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${evidence}/1440-ko-storage-failure.png`, fullPage: true });
  await page.reload(); await unlock(page);
  await page.getByRole('complementary').getByRole('button', { name: '새 음성 메모', exact: true }).click();
  await expect(actions.getByRole('button', { name: '전사 준비', exact: true })).toBeEnabled();
  expect(inference).toEqual([]);
});

test('microphone denial stays beside recording without starting audio preparation', async ({ page }) => {
  const inference = await blockProviders(page);
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('TEST_ONLY_MIC_DENIED', 'NotAllowedError'); };
  });
  await createVault(page); await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).click();
  await expect(recording.getByRole('alert')).toContainText('마이크 권한을 얻지 못했어요');
  const actions = page.getByRole('region', { name: '전사 준비', exact: true });
  await expect(actions.getByRole('button', { name: '전사 준비', exact: true })).toBeDisabled();
  await expect(actions.getByRole('button', { name: '전사하기 →', exact: true })).toBeDisabled();
  await page.screenshot({ path: `${evidence}/1440-ko-microphone-denied.png`, fullPage: true });
  expect(inference).toEqual([]);
});
