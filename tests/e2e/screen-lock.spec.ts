// Disposable browser vaults, Web Audio test signal and intercepted inference only.
import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, inspectVaultSentinels, passphrase, toneWav } from './helpers';

const transcript = 'SYNTHETIC_SCREEN_LOCK_TRANSCRIPT: Keep the already approved recording and work.';
const markdown = '# SYNTHETIC_SCREEN_LOCK_NOTES\n\nThe approved work was saved.';

async function isolateNetwork(page: Page) {
  const external: string[] = [];
  await page.route('https://**/*', async route => {
    external.push(route.request().url());
    await route.abort();
  });
  return external;
}

async function unlockScreen(page: Page, secret = passphrase) {
  await page.getByLabel('암호', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '화면 잠금 해제', exact: true }).click();
}

async function installSyntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; gain.gain.value = .2;
      oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
      (window as unknown as { syntheticCapture: { tracks: MediaStreamTrack[]; close(): Promise<void> } }).syntheticCapture = {
        tracks: destination.stream.getTracks(), close: () => context.close(),
      };
      return destination.stream;
    };
  });
}

async function tracksLive(page: Page) {
  return page.evaluate(() => (window as unknown as { syntheticCapture: { tracks: MediaStreamTrack[] } }).syntheticCapture.tracks.every(track => track.readyState === 'live'));
}

async function simulateVisibility(page: Page, value: 'visible' | 'hidden') {
  // The locked macOS test host does not report native tab visibility changes.
  // This test-only event checks the app boundary without altering OS settings.
  await page.evaluate(visibility => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: visibility });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
}

async function syntheticModels(page: Page) {
  await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const models = [
    { ...createModelPreset('compatible-stt'), name: 'SYNTHETIC_LOCK_STT', modelId: 'synthetic-lock-stt' },
    { ...createModelPreset('compatible-text'), name: 'SYNTHETIC_LOCK_LLM', modelId: 'synthetic-lock-llm', llm: { tokenField: 'max_tokens' as const, maxTokens: 4096, contextTokens: 32000 } },
  ];
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles(models));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click();
  await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of models) {
    await manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) }).getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
    await editor.getByRole('button', { name: '저장', exact: true }).click();
    await expect(editor).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
}

test('standard screen lock hides sensitive DOM while real synthetic recording survives wrong and correct unlock', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await isolateNetwork(page); await installSyntheticMicrophone(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill('SYNTHETIC_LOCK_RECORDING_PRIVATE_TITLE');
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 중');
  await expect(recording.getByLabel('녹음 길이', { exact: true })).not.toHaveText('00:00:00');
  const durationBefore = await recording.getByLabel('녹음 길이', { exact: true }).innerText();
  const bytesBefore = await recording.getByLabel('입력된 음성', { exact: true }).innerText();
  await page.screenshot({ path: info.outputPath('1440-recording-before-lock.png'), fullPage: true });
  await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
  await expect(recording).toHaveCount(0);
  await expect(page.getByText('SYNTHETIC_LOCK_RECORDING_PRIVATE_TITLE', { exact: true })).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toContain('SYNTHETIC_LOCK_RECORDING_PRIVATE_TITLE');
  expect(await tracksLive(page)).toBe(true);
  await unlockScreen(page, 'synthetic wrong passphrase');
  await expect(page.getByRole('alert')).toContainText('암호를 확인할 수 없어요');
  expect(await tracksLive(page)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('390-locked-recording-wrong-passphrase.png'), fullPage: true });
  await page.waitForTimeout(1100); // Real audio sample clock must advance while UI is unmounted.
  await unlockScreen(page);
  await expect(recording.getByRole('status')).toHaveText('녹음 중');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(recording.getByLabel('녹음 길이', { exact: true })).not.toHaveText(durationBefore);
  await expect(recording.getByLabel('입력된 음성', { exact: true })).not.toHaveText(bytesBefore);
  await expect(recording.getByText('중단된 녹음이 남아 있어요. 새 메모에서 녹음하세요.', { exact: true })).toHaveCount(0);
  expect(await tracksLive(page)).toBe(true);
  await page.screenshot({ path: info.outputPath('390-recording-unlocked-continuing.png'), fullPage: true });
  await recording.getByRole('button', { name: '저장 후 종료', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 저장 완료');
  expect(await tracksLive(page)).toBe(false);
  await expect(recording.getByLabel('암호화 저장된 음성', { exact: true })).not.toHaveText('0.00 MB');
  await page.evaluate(() => (window as unknown as { syntheticCapture: { close(): Promise<void> } }).syntheticCapture.close());
  const audit = await inspectVaultSentinels(page, ['SYNTHETIC_LOCK_RECORDING_PRIVATE_TITLE']);
  expect(audit.leakedSentinelIndices).toEqual([]); expect(errors).toEqual([]);
});

test('held STT and minutes finish under standard screen lock, release runtime and restore saved results without duplicate requests', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await isolateNetwork(page);
  const calls: string[] = [], aborted: string[] = [];
  page.on('requestfailed', request => { if (request.url().startsWith('http://localhost:8000/')) aborted.push(request.url()); });
  let releaseSTT!: () => void, releaseMinutes!: () => void;
  const sttHold = new Promise<void>(resolve => { releaseSTT = resolve; });
  const minutesHold = new Promise<void>(resolve => { releaseMinutes = resolve; });
  await page.route('http://localhost:8000/**', async route => {
    const url = route.request().url(); calls.push(url);
    await (url.endsWith('/audio/transcriptions') ? sttHold : minutesHold);
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(url.endsWith('/audio/transcriptions')
      ? { text: transcript } : { choices: [{ message: { content: markdown }, finish_reason: 'stop' }] }) });
  });
  try {
    await createVault(page); await syntheticModels(page);
    await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
    await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_LOCK.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
    await page.getByRole('button', { name: '전사 준비', exact: true }).click();
    await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
    await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption({ label: 'SYNTHETIC_LOCK_STT' });
    await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
    await page.getByRole('button', { name: '전사 실행', exact: true }).click();
    await expect.poll(() => calls.filter(url => url.endsWith('/audio/transcriptions')).length).toBe(1);
    await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
    await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
    await expect(page.locator('.stt-grid')).toHaveCount(0);
    releaseSTT();
    await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
    await unlockScreen(page);
    await expect(page.locator('.saved-count')).toHaveText('전사 결과 1 / 1');
    await expect(page.locator('.review-grid')).toContainText(transcript);
    await page.getByRole('button', { name: '문장 수정 1', exact: true }).click();
    const reviewDraft = 'SYNTHETIC_UNSAVED_REVIEW_DRAFT';
    await page.getByRole('textbox', { name: '전사 수정', exact: true }).fill(reviewDraft);
    await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
    await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
    await unlockScreen(page);
    await expect(page.getByRole('textbox', { name: '전사 수정', exact: true })).toHaveValue(reviewDraft);
    await page.locator('.review-grid').getByRole('button', { name: '취소', exact: true }).click();
    await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
    await page.getByRole('combobox', { name: '정리 모델', exact: true }).selectOption({ label: 'SYNTHETIC_LOCK_LLM' });
    await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', exact: true }).check();
    await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click();
    await expect.poll(() => calls.filter(url => url.endsWith('/chat/completions')).length).toBe(1);
    await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
    await expect(page.locator('.minutes-grid')).toHaveCount(0);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: info.outputPath('820-minutes-pending-screen-lock.png'), fullPage: true });
    releaseMinutes();
    await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
    await unlockScreen(page);
    await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_SCREEN_LOCK_NOTES');
    await page.screenshot({ path: info.outputPath('820-minutes-restored.png'), fullPage: true });
    await page.getByRole('button', { name: '편집', exact: true }).click();
    const notesDraft = markdown + '\n\nSYNTHETIC_UNSAVED_MINUTES_DRAFT';
    await page.getByRole('textbox', { name: 'Markdown 편집기', exact: true }).fill(notesDraft);
    await clickAppAction(page, '화면 잠금');
    await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
    await unlockScreen(page);
    await expect(page.getByRole('textbox', { name: 'Markdown 편집기', exact: true })).toHaveValue(notesDraft);
    expect(calls.filter(url => url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    expect(calls.filter(url => url.endsWith('/chat/completions'))).toHaveLength(1);
    expect(aborted).toEqual([]); expect(errors).toEqual([]);
    expect((await inspectVaultSentinels(page, [transcript, markdown, reviewDraft, notesDraft])).leakedSentinelIndices).toEqual([]);
  } finally { releaseSTT(); releaseMinutes(); }
});

test('inactivity uses elapsed seconds and trusted activity, simulated return checks expiry, never and screen state survive reload', async ({ page }, info) => {
  const clockStart = new Date('2026-10-18T12:00:00Z');
  // Install before app startup: the idle controller intentionally captures Date.now.
  await page.clock.install({ time: clockStart });
  await isolateNetwork(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  const title = page.getByRole('textbox', { name: /^메모 제목/ });
  await title.fill('SYNTHETIC_IDLE_PRIVATE_TITLE');
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  await title.click();
  const counter = page.getByRole('timer', { name: '화면 자동 잠금까지 남은 시간', exact: true });
  await expect(counter).toHaveAttribute('aria-live', 'off');
  await page.clock.runFor(20_000);
  await expect(counter).toHaveText('화면 잠금까지 40초');
  await title.fill('SYNTHETIC_IDLE_PRIVATE_TITLE!');
  await page.clock.runFor(1000);
  await expect(counter).toHaveText('화면 잠금까지 59초');
  await page.evaluate(() => document.dispatchEvent(new Event('input', { bubbles: true })));
  await page.clock.runFor(1000);
  await expect(counter).toHaveText('화면 잠금까지 58초');
  await page.keyboard.press('Tab'); await page.clock.runFor(1000);
  await expect(counter).toHaveText('화면 잠금까지 59초');
  const scrollBefore = await page.locator('main').evaluate(node => node.scrollTop);
  await page.evaluate(() => {
    const events: { trusted: boolean; deltaY: number; at: number }[] = [];
    (window as unknown as { syntheticWheelEvents: typeof events }).syntheticWheelEvents = events;
    // Registered after the app's capture listener: this marks actual delivery,
    // rather than assuming mouse.wheel() waits for Chrome's asynchronous scroll.
    document.addEventListener('wheel', event => events.push({ trusted: event.isTrusted, deltaY: event.deltaY, at: Date.now() }), { capture: true, passive: true, once: true });
  });
  const main = (await page.locator('main').boundingBox())!;
  await page.mouse.move(main.x + main.width * .75, main.y + main.height * .75);
  await page.mouse.wheel(0, 240);
  await expect.poll(() => page.evaluate(() => (window as unknown as { syntheticWheelEvents: unknown[] }).syntheticWheelEvents.length)).toBe(1);
  const wheel = await page.evaluate(() => (window as unknown as { syntheticWheelEvents: { trusted: boolean; deltaY: number; at: number }[] }).syntheticWheelEvents[0]);
  expect(wheel.trusted).toBe(true); expect(wheel.deltaY).toBe(240);
  await expect.poll(() => page.locator('main').evaluate(node => node.scrollTop)).toBeGreaterThan(scrollBefore);
  await writeFile(info.outputPath('trusted-wheel.json'), JSON.stringify({ wheel, scrollBefore, scrollAfter: await page.locator('main').evaluate(node => node.scrollTop) }, null, 2));
  await page.clock.runFor(1000);
  await expect(counter).toHaveText('화면 잠금까지 59초');
  await simulateVisibility(page, 'hidden');
  await page.clock.setSystemTime((await page.evaluate(() => Date.now())) + 59_000);
  await simulateVisibility(page, 'visible');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
  await unlockScreen(page);
  await expect(title).toHaveValue('SYNTHETIC_IDLE_PRIVATE_TITLE!');
  await page.clock.resume();
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  await page.getByRole('button', { name: '잠기지 않음', exact: true }).click();
  await expect(page.getByRole('button', { name: '잠기지 않음', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(counter).toHaveText('화면 자동 잠금 사용 안 함');
  await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
  await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
  await page.reload();
  await page.getByLabel('암호', { exact: true }).fill(passphrase);
  await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(page.getByRole('button', { name: '잠기지 않음', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(counter).toHaveText('화면 자동 잠금 사용 안 함');
  await page.clock.fastForward(3_600_000);
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('1440-never-restored-settings.png'), fullPage: true });
});

test('changing an active recording to strict waits for hidden boundary, preserves interrupted bytes and never resumes on standard change', async ({ page }, info) => {
  await isolateNetwork(page); await installSyntheticMicrophone(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  const title = 'SYNTHETIC_STRICT_INTERRUPTED_RECORDING';
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).click();
  await expect(recording.getByLabel('암호화 저장된 음성', { exact: true })).not.toHaveText('0.00 MB');
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  await page.getByRole('button', { name: '진행 중 작업으로 돌아가기', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 중'); expect(await tracksLive(page)).toBe(true);
  await clickAppAction(page, '설정');
  const strict = page.getByRole('button', { name: '엄격 · 잠글 때 작업 중지', exact: true });
  await strict.click(); await expect(strict).toHaveAttribute('aria-pressed', 'true');
  expect(await tracksLive(page)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await tracksLive(page)).toBe(true);
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toHaveCount(0);
  await simulateVisibility(page, 'hidden');
  await expect.poll(() => tracksLive(page)).toBe(false);
  await simulateVisibility(page, 'visible');
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
  await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
  await unlockScreen(page);
  await expect(strict).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '표준 · 작업 이어가기', exact: true }).click();
  expect(await tracksLive(page)).toBe(false);
  await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
  await expect(recording.getByLabel('중단된 암호화 음성', { exact: true })).toBeVisible();
  await expect(recording.getByLabel('중단된 암호화 음성', { exact: true })).not.toHaveText('0 B');
  await expect(recording.getByRole('button', { name: '녹음 시작', exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: info.outputPath('390-strict-interrupted-recording-preserved.png'), fullPage: true });
  await page.evaluate(() => (window as unknown as { syntheticCapture: { close(): Promise<void> } }).syntheticCapture.close());
  expect((await inspectVaultSentinels(page, [title])).leakedSentinelIndices).toEqual([]);
});

test('changing pending STT to strict waits for the next manual screen lock and keeps the prepared audio without automatic retry', async ({ page }, info) => {
  await isolateNetwork(page);
  const calls: string[] = [], failures: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  page.on('requestfailed', request => { if (request.url().startsWith('http://localhost:8000/')) failures.push(request.url()); });
  await page.route('http://localhost:8000/**', async route => {
    calls.push(route.request().url()); await hold;
    try { await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ text: transcript }) }); }
    catch { /* The strict-lock boundary intentionally cancels this intercepted request. */ }
  });
  try {
    await createVault(page); await syntheticModels(page);
    await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
    const title = 'SYNTHETIC_STRICT_STT_PRESERVATION';
    await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
    await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_STRICT_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
    await page.getByRole('button', { name: '전사 준비', exact: true }).click();
    await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
    await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption({ label: 'SYNTHETIC_LOCK_STT' });
    await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
    await page.getByRole('button', { name: '전사 실행', exact: true }).click();
    await expect.poll(() => calls.length).toBe(1);
    await expect(page.locator('.sidebar').getByRole('button', { name: '설정', exact: true })).toBeEnabled();
    await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
    const strict = page.getByRole('button', { name: '엄격 · 잠글 때 작업 중지', exact: true });
    await strict.click(); await expect(strict).toHaveAttribute('aria-pressed', 'true');
    expect(failures).toEqual([]); expect(calls).toHaveLength(1);
    await page.getByRole('button', { name: '진행 중 작업으로 돌아가기', exact: true }).click();
    await expect(page.locator('.stt-grid')).toBeVisible(); expect(failures).toEqual([]);
    await clickAppAction(page, '설정');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    expect(failures).toEqual([]);
    await page.locator('.sidebar').getByRole('button', { name: '화면 잠금', exact: true }).click();
    await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
    await expect.poll(() => failures.length).toBe(1);
    release();
    await expect(page.getByText(/보관함 키 참조를 해제했어요/)).toBeVisible();
    await unlockScreen(page);
    await expect(strict).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '표준 · 작업 이어가기', exact: true }).click();
    await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
    await expect(page.getByRole('region', { name: '전사 준비', exact: true }).getByText('SYNTHETIC_STRICT_SOURCE.wav', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '음성 메모 단계', exact: true }).getByRole('button').nth(1).click();
    await expect(page.locator('.saved-count')).toHaveText('전사 결과 0 / 1');
    await expect(page.getByRole('button', { name: '전사 실행', exact: true })).toBeDisabled(); // Acknowledgment is never restored across lock.
    expect(calls).toHaveLength(1);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.screenshot({ path: info.outputPath('820-strict-stt-cancelled-prepared-audio-preserved.png'), fullPage: true });
    expect((await inspectVaultSentinels(page, [title, 'SYNTHETIC_STRICT_SOURCE.wav'])).leakedSentinelIndices).toEqual([]);
  } finally { release(); }
});
