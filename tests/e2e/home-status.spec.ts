import { expect, test, type Locator, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { clickAppAction, configureFixtureMinutes, selectFixtureMinutesRoute, prepareForTranscription, createVault, enterFixtureKeys, fixtureText, fixtureTransport, inspectVaultSentinels, routerEndpoint, routerModel, toneWav, unlock } from './helpers';

const ordinaryTitle = 'TEST_ONLY_HOME_ORDINARY';
const historyTitle = 'TEST_ONLY_HOME_FAILED_COMPARISON';
const pinPath = 'M9 4h6l-1 6 3 3H7l3-3z M12 13v7';
const unpinPath = `${pinPath} M4 4l16 16`;
const modelB = { ...routerModel, id: 'fixture/home-b', name: 'Keyless Home comparison B' };
const endpointB = { ...routerEndpoint, tag: 'FixtureHomeB/region', provider_name: 'FixtureHomeB' };
const homeRow = (page: Page, title: string) => page.locator('.meeting-row').filter({ has: page.getByText(title, { exact: true }) });

async function lockReloadAndUnlock(page: Page) {
  await clickAppAction(page, '지금 잠그기');
  // The heading is shared by locking and locked. Enabled input proves that
  // encrypted finalization has completed before the browser is reloaded.
  await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '잠금 해제', exact: true })).toBeVisible();
  await page.reload(); await unlock(page);
}

async function prepareMeeting(page: Page, title: string, comparison: boolean) {
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill(title);
  await page.locator('input[type=file]').setInputFiles({ name: `${title}.wav`, mimeType: 'audio/wav', buffer: toneWav() });
  await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe');
  await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
  await page.getByRole('button', { name: '전사 실행' }).click();
  await expect(page.getByText(fixtureText).first()).toBeVisible();
  await page.getByRole('button', { name: /정리 노트/ }).first().click();
  await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag);
  if (comparison) {
    await page.getByRole('button', { name: '모델 비교', exact: true }).click();
    await selectFixtureMinutesRoute(page, modelB.id, endpointB.tag, 'ko', true);
    await page.getByRole('checkbox', { name: '순차 요청 두 번의 전송·요금을 확인했어요' }).check();
    await page.getByRole('button', { name: '두 모델 비교 실행' }).click();
    await expect(page.getByRole('article', { name: 'B 결과' })).toContainText('실패');
    await page.getByRole('button', { name: 'A 결과 사용', exact: true }).click();
  } else {
    await page.getByRole('checkbox', { name: '선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.' }).check();
    await page.getByRole('button', { name: '정리 노트 생성', exact: true }).click();
  }
  await expect(page.locator('.minutes-output')).toContainText('TEST_ONLY_HOME_SAVED');
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
}

async function assertRenderedRow(row: Locator, pinned: boolean, disabled: boolean) {
  await expect(row.locator('.badge')).toHaveText('정리 노트 완료');
  await expect(row.locator('.badge')).toHaveClass('badge done');
  const button = row.getByRole('button', { name: new RegExp(`^${pinned ? '고정 해제' : '고정'} `) });
  await expect(button).toHaveAttribute('aria-pressed', String(pinned));
  await expect(button.locator('path')).toHaveAttribute('d', pinned ? unpinPath : pinPath);
  if (disabled) await expect(button).toBeDisabled(); else await expect(button).toBeEnabled();
  const colors = await row.evaluate((element, state) => {
    const colorOf = (variable: string) => {
      const probe = document.createElement('span'); probe.style.color = `var(${variable})`; element.append(probe);
      const value = getComputedStyle(probe).color; probe.remove(); return value;
    };
    const badge = element.querySelector('.badge')!;
    const pin = element.querySelector('button[aria-pressed]')!;
    const glyph = pin.querySelector('svg')!;
    return { badge: { color: getComputedStyle(badge).color, background: getComputedStyle(badge).backgroundColor },
      expectedBadge: { color: colorOf('--ok'), background: colorOf('--okSoft') },
      pin: { color: getComputedStyle(pin).color, background: getComputedStyle(pin).backgroundColor },
      expectedPin: { color: colorOf(state ? '--accent' : '--ink3'), background: colorOf(state ? '--accentSoft' : '--surface') },
      glyph: { stroke: getComputedStyle(glyph).stroke, fill: getComputedStyle(glyph).fill, width: getComputedStyle(glyph).strokeWidth, cap: getComputedStyle(glyph).strokeLinecap, join: getComputedStyle(glyph).strokeLinejoin },
      opacity: getComputedStyle(pin).opacity };
  }, pinned);
  expect(colors.badge).toEqual(colors.expectedBadge); expect(colors.pin).toEqual(colors.expectedPin);
  expect(colors.glyph).toEqual({ stroke: colors.pin.color, fill: 'none', width: '1.8px', cap: 'round', join: 'round' });
  expect(colors.opacity).toBe(disabled ? '0.48' : '1');
  return colors;
}

test('completed rows and reference pin states render across themes/palettes and survive encrypted reload', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const calls = await fixtureTransport(page);
  let completions = 0;
  await page.route('https://openrouter.ai/api/v1/**', async route => {
    const url = route.request().url(); let body: unknown = { data: [] }; let status = 200;
    if (url.endsWith('/models')) body = { data: [routerModel, modelB] };
    else if (url.endsWith('/endpoints')) body = { data: { id: url.includes('home-b') ? modelB.id : routerModel.id, endpoints: [url.includes('home-b') ? endpointB : routerEndpoint] } };
    else if (url.endsWith('/chat/completions')) {
      completions++; const request = route.request().postDataJSON(); const isB = request.model === modelB.id;
      expect(request.provider.only).toEqual([isB ? endpointB.tag : routerEndpoint.tag]); expect(request.provider.allow_fallbacks).toBe(false);
      if (isB) { status = 400; body = { error: { message: 'TEST_ONLY_HOME_COMPARISON_FAILURE' } }; }
      else body = { model: request.model, choices: [{ message: { content: '# TEST_ONLY_HOME_SAVED\n\nSynthetic grounded result.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } };
    } else { await route.fallback(); return; }
    await route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  await createVault(page); await enterFixtureKeys(page);
  await configureFixtureMinutes(page, [{ modelId: routerModel.id, endpointTag: routerEndpoint.tag }, { modelId: modelB.id, endpointTag: endpointB.tag }]);
  await prepareMeeting(page, ordinaryTitle, false); await prepareMeeting(page, historyTitle, true);
  const ordinary = homeRow(page, ordinaryTitle); const history = homeRow(page, historyTitle);
  await expect(history.locator('.badge')).toHaveClass('badge done');
  await expect(history.getByText('실패한 요청 기록이 이 음성 메모에 남아 있어요.')).toBeVisible();
  await assertRenderedRow(ordinary, false, false); await assertRenderedRow(history, false, false);
  // Test runner only: hold the next actual encrypted metadata-save transaction
  // open, so Home's real busy/disabled state can be inspected without a timing race.
  // The controller intentionally blocks navigation into Home during inference.
  await page.evaluate(() => {
    const fixture = window as unknown as { homeHoldNextSave: boolean; homeSaveHeld: boolean; homeKeepSaveOpen: boolean; homeCheckpointCompletions: number; homeRestoreTransaction: () => void };
    fixture.homeCheckpointCompletions = 0;
    const original = IDBDatabase.prototype.transaction;
    fixture.homeRestoreTransaction = () => { IDBDatabase.prototype.transaction = original; };
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      const transaction = original.apply(this, args);
      const projectCheckpoint = this.name === 'mom-encrypted-vault-v1' && args[1] === 'readwrite' && transaction.objectStoreNames.contains('records') && transaction.objectStoreNames.contains('header');
      if (projectCheckpoint) transaction.addEventListener('complete', () => { fixture.homeCheckpointCompletions++; });
      if (fixture.homeHoldNextSave && projectCheckpoint) {
        fixture.homeHoldNextSave = false; fixture.homeSaveHeld = true;
        const store = transaction.objectStore('records');
        const keepAlive = () => {
          if (!fixture.homeKeepSaveOpen) return;
          const request = store.get('TEST_ONLY_HOME_ABSENT_RECORD'); request.onsuccess = keepAlive;
        };
        keepAlive();
      }
      return transaction;
    };
  });
  await ordinary.getByRole('button', { name: `고정 ${ordinaryTitle}`, exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { homeCheckpointCompletions: number }).homeCheckpointCompletions > 0);
  await expect(ordinary.getByRole('button', { name: `고정 해제 ${ordinaryTitle}`, exact: true })).toBeEnabled();
  const evidence: unknown[] = [];
  for (const mode of ['light', 'dark', 'system-light', 'system-dark'] as const) {
    const theme = mode.startsWith('system') ? 'system' : mode;
    await page.emulateMedia({ colorScheme: mode.endsWith('dark') ? 'dark' : 'light' });
    for (const palette of ['cobalt', 'teal', 'mono'] as const) {
      await clickAppAction(page, '설정');
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: theme === 'light' ? '라이트' : theme === 'dark' ? '다크' : '시스템 설정', exact: true }).click();
      await page.getByRole('button', { name: palette === 'cobalt' ? /^코발트/ : palette === 'teal' ? /^틸 · 스톤/ : /^모노/ }).click();
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
      await expect(page.locator('.mom')).toHaveAttribute('data-theme', theme); await expect(page.locator('.mom')).toHaveAttribute('data-palette', palette);
      const first = await assertRenderedRow(ordinary, true, false); const second = await assertRenderedRow(history, false, false);
      expect(first.badge).toEqual(second.badge);
      const pin = history.getByRole('button', { name: `고정 ${historyTitle}`, exact: true });
      const completedBeforeToggle = await page.evaluate(() => (window as unknown as { homeCheckpointCompletions: number }).homeCheckpointCompletions);
      await history.getByRole('button', { name: `열기 ${historyTitle}`, exact: true }).focus(); await page.keyboard.press('Tab');
      await expect(pin).toBeFocused();
      expect(await pin.evaluate(element => ({ style: getComputedStyle(element).outlineStyle, width: getComputedStyle(element).outlineWidth }))).toEqual({ style: 'solid', width: '2px' });
      await page.keyboard.press('Enter'); await assertRenderedRow(history, true, false);
      await page.keyboard.press('Space'); await assertRenderedRow(history, false, false);
      const focusedPath = test.info().outputPath(`home-${mode}-${palette}-focused.png`);
      await page.screenshot({ path: focusedPath, fullPage: true });
      await test.info().attach(`home-${mode}-${palette}-focused`, { path: focusedPath, contentType: 'image/png' });
      evidence.push({ mode, palette, ordinary: first, history: second });
      await page.waitForFunction(before => (window as unknown as { homeCheckpointCompletions: number }).homeCheckpointCompletions > before, completedBeforeToggle);
      await expect(pin).toBeEnabled();
      await page.evaluate(() => {
        const fixture = window as unknown as { homeHoldNextSave: boolean; homeSaveHeld: boolean; homeKeepSaveOpen: boolean };
        fixture.homeHoldNextSave = true; fixture.homeSaveHeld = false; fixture.homeKeepSaveOpen = true;
      });
      await ordinary.getByRole('button', { name: `이름 변경 ${ordinaryTitle}`, exact: true }).click();
      await page.getByRole('textbox', { name: '메모 제목', exact: true }).press('Enter');
      await page.waitForFunction(() => (window as unknown as { homeSaveHeld: boolean }).homeSaveHeld);
      await assertRenderedRow(ordinary, true, true); await assertRenderedRow(history, false, true);
      const disabledPath = test.info().outputPath(`home-${mode}-${palette}-disabled.png`);
      await page.screenshot({ path: disabledPath, fullPage: true });
      await test.info().attach(`home-${mode}-${palette}-disabled`, { path: disabledPath, contentType: 'image/png' });
      await page.evaluate(() => { (window as unknown as { homeKeepSaveOpen: boolean }).homeKeepSaveOpen = false; });
      await expect(ordinary.getByRole('button', { name: `고정 해제 ${ordinaryTitle}`, exact: true })).toBeEnabled();
    }
  }
  const colorPath = test.info().outputPath('computed-home-colors.json');
  await writeFile(colorPath, JSON.stringify(evidence, null, 2));
  await test.info().attach('computed-home-colors.json', { path: colorPath, contentType: 'application/json' });
  await page.evaluate(() => { (window as unknown as { homeRestoreTransaction: () => void }).homeRestoreTransaction(); });
  expect(completions).toBe(3); expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(2);
  const vault = await inspectVaultSentinels(page, [ordinaryTitle, historyTitle, 'TEST_ONLY_HOME_SAVED', 'KEYLESS_BROWSER_ROUTER_TEST']);
  expect(vault.leakedSentinelIndices).toEqual([]);
  await lockReloadAndUnlock(page);
  await assertRenderedRow(homeRow(page, ordinaryTitle), true, false); await assertRenderedRow(homeRow(page, historyTitle), false, false);
  await expect(homeRow(page, historyTitle).getByText('실패한 요청 기록이 이 음성 메모에 남아 있어요.')).toBeVisible();
  expect(completions).toBe(3); expect(errors).toEqual([]);
});

test('immediate Home unpin is saved at the completed lock barrier before reload', async ({ page }) => {
  await fixtureTransport(page);
  await page.route('https://openrouter.ai/api/v1/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ model: routerModel.id, choices: [{ message: { content: '# TEST_ONLY_HOME_SAVED\n\nSynthetic grounded result.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } }) }));
  await createVault(page); await enterFixtureKeys(page); await configureFixtureMinutes(page); await prepareMeeting(page, ordinaryTitle, false);
  await homeRow(page, ordinaryTitle).getByRole('button', { name: `고정 ${ordinaryTitle}`, exact: true }).click();
  await expect(homeRow(page, ordinaryTitle).getByRole('button', { name: `고정 해제 ${ordinaryTitle}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lockReloadAndUnlock(page);
  await assertRenderedRow(homeRow(page, ordinaryTitle), true, false);
  await homeRow(page, ordinaryTitle).getByRole('button', { name: `고정 해제 ${ordinaryTitle}`, exact: true }).click();
  await expect(homeRow(page, ordinaryTitle).getByRole('button', { name: `고정 ${ordinaryTitle}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
  await lockReloadAndUnlock(page);
  await assertRenderedRow(homeRow(page, ordinaryTitle), false, false);
});
