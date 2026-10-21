// Release-built preview only. Disposable vaults, synthetic WebAudio and intercepted inference.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createModelPreset, exportModelProfiles } from '../../src/react-app/providers/model-profiles';
import { clickAppAction, createVault, inspectVaultSentinels, passphrase, toneWav } from './helpers';

const title = 'SYNTHETIC_BUILT_PRIVATE_MEMO';
const transcript = 'SYNTHETIC_BUILT_RAW_TRANSCRIPT: 다음 주에 음성 메모의 결과를 공유합니다.';
const markdown = '# SYNTHETIC_BUILT_NOTES\n\n## 요약\n합성 음성 메모 결과를 공유합니다.';
const draft = markdown + '\n\nSYNTHETIC_BUILT_UNSAVED_DRAFT';
const consentName = '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.';

function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
async function screenshot(page: Page, info: TestInfo, name: string) { await page.screenshot({ path: info.outputPath(name), fullPage: true }); }
async function top(page: Page) { await page.locator('main').evaluate(node => { node.scrollTop = 0; }); }
async function fullyVisible(page: Page, locator: Locator) {
  const bounds = await locator.boundingBox(), size = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height);
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
  return bounds!;
}
async function builtGuard(page: Page) {
  const external: string[] = [], errors: string[] = [], consoleText: string[] = [], assets: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => consoleText.push(message.text()));
  page.on('request', request => { if (new URL(request.url()).origin === 'http://127.0.0.1:4193') assets.push(new URL(request.url()).pathname); });
  await page.route('https://**/*', async route => { external.push(route.request().url()); await route.abort(); });
  return { external, errors, consoleText, assets };
}
async function assertBuilt(assets: string[]) {
  expect(assets.some(asset => /^\/assets\/index-.*\.js$/u.test(asset))).toBe(true);
  expect(assets.filter(asset => asset.startsWith('/src/') || asset.startsWith('/@vite'))).toEqual([]);
}
async function unlockScreen(page: Page, secret = passphrase) {
  await page.getByLabel('암호', { exact: true }).fill(secret);
  await page.getByRole('button', { name: '화면 잠금 해제', exact: true }).click();
}
async function microphone(page: Page, holdPermission = false) {
  await page.addInitScript(hold => {
    const state = { calls: 0, tracks: [] as MediaStreamTrack[], contexts: [] as AudioContext[] };
    let allow!: () => void;
    const permission = new Promise<void>(resolve => { allow = resolve; });
    (window as unknown as { syntheticAllowPermission: () => void }).syntheticAllowPermission = allow;
    (window as unknown as { syntheticCapture: typeof state }).syntheticCapture = state;
    navigator.mediaDevices.getUserMedia = async () => {
      state.calls++;
      if (hold) await permission;
      const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain();
      const destination = context.createMediaStreamDestination(); oscillator.frequency.value = 440; gain.gain.value = .2;
      oscillator.connect(gain); gain.connect(destination); oscillator.start(); await context.resume();
      state.contexts.push(context); state.tracks.push(...destination.stream.getTracks()); return destination.stream;
    };
  }, holdPermission);
}
async function captureState(page: Page) { return page.evaluate(() => {
  const state = (window as unknown as { syntheticCapture: { calls: number; tracks: MediaStreamTrack[] } }).syntheticCapture;
  return { calls: state.calls, live: state.tracks.filter(track => track.readyState === 'live').length };
}); }
async function closeMicrophone(page: Page) { await page.evaluate(async () => {
  await Promise.all((window as unknown as { syntheticCapture: { contexts: AudioContext[] } }).syntheticCapture.contexts.map(context => context.close()));
}); }
async function visibility(page: Page, value: 'hidden' | 'visible') {
  // Synthetic DOM boundary: this locked macOS host does not supply native visibility transitions.
  await page.evaluate(next => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: next }); document.dispatchEvent(new Event('visibilitychange')); }, value);
}
async function importModels(page: Page) {
  await clickAppAction(page, '설정');
  const manager = page.getByRole('region', { name: '모델 관리', exact: true });
  await manager.getByRole('button', { name: 'JSON 가져오기', exact: true }).click();
  const models = [
    { ...createModelPreset('compatible-stt'), name: 'SYNTHETIC_BUILT_STT', modelId: 'synthetic-built-stt' },
    { ...createModelPreset('compatible-text'), name: 'SYNTHETIC_BUILT_LLM', modelId: 'synthetic-built-llm', llm: { tokenField: 'max_tokens' as const, maxTokens: 4096, contextTokens: 32000 } },
  ];
  const importer = page.getByRole('region', { name: '모델 가져오기', exact: true });
  await importer.getByLabel('모델 JSON', { exact: true }).fill(exportModelProfiles(models));
  await importer.getByRole('button', { name: '미리보기', exact: true }).click();
  await importer.getByRole('button', { name: '가져오기', exact: true }).click();
  for (const model of models) {
    await manager.getByRole('listitem').filter({ has: page.getByText(model.name, { exact: true }) }).getByRole('button', { name: '수정', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '모델 수정', exact: true });
    await editor.getByRole('checkbox', { name: '이 모델 활성화', exact: true }).check();
    await editor.getByRole('button', { name: '저장', exact: true }).click(); await expect(editor).toHaveCount(0);
  }
}
async function newPreparedMemo(page: Page) {
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_BUILT_SOURCE.wav', mimeType: 'audio/wav', buffer: toneWav(2) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  await expect(page.getByRole('button', { name: '전사하기 →', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '전사하기 →', exact: true }).click();
  await page.getByRole('combobox', { name: '전사 모델', exact: true }).selectOption({ label: 'SYNTHETIC_BUILT_STT' });
}

for (const width of [390, 820]) test(`built standard recording keeps work and prioritizes controls at ${width}`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1180 });
  const guard = await builtGuard(page); await microphone(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  await expect(recording.getByRole('button', { name: '녹음 시작', exact: true })).toBeEnabled();
  await writeFile(info.outputPath('start-enabled.json'), JSON.stringify({ enabled: await recording.getByRole('button', { name: '녹음 시작', exact: true }).isEnabled() }));
  // Two events in the same JS task exercise the current handler before a rerender can disable it.
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(recording.getByRole('status')).toHaveText('녹음 중');
  await expect(page.getByRole('button', { name: '메모 정보 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('textbox', { name: /^메모 제목/ })).toHaveCount(0);
  await top(page);
  const statusBounds = await fullyVisible(page, recording.getByRole('status'));
  const saveBounds = await fullyVisible(page, recording.getByRole('button', { name: '저장 후 종료', exact: true }));
  await expect(recording.getByLabel('암호화 저장된 음성', { exact: true })).not.toHaveText('0.00 MB');
  expect(await captureState(page)).toEqual({ calls: 1, live: 1 });
  await expect(page.getByText('작업 중이에요.', { exact: true })).toHaveCount(0);
  await writeFile(info.outputPath('recording-geometry.json'), JSON.stringify({ viewport: page.viewportSize(), withBusyNotice: { status: statusBounds, save: saveBounds }, afterNotice: { status: await recording.getByRole('status').boundingBox(), save: await recording.getByRole('button', { name: '저장 후 종료', exact: true }).boundingBox() } }, null, 2));
  const before = await recording.getByLabel('녹음 길이', { exact: true }).innerText();
  await screenshot(page, info, `${width}-recording-priority.png`);
  if (width === 390) {
    await page.setViewportSize({ width: 1440, height: 900 }); await top(page);
    await screenshot(page, info, '1440-recording-independent-three-track-rows.png');
    await page.setViewportSize({ width: 390, height: 844 }); await top(page);
  }
  await clickAppAction(page, '화면 잠금');
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
  expect(await page.locator('body').innerText()).not.toContain(title);
  const detail = page.getByText('화면 잠금의 보호 범위', { exact: true }).locator('..');
  await expect(detail).not.toHaveAttribute('open', '');
  expect(await page.locator('body').innerText()).not.toContain('탭 메모리');
  await unlockScreen(page, 'synthetic incorrect passphrase');
  await expect(page.getByRole('alert')).toContainText('암호를 확인할 수 없어요');
  expect(await captureState(page)).toEqual({ calls: 1, live: 1 });
  await screenshot(page, info, `${width}-locked-recording.png`);
  await page.waitForTimeout(1100); // Real audio sample clock, not a fabricated timer.
  await unlockScreen(page);
  await expect(recording.getByRole('status')).toHaveText('녹음 중');
  await expect(recording.getByLabel('녹음 길이', { exact: true })).not.toHaveText(before);
  await page.getByRole('button', { name: '메모 정보 펼치기', exact: true }).click();
  await expect(page.getByRole('textbox', { name: /^메모 제목/ })).toHaveValue(title);
  await page.getByRole('button', { name: '메모 정보 접기', exact: true }).click();
  await recording.getByRole('button', { name: '저장 후 종료', exact: true }).click();
  await expect(recording.getByRole('status')).toHaveText('녹음 저장 완료');
  expect(await captureState(page)).toEqual({ calls: 1, live: 0 });
  await closeMicrophone(page);
  const audit = await inspectVaultSentinels(page, [title]); expect(audit.leakedSentinelIndices).toEqual([]);
  await assertBuilt(guard.assets); expect(guard.errors).toEqual([]); expect(guard.external).toEqual([]);
  await writeFile(info.outputPath('recording-evidence.json'), JSON.stringify({ audit, assets: guard.assets, capture: await captureState(page), syntheticVisibility: true }, null, 2));
});

test('built strict hidden boundary keeps committed fragments without automatic restart', async ({ page }, info) => {
  const guard = await builtGuard(page); await microphone(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
  await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
  const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
  await recording.getByRole('button', { name: '녹음 시작', exact: true }).click();
  await expect(recording.getByLabel('암호화 저장된 음성', { exact: true })).not.toHaveText('0.00 MB');
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  await page.getByRole('button', { name: '엄격 · 잠글 때 작업 중지', exact: true }).click();
  expect((await captureState(page)).live).toBe(1);
  await visibility(page, 'hidden');
  await expect.poll(async () => (await captureState(page)).live).toBe(0);
  await visibility(page, 'visible');
  await expect(page.getByRole('heading', { name: '화면이 잠겼어요', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '화면 잠금 해제', exact: true })).toBeDisabled();
  await page.getByLabel('암호', { exact: true }).fill(passphrase);
  await expect(page.getByRole('button', { name: '화면 잠금 해제', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '화면 잠금 해제', exact: true }).click();
  await page.getByRole('button', { name: '표준 · 작업 이어가기', exact: true }).click();
  await page.locator('.sidebar').getByRole('button', { name: title, exact: true }).click();
  await expect(recording.getByLabel('중단된 암호화 음성', { exact: true })).not.toHaveText('0 B');
  await expect(recording.getByLabel('녹음 길이', { exact: true })).toHaveCount(0);
  await expect(recording.getByRole('button', { name: '녹음 시작', exact: true })).toBeDisabled();
  expect(await captureState(page)).toEqual({ calls: 1, live: 0 });
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot(page, info, '390-strict-fragments-preserved.png');
  await closeMicrophone(page); expect((await inspectVaultSentinels(page, [title])).leakedSentinelIndices).toEqual([]);
  await assertBuilt(guard.assets); expect(guard.errors).toEqual([]);
});

test('built rapid touch and Enter share one recording permission and capture', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:4193', viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    const guard = await builtGuard(page); await microphone(page, true); await createVault(page);
    await page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
    await page.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
    const recording = page.getByRole('region', { name: '마이크 녹음', exact: true });
    const start = recording.getByRole('button', { name: '녹음 시작', exact: true });
    await expect(start).toBeEnabled();
    await start.scrollIntoViewIfNeeded(); await start.focus();
    const box = (await start.boundingBox())!;
    await page.evaluate(() => {
      const events: unknown[] = [];
      (window as unknown as { syntheticInputs: unknown[] }).syntheticInputs = events;
      for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'keyup']) document.addEventListener(type, event => {
        const target = event.target as HTMLElement, rect = target.getBoundingClientRect();
        events.push({ type, text: target.innerText, trusted: event.isTrusted, x: (event as PointerEvent).clientX, y: (event as PointerEvent).clientY, key: (event as KeyboardEvent).key, time: performance.now(), bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, active: (document.activeElement as HTMLElement)?.innerText });
      }, true);
    });
    await page.keyboard.press('Enter');
    await expect(recording.getByRole('status')).toHaveText('마이크 권한을 기다리고 있어요');
    const targetBeforeSecondInput = await page.evaluate(({ x, y }) => ({ time: performance.now(), text: (document.elementFromPoint(x, y) as HTMLElement)?.innerText }), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => (window as unknown as { syntheticAllowPermission: () => void }).syntheticAllowPermission());
    await page.waitForTimeout(100);
    await writeFile(info.outputPath('touch-enter-inputs.json'), JSON.stringify({ before: box, targetBeforeSecondInput, capture: await captureState(page), events: await page.evaluate(() => (window as unknown as { syntheticInputs: unknown[] }).syntheticInputs) }, null, 2));
    await expect(recording.getByRole('status')).toHaveText('녹음 중');
    expect(await captureState(page)).toEqual({ calls: 1, live: 1 });
    await expect(recording.getByLabel('입력된 음성', { exact: true })).not.toHaveText('0.00 MB');
    await recording.getByRole('button', { name: '저장 후 종료', exact: true }).tap();
    await expect(recording.getByRole('status')).toHaveText('녹음 저장 완료');
    expect(await captureState(page)).toEqual({ calls: 1, live: 0 });
    await closeMicrophone(page); await assertBuilt(guard.assets); expect(guard.errors).toEqual([]);
    await writeFile(info.outputPath('touch-enter-duplicate.json'), JSON.stringify({ capture: await captureState(page), hasTouch: true }));
    const cancelContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4193', viewport: { width: 390, height: 844 }, hasTouch: true });
    try {
      const cancelPage = await cancelContext.newPage(); await builtGuard(cancelPage); await microphone(cancelPage, true); await createVault(cancelPage);
      await cancelPage.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true }).click();
      await cancelPage.getByRole('tab', { name: '마이크 녹음', exact: true }).click();
      const pending = cancelPage.getByRole('region', { name: '마이크 녹음', exact: true });
      await pending.getByRole('button', { name: '녹음 시작', exact: true }).tap();
      await expect(pending.getByRole('status')).toHaveText('마이크 권한을 기다리고 있어요');
      await pending.getByRole('button', { name: '녹음 취소', exact: true }).tap();
      await expect(pending.getByRole('status')).toHaveText('녹음을 취소했어요');
      await cancelPage.evaluate(() => (window as unknown as { syntheticAllowPermission: () => void }).syntheticAllowPermission());
      await expect.poll(() => cancelPage.evaluate(() => (window as unknown as { syntheticCapture: { contexts: AudioContext[] } }).syntheticCapture.contexts.length)).toBe(1);
      await expect.poll(async () => (await captureState(cancelPage)).live).toBe(0);
      expect((await captureState(cancelPage)).calls).toBe(1);
      await writeFile(info.outputPath('explicit-permission-cancel.json'), JSON.stringify(await captureState(cancelPage)));
      await closeMicrophone(cancelPage);
    } finally { await cancelContext.close(); }
  } finally { await context.close(); }
});

test('built 768 security keeps details and reset closed with reset confirmation preserved', async ({ page }, info) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  const guard = await builtGuard(page); await createVault(page);
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  await top(page);
  for (const name of ['저장과 보호 범위 자세히', '자동 잠금 자세히', '보관함 초기화']) {
    await expect(page.getByText(name, { exact: true }).locator('..')).not.toHaveAttribute('open', '');
  }
  expect(await page.locator('body').innerText()).not.toContain('암호를 잊으면');
  await expect(page.getByText('입력하거나 화면을 조작하면 대기 시간이 다시 시작됩니다.', { exact: true })).toBeVisible();
  await screenshot(page, info, '768-security-default-closed.png');
  await page.getByText('보관함 초기화', { exact: true }).click();
  const reset = page.locator('.vault-management'); await expect(reset).toHaveAttribute('open', '');
  await reset.getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작', exact: true }).click();
  await expect(reset.getByRole('dialog')).toBeVisible();
  await expect(reset.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true })).toBeDisabled();
  await screenshot(page, info, '768-security-reset-expanded-no-delete.png');
  await reset.getByRole('button', { name: '취소', exact: true }).click();
  await assertBuilt(guard.assets); expect(guard.errors).toEqual([]);
});

test('built transcript and notes survive lock, deduplicate submissions and compact result settings', async ({ page }, info) => {
  test.setTimeout(120000);
  const guard = await builtGuard(page), stt = deferred(), firstNotes = deferred(), secondNotes = deferred();
  const calls: string[] = [];
  await page.route('http://localhost:8000/**', async route => {
    const url = route.request().url(); calls.push(url);
    const isSTT = url.endsWith('/audio/transcriptions');
    await (isSTT ? stt.promise : calls.filter(call => call.endsWith('/chat/completions')).length === 1 ? firstNotes.promise : secondNotes.promise);
    await route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(isSTT
      ? { text: transcript, usage: { type: 'duration', seconds: 2 } }
      : { model: 'synthetic-built-llm', choices: [{ message: { content: markdown }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 45 } }) });
  });
  try {
    await createVault(page); await importModels(page);
    await screenshot(page, info, '1440-model-settings.png');
    await newPreparedMemo(page);
    await page.getByRole('checkbox', { name: '위 내용을 확인했어요', exact: true }).check();
    const start = page.getByRole('button', { name: '전사 실행', exact: true });
    await start.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect.poll(() => calls.filter(call => call.endsWith('/audio/transcriptions')).length).toBe(1);
    await screenshot(page, info, '1440-transcription-running.png');
    await clickAppAction(page, '화면 잠금'); stt.release();
    await expect(page.getByText('저장된 음성 메모가 준비되어 있습니다. 암호를 입력해 돌아가세요.', { exact: true })).toBeVisible();
    expect(await page.locator('body').innerText()).not.toContain(transcript);
    await unlockScreen(page);
    await expect(page.locator('.review-grid')).toContainText(transcript);
    await page.getByRole('button', { name: '이 전사문으로 메모 정리', exact: true }).click();
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.getByRole('combobox', { name: '정리 모델', exact: true }).selectOption({ label: 'SYNTHETIC_BUILT_LLM' });
    await page.getByRole('checkbox', { name: consentName, exact: true }).check();
    await page.getByRole('button', { name: '정리 노트 생성', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect.poll(() => calls.filter(call => call.endsWith('/chat/completions')).length).toBe(1);
    firstNotes.release();
    await expect(page.locator('.minutes-output')).toContainText('SYNTHETIC_BUILT_NOTES');
    const showSetup = page.getByRole('button', { name: '정리 설정 펼치기', exact: true });
    await expect(showSetup).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('combobox', { name: '정리 모델', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '사용량·비용 상세 펼치기', exact: true })).toHaveAttribute('aria-expanded', 'false');
    // Also verify the completed result's encrypted restore; it clears the earlier
    // duplicate-action status through the actual lock/unlock lifecycle.
    await clickAppAction(page, '화면 잠금');
    await expect(page.getByText('저장된 음성 메모가 준비되어 있습니다. 암호를 입력해 돌아가세요.', { exact: true })).toBeVisible();
    await unlockScreen(page); await expect(showSetup).toHaveAttribute('aria-expanded', 'false');
    await top(page); await fullyVisible(page, page.locator('.minutes-output'));
    await screenshot(page, info, '820-notes-result-settings-collapsed.png');
    await showSetup.click();
    await expect(page.getByRole('checkbox', { name: consentName, exact: true })).not.toBeChecked();
    await expect(page.getByRole('button', { name: '이 설정으로 다시 생성', exact: true })).toBeDisabled();
    await page.getByRole('textbox', { name: '추가 작성 지침', exact: true }).fill('SYNTHETIC_BUILT_EXPLICIT_SETTINGS_EDIT');
    await expect(page.getByRole('status', { name: '생성 가능 여부', exact: true })).toHaveText('전송 확인에 체크하면 생성할 수 있어요.');
    await page.getByRole('checkbox', { name: consentName, exact: true }).check();
    const regenerate = page.getByRole('button', { name: '이 설정으로 다시 생성', exact: true });
    await expect(regenerate).toBeEnabled();
    const originalRegenerate = await regenerate.elementHandle();
    await regenerate.focus(); await page.keyboard.press('Enter');
    // The same DOM button is now labelled Generating; keep the originally
    // focused element for the rapid stale action rather than querying its old label.
    await originalRegenerate!.evaluate(button => { (button as HTMLButtonElement).click(); button.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await expect.poll(() => calls.filter(call => call.endsWith('/chat/completions')).length).toBe(2);
    secondNotes.release();
    await expect(page.getByRole('combobox', { name: '정리 노트 버전', exact: true }).locator('option')).toHaveCount(2);
    await expect(page.getByRole('button', { name: '정리 설정 접기', exact: true })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('textbox', { name: '추가 작성 지침', exact: true })).toHaveValue('SYNTHETIC_BUILT_EXPLICIT_SETTINGS_EDIT');
    await screenshot(page, info, '820-notes-user-settings-open-after-response.png');
    await page.getByRole('button', { name: '사용량·비용 상세 펼치기', exact: true }).click();
    const usage = page.getByRole('region', { name: '사용량 명세', exact: true });
    await expect(usage.getByRole('table')).toBeVisible();
    await usage.getByText('정리 노트 · 토큰·시간·상태 상세', { exact: true }).click();
    await expect(usage).toContainText('246'); await expect(usage).toContainText('90');
    await screenshot(page, info, '820-usage-details-values-preserved.png');
    await page.getByRole('button', { name: '편집', exact: true }).click();
    await page.getByRole('textbox', { name: 'Markdown 편집기', exact: true }).fill(draft);
    await clickAppAction(page, '화면 잠금');
    await expect(page.getByText('저장된 음성 메모가 준비되어 있습니다. 암호를 입력해 돌아가세요.', { exact: true })).toBeVisible();
    for (const sentinel of [title, transcript, markdown, draft]) expect(await page.locator('body').innerText()).not.toContain(sentinel);
    const audit = await inspectVaultSentinels(page, [title, transcript, markdown, draft]); expect(audit.leakedSentinelIndices).toEqual([]);
    const storage = await page.evaluate(async () => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), caches: await caches.keys(), serviceWorkers: (await navigator.serviceWorker.getRegistrations()).length }));
    const text = JSON.stringify({ storage, console: guard.consoleText });
    for (const sentinel of [title, transcript, markdown, draft]) expect(text).not.toContain(sentinel);
    expect(storage.caches).toEqual([]); expect(storage.serviceWorkers).toBe(0);
    await unlockScreen(page); await expect(page.getByRole('textbox', { name: 'Markdown 편집기', exact: true })).toHaveValue(draft);
    expect(calls.filter(call => call.endsWith('/audio/transcriptions'))).toHaveLength(1);
    expect(calls.filter(call => call.endsWith('/chat/completions'))).toHaveLength(2);
    await page.setViewportSize({ width: 1440, height: 900 });
    await clickAppAction(page, '처리 기록'); await top(page); await screenshot(page, info, '1440-processing-history-list.png');
    await page.getByRole('button', { name: `처리 기록 ${title}`, exact: true }).click(); await top(page); await screenshot(page, info, '1440-processing-history-detail.png');
    await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click(); await top(page); await screenshot(page, info, '1440-home-synthetic-results.png');
    await assertBuilt(guard.assets); expect(guard.errors).toEqual([]); expect(guard.external).toEqual([]);
    await writeFile(info.outputPath('storage-and-requests.json'), JSON.stringify({ audit, storage, calls, assets: guard.assets, consoleCount: guard.consoleText.length }, null, 2));
  } finally { stt.release(); firstNotes.release(); secondNotes.release(); }
});
