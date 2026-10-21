import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { clickAppAction, createVault, toneWav } from './helpers';

const evidence = 'docs/superpowers/evidence/2026-10-17-recording-compact';

async function isolateProviders(page: Page) {
  const inference: string[] = [];
  await page.route('https://**/*', async route => {
    if (/\/audio\/transcriptions|\/chat\/completions/.test(route.request().url())) inference.push(route.request().url());
    if (route.request().url() === 'https://openrouter.ai/api/v1/models') await route.fulfill({ contentType: 'application/json', body: '{"data":[]}' });
    else await route.abort();
  });
  return inference;
}

test('actual synthetic microphone level, sample clock, pause, save and preparation stay in one local flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const inference = await isolateProviders(page);
  await page.addInitScript(() => {
    // Test-only real Web Audio source: no hardware permission or canned level values.
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; gain.gain.value = 0;
      oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
      (window as unknown as { testCapture: { tracks: MediaStreamTrack[]; setLevel(value: number): void; close(): Promise<void> } }).testCapture = {
        tracks: destination.stream.getTracks(), setLevel: value => { gain.gain.value = value; }, close: () => context.close(),
      };
      return destination.stream;
    };
  });
  await createVault(page); await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  const inputs = page.getByRole('region', { name: '음성 추가', exact: true });
  const preparation = page.getByRole('region', { name: '전사 준비', exact: true });
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  const uploadTab = inputs.getByRole('tab', { name: '파일 업로드', exact: true });
  const meter = recording.getByRole('meter', { name: '입력 음량' });
  await expect(meter).toHaveAttribute('aria-valuenow', '0');
  await expect(recording.getByLabel('녹음 길이', { exact: true })).toHaveText('00:00:00');
  await expect(recording.getByLabel('입력된 음성', { exact: true })).toHaveText('0.00 MB');
  expect((await preparation.boundingBox())!.y).toBeGreaterThanOrEqual((await inputs.boundingBox())!.y + (await inputs.boundingBox())!.height);
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/1440-ko-empty.png`, fullPage: true });
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 중');
  await expect(meter).toHaveAttribute('aria-valuenow', '0');
  await page.evaluate(() => (window as unknown as { testCapture: { setLevel(value: number): void } }).testCapture.setLevel(.5));
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(20);
  await expect(uploadTab).toBeDisabled();
  await expect(recording.getByLabel('녹음 길이', { exact: true })).not.toHaveText('00:00:00');
  await expect(recording.getByLabel('입력된 음성', { exact: true })).not.toHaveText('0.00 MB');
  const checkMonitor = async () => {
    const metrics = (await recording.locator('.recording-metrics').boundingBox())!;
    const level = (await meter.boundingBox())!;
    expect(level.x).toBeGreaterThanOrEqual(metrics.x + metrics.width);
    expect(level.y).toBeGreaterThanOrEqual(metrics.y);
    expect(level.y + level.height).toBeLessThanOrEqual(metrics.y + metrics.height);
    expect((await recording.locator('.recording-monitor').boundingBox())!.height).toBeLessThan(120);
    expect((await meter.locator('span').boundingBox())!.width).toBeGreaterThan(1);
  };
  await checkMonitor();
  await page.screenshot({ path: `${evidence}/1440-ko-recording.png`, fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await checkMonitor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await recording.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/360-ko-recording.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await recording.getByRole('button', { name: '일시정지', exact: true }).click();
  await expect(recording.getByRole('button', { name: '계속 녹음', exact: true })).toBeEnabled();
  await expect(meter).toHaveAttribute('aria-valuenow', '0');
  const pausedTime = await recording.getByLabel('녹음 길이', { exact: true }).innerText();
  const pausedBytes = await recording.getByLabel('입력된 음성', { exact: true }).innerText();
  // An actual wait proves the displayed sample clock does not drift during pause.
  await page.waitForTimeout(1100);
  await expect(recording.getByLabel('녹음 길이', { exact: true })).toHaveText(pausedTime);
  await expect(recording.getByLabel('입력된 음성', { exact: true })).toHaveText(pausedBytes);
  await recording.getByRole('button', { name: '계속 녹음', exact: true }).click();
  await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(20);
  await recording.getByRole('button', { name: '저장 후 종료', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 저장 완료');
  await expect(meter).toHaveAttribute('aria-valuenow', '0');
  await expect(recording.getByLabel('입력된 음성', { exact: true })).toHaveText(/^\d+\.\d{2} MB$/);
  await expect(inputs.getByRole('button', { name: '새 음성 메모 만들기', exact: true })).toBeEnabled();
  await expect(inputs.getByText('기존 음성과 결과를 보존하려면 새 메모에서 녹음하세요.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { testCapture: { tracks: MediaStreamTrack[] } }).testCapture.tracks.every(track => track.readyState === 'ended'))).toBe(true);
  await page.evaluate(() => (window as unknown as { testCapture: { close(): Promise<void> } }).testCapture.close());
  const filename = await preparation.locator('strong.file-name').innerText();
  await uploadTab.click(); await expect(preparation.getByText(filename, { exact: true })).toBeVisible();
  await inputs.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  await expect(preparation.getByText(filename, { exact: true })).toBeVisible();
  await preparation.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(preparation.getByText('로컬 음성 준비 완료', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/1440-ko-prepared.png`, fullPage: true });
  await preparation.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true })).toBeVisible();
  expect(inference).toEqual([]); expect(errors).toEqual([]);
});

test.describe('narrow English input tabs', () => {
  test.use({ viewport: { width: 360, height: 800 }, hasTouch: true });
  test('keyboard tabs preserve uploaded audio and prepare it without another screen sweep', async ({ page }) => {
    const inference = await isolateProviders(page); await createVault(page);
    await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
    await page.getByRole('button', { name: 'English', exact: true }).click(); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    await page.getByRole('main').getByRole('button', { name: '+ New voice memo', exact: true }).click();
    await page.getByRole('textbox', { name: /^Memo title/ }).fill('SYNTHETIC_UPLOAD_MEMO');
    const recordTab = page.getByRole('tab', { name: 'Microphone recording', exact: true });
    const uploadTab = page.getByRole('tab', { name: 'File upload', exact: true });
    await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
    await expect(recordTab).toHaveAttribute('aria-selected', 'false');
    await uploadTab.focus(); await page.keyboard.press('Home');
    await expect(recordTab).toBeFocused(); await expect(recordTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(uploadTab).toBeFocused(); await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('meter', { name: 'Input level' })).toHaveCount(0);
    await page.getByLabel('Audio file', { exact: true }).setInputFiles({ name: 'SYNTHETIC_UPLOAD.wav', mimeType: 'audio/wav', buffer: toneWav() });
    const preparation = page.getByRole('region', { name: 'Prepare transcription', exact: true });
    await expect(preparation.getByText('SYNTHETIC_UPLOAD.wav', { exact: true })).toBeVisible();
    await recordTab.click();
    const panel = page.getByRole('tabpanel', { name: 'Microphone recording', exact: true });
    await expect(panel.getByRole('button', { name: 'Start recording', exact: true })).toHaveCount(0);
    await expect(panel.getByRole('meter')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'New voice memo', exact: true })).toBeEnabled();
    mkdirSync('docs/superpowers/evidence/2026-10-17-upload-record-action', { recursive: true });
    await panel.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'docs/superpowers/evidence/2026-10-17-upload-record-action/360-en-existing-audio.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'docs/superpowers/evidence/2026-10-17-upload-record-action/1440-en-existing-audio.png', fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await uploadTab.click(); await expect(preparation.getByText('SYNTHETIC_UPLOAD.wav', { exact: true })).toBeVisible();
    await preparation.getByRole('button', { name: 'Prepare transcription', exact: true }).click();
    await expect(preparation.getByRole('button', { name: 'Transcribe →', exact: true })).toBeEnabled();
    const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, mainWidth: document.querySelector('main')!.clientWidth, mainScroll: document.querySelector('main')!.scrollWidth }));
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width + 1); expect(bounds.mainScroll).toBeLessThanOrEqual(bounds.mainWidth + 1);
    await recordTab.click(); await panel.getByRole('button', { name: 'New voice memo', exact: true }).click();
    await expect(uploadTab).toHaveAttribute('aria-selected', 'true');
    await recordTab.click();
    await expect(page.getByRole('button', { name: 'Start recording', exact: true })).toBeEnabled();
    await expect(page.getByRole('region', { name: 'Microphone recording', exact: true }).getByRole('status')).toHaveText('Ready to record');
    await expect(page.getByRole('region', { name: 'Prepare transcription', exact: true }).getByText('SYNTHETIC_UPLOAD.wav', { exact: true })).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'SYNTHETIC_UPLOAD_MEMO', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Prepare transcription', exact: true }).getByText('SYNTHETIC_UPLOAD.wav', { exact: true })).toBeVisible();
    expect(inference).toEqual([]);
  });
});
