import { expect, test, type Locator, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, configureFixtureMinutes, selectFixtureMinutesRoute, prepareForTranscription, createVault, enterFixtureKeys, fixtureMarkdown, fixtureText, fixtureTransport, passphrase, routerEndpoint, routerModel, toneWav } from './helpers';

test.use({ hasTouch: true });
const phones = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }];
const evidence = '.superpowers/sdd/remaining-work/task-model-settings-fixtures/responsive';
async function fits(page: Page) {
  const bounds = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth }));
  expect(bounds.scroll, 'whole document stays inside the viewport').toBeLessThanOrEqual(bounds.width + 1);
  if (bounds.mainWidth !== undefined) expect(bounds.mainScroll, 'main stays bounded; tables scroll in their own wrappers').toBeLessThanOrEqual(bounds.mainWidth + 1);
}
async function horizontalBounds(locator: Locator, width: number) {
  for (const element of await locator.all()) {
    const bounds = await element.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(-1); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
  }
}
async function touchTargets(locator: Locator) {
  for (const element of await locator.all()) { const bounds = await element.boundingBox(); expect(bounds!.height).toBeGreaterThanOrEqual(44); }
}
for (const viewport of phones) test(`phone ${viewport.width} vault onboarding fits and fields remain reachable`, async ({ page }) => {
  await page.setViewportSize(viewport); await fixtureTransport(page); await page.goto('/');
  await expect(page.getByRole('heading', { name: '새 보관함 만들기' })).toBeVisible();
  await expect(page.getByText('Minutes of Meeting', { exact: true })).toBeVisible();
  await fits(page); await horizontalBounds(page.locator('.vault-card, .vault-card input, .vault-card button'), viewport.width);
  await touchTargets(page.locator('.vault-card input, .vault-card button'));
  await page.screenshot({ path: `${evidence}/${viewport.width}-ko-onboarding.png`, fullPage: true });
});
test('phone 360 navigation keeps legal links and scrollable settings tabs reachable', async ({ page }) => {
  const viewport = phones[0]; await page.setViewportSize(viewport); await fixtureTransport(page); await createVault(page);
  const sidebar = page.getByRole('complementary', { name: '음성 메모 탐색' });
  expect((await sidebar.boundingBox())!.height).toBeLessThanOrEqual(64);
  await touchTargets(sidebar.getByRole('button', { name: '탐색 메뉴', exact: true }));
  await expect(page.getByText('테스트 빌드 · 실제 AI 미검증')).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: '제3자 라이선스' })).toHaveCount(0);
  await expect(sidebar.getByRole('link', { name: '제3자 소스 · 재빌드 · 재연결' })).toHaveCount(0);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).tap();
  const navigation = page.getByRole('navigation', { name: '음성 메모 단계' }), steps = navigation.getByRole('button');
  await noClippedNavigation(navigation);
  await expect(steps).toHaveCount(3); await horizontalBounds(steps, viewport.width); await touchTargets(steps);
  await steps.nth(2).tap(); await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
  await clickAppAction(page, '설정');
  const legal = page.getByRole('navigation', { name: '앱 정보 · 라이선스' });
  await expect(legal.getByRole('link', { name: '제3자 라이선스' })).toBeVisible();
  await expect(legal.getByRole('link', { name: '제3자 소스 · 재빌드 · 재연결' })).toBeVisible();
  const tablist = page.getByRole('tablist', { name: '설정 항목' }), tabs = tablist.getByRole('tab');
  await expect(tabs).toHaveCount(4); await touchTargets(tabs);
  expect(await tablist.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await tabs.evaluateAll(elements => new Set(elements.map(element => Math.round(element.getBoundingClientRect().top))).size)).toBe(1);
  await tabs.first().focus(); await page.keyboard.press('End'); await expect(tabs.last()).toBeFocused();
  await expect(tabs.last()).toBeInViewport();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toBeInViewport();
  await fits(page);
  await clickAppAction(page, '지금 잠그기');
  await page.getByLabel('암호', { exact: true }).fill(passphrase); await fits(page);
});
test('phone 360 all three workflow steps are visible without a horizontal swipe', async ({ page }) => {
  await page.setViewportSize(phones[0]); await fixtureTransport(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).tap();
  const steps = page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button');
  await horizontalBounds(steps, 360); await touchTargets(steps);
});
test('phone 360 long unbroken voice memo title preserves workflow containment', async ({ page }) => {
  await page.setViewportSize(phones[0]); await fixtureTransport(page); await createVault(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).tap();
  const title = 'SYNTHETICQuarterlyMeeting'.repeat(5); await page.getByRole('textbox', { name: '메모 제목' }).fill(title);
  await page.getByRole('textbox', { name: '메모 제목' }).press('Tab'); await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await fits(page);
});

async function noClippedNavigation(locator: Locator) {
  expect(await locator.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  const parent = (await locator.boundingBox())!;
  for (const button of await locator.getByRole('button').all()) {
    const child = (await button.boundingBox())!;
    expect(child.x).toBeGreaterThanOrEqual(parent.x - 1);
    expect(child.x + child.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
  }
}
async function swipeTable(page: Page, table: Locator) {
  await table.scrollIntoViewIfNeeded();
  const bounds = (await table.boundingBox())!, width = page.viewportSize()!.width;
  const start = Math.min(bounds.x + bounds.width - 12, width - 12), end = bounds.x + 12;
  const y = Math.min(bounds.y + bounds.height / 2, page.viewportSize()!.height - 20);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start, y }] });
    for (let i = 1; i <= 8; i++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start + (end - start) * i / 8, y }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  } finally { await session.detach(); }
}
function playbackTone() {
  const oneSecond = toneWav(), data = Buffer.alloc(44 + 32000 * 6); oneSecond.copy(data, 0, 0, 44);
  for (let second = 0; second < 6; second++) oneSecond.copy(data, 44 + second * 32000, 44);
  data.writeUInt32LE(data.length - 8, 4); data.writeUInt32LE(data.length - 44, 40); return data;
}
const viewports = [...phones, { width: 768, height: 1024 }, { width: 1440, height: 900 }];
for (const viewport of viewports) for (const language of ['ko', 'en'] as const) {
  const fullWorkflow = viewport.width === 360 && language === 'ko' || viewport.width === 1440 && language === 'en';
  test(`${viewport.width} ${language} ${fullWorkflow ? 'touch workflow, editors, History' : 'navigation and long titles'}, settings and lock remain contained`, async ({ page }) => {
    await page.setViewportSize(viewport); const phone = viewport.width < 760, t = (ko: string, en: string) => language === 'ko' ? ko : en;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const calls = await fixtureTransport(page);
    // An intentionally long synthetic catalogue name exercises containment; inference stays intercepted.
    await page.route('https://openrouter.ai/api/v1/models', route => route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ data: [{ ...routerModel, name: 'SYNTHETICLongModelName'.repeat(8) }] }) }));
    await createVault(page); await enterFixtureKeys(page); await configureFixtureMinutes(page);
    if (language === 'en') {
      await clickAppAction(page, '설정');
      await page.getByRole('tab', { name: '화면 · 언어' }).tap(); await page.getByRole('button', { name: 'English', exact: true }).tap();
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).tap();
    }
    const metrics: unknown[] = [];
    const capture = async (state: string) => {
      await fits(page);
      if (phone) {
        await horizontalBounds(page.locator('main button:visible, main input:visible, main select:visible, main textarea:visible'), viewport.width);
        await touchTargets(page.locator('main button:visible, main input:not([type=checkbox]):not([type=radio]):not([type=file]):visible, main select:visible'));
      }
      metrics.push(await page.evaluate(state => ({ state, width: innerWidth, documentWidth: document.documentElement.scrollWidth,
        mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth,
        sidebarHeight: document.querySelector('aside')?.getBoundingClientRect().height }), state));
      await page.screenshot({ path: `${evidence}/${viewport.width}-${language}-${state}.png`, fullPage: true });
    };
    const sidebar = page.getByRole('complementary', { name: t('음성 메모 탐색', 'Voice memo navigation') });
    if (phone) expect((await sidebar.boundingBox())!.height).toBeLessThanOrEqual(220);
    await expect(sidebar.getByText('Minutes of Meeting', { exact: true })).toBeVisible(); await expect(sidebar.getByText('LOCAL', { exact: true })).toBeVisible();
    await expect(sidebar.getByRole('link')).toHaveCount(0);
    await expect(page.getByText(t('테스트 빌드 · 실제 AI 미검증', 'Test build · live AI unverified'), { exact: true })).toHaveCount(0);
    if (phone) await touchTargets(sidebar.locator('button:visible'));
    const settingsAndLock = async () => {
      await clickAppAction(page, t('설정', 'Settings'));
      const tablist = page.getByRole('tablist', { name: t('설정 항목', 'Settings categories') }), tabs = tablist.getByRole('tab'); await expect(tabs).toHaveCount(5); await noClippedNavigation(tablist);
      const legal = page.getByRole('navigation', { name: t('앱 정보 · 라이선스', 'App info & licenses') }).getByRole('link');
      if (viewport.width <= 960) await touchTargets(tabs);
      for (let i = 0; i < 5; i++) {
        await tabs.nth(i).tap(); await expect(tabs.nth(i)).toHaveAttribute('aria-selected', 'true');
        if (i === 1) {
          const manager = page.getByRole('region', { name: t('중앙 모델 관리', 'Central model management') });
          await manager.getByRole('tab', { name: t('정리 노트', 'Notes'), exact: true }).tap();
          await expect(manager).toContainText('SYNTHETICLongModelName');
        }
        await expect(legal).toHaveCount(3); await horizontalBounds(legal, viewport.width); await capture(`settings-${i}`);
      }
      metrics.push({ state: 'settings-legal-links', bounds: await legal.evaluateAll(elements => elements.map(element => {
        const bounds = element.getBoundingClientRect(); return { label: element.textContent, x: bounds.x, width: bounds.width, height: bounds.height };
      })) });
      if (phone) await touchTargets(legal);
      await legal.first().focus(); await expect(legal.first()).toBeFocused(); await page.keyboard.press('Tab'); await expect(legal.last()).toBeFocused();
      await tabs.first().focus(); await page.keyboard.press('End'); await expect(tabs.last()).toBeFocused();
      await page.keyboard.press('Home'); await expect(tabs.first()).toBeFocused(); await page.keyboard.press('ArrowRight'); await expect(tabs.nth(1)).toBeFocused();
      await clickAppAction(page, t('지금 잠그기', 'Lock now'));
      await expect(page.getByRole('heading', { name: t('암호로 잠금 해제', 'Unlock with your passphrase') })).toBeVisible();
      await expect(page.getByLabel(t('암호', 'Passphrase'), { exact: true })).toBeEnabled();
      await horizontalBounds(page.locator('.vault-card, .vault-card input, .vault-card button'), viewport.width); await capture('locked');
      await page.getByLabel(t('암호', 'Passphrase'), { exact: true }).fill(passphrase); await page.getByRole('button', { name: t('잠금 해제', 'Unlock'), exact: true }).tap();
      await expect(page.getByRole('heading', { name: t('음성 메모', 'Voice memos') })).toBeVisible(); await fits(page);
      await mkdir(evidence, { recursive: true }); await writeFile(`${evidence}/${viewport.width}-${language}-metrics.json`, JSON.stringify(metrics, null, 2) + '\n');
    };
    await capture('home');
    await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).tap();
    const navigation = page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }), steps = navigation.getByRole('button');
    await expect(steps).toHaveCount(3); await noClippedNavigation(navigation); if (phone) await touchTargets(steps);
    const title = 'SYNTHETICQuarterlyMeeting'.repeat(5), titleField = page.getByRole('textbox', { name: t('메모 제목', 'Memo title') });
    await titleField.fill(title); await titleField.press('Tab'); await expect(page.getByRole('heading', { name: title })).toBeVisible();
    // Full processing is represented at phone KR and desktop EN; the other cases
    // cover navigation, long titles, every settings panel and bilingual vault geometry.
    if (!fullWorkflow) {
      await capture('import');
      for (let i = 1; i < 3; i++) { await steps.nth(i).tap(); await expect(steps.nth(i)).toHaveAttribute('aria-current', 'step'); await fits(page); }
      await capture('minutes-empty'); await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).tap(); await capture('home-long-title');
      await settingsAndLock(); expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toHaveLength(0); expect(errors).toEqual([]); return;
    }
    await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_RESPONSIVE.wav', mimeType: 'audio/wav', buffer: playbackTone() });
    await expect(page.getByLabel(t('원본 음성 미리듣기', 'Source audio preview'))).toBeVisible(); await capture('import');
    await prepareForTranscription(page, language);
    await page.getByLabel(t('전사 모델', 'Transcription model')).selectOption('gpt-transcribe');
    await page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above") }).check();
    await page.getByRole('button', { name: t('전사 실행', 'Transcribe'), exact: true }).tap();
    await expect(page.getByText(fixtureText).first()).toBeVisible();
    await steps.nth(1).tap();
    const status = page.getByRole('status', { name: t('청크 1 재생 상태', 'Chunk 1 playback') });
    await page.getByRole('button', { name: t('청크 1 재생', 'Play chunk 1'), exact: true }).tap(); await expect(status).toHaveText(t('재생 중', 'Playing'));
    await page.getByRole('button', { name: t('청크 1 일시정지', 'Pause chunk 1') }).tap(); await expect(status).toHaveText(t('일시정지됨', 'Paused'));
    await page.getByRole('button', { name: t('청크 1 이어서 재생', 'Resume chunk 1') }).tap(); await expect(status).toHaveText(t('재생 중', 'Playing'));
    await page.getByRole('button', { name: t('청크 1 정지', 'Stop chunk 1') }).tap(); await expect(status).toHaveText(t('정지됨', 'Stopped')); await capture('chunks');
    await steps.nth(1).tap(); await page.getByRole('button', { name: t('문장 수정 1', 'Edit segment 1') }).tap();
    await page.getByRole('textbox', { name: t('전사 수정', 'Transcript edit') }).fill('TEST_ONLY_PROVIDER_RESULT: edited responsive transcript.'); await capture('transcript-editor');
    await page.getByRole('button', { name: t('전사 수정 저장', 'Save transcript edit') }).tap();
    await steps.nth(2).tap(); await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag, language);
    await page.getByRole('button', { name: t('모델 비교', 'Compare models'), exact: true }).tap();
    await selectFixtureMinutesRoute(page, routerModel.id, routerEndpoint.tag, language, true);
    expect(calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(0); await capture('comparison');
    await page.getByRole('button', { name: t('모델 비교', 'Compare models'), exact: true }).tap();
    await page.getByRole('checkbox', { name: t('선택한 전사문과 설정이 전송되고 요금이 발생할 수 있다는 것을 확인했어요. 음성은 다시 보내지 않아요.', 'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.') }).check();
    await page.getByRole('button', { name: t('정리 노트 생성', 'Generate notes'), exact: true }).tap();
    await expect(page.getByText('TEST_ONLY_PROVIDER_RESULT', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: t('편집', 'Edit'), exact: true }).tap();
    await page.getByRole('textbox', { name: t('Markdown 편집기', 'Markdown editor') }).fill(fixtureMarkdown + '\nSYNTHETIC_RESPONSIVE_EDIT'); await capture('minutes-editor');
    await page.getByRole('button', { name: t('정리 노트 수정 저장', 'Save notes edit') }).tap();
    await expect(page.getByRole('button', { name: t('Markdown 복사', 'Copy Markdown') })).toBeEnabled();
    await expect(page.getByRole('button', { name: t('.md 다운로드', 'Download .md') })).toBeEnabled();
    await clickAppAction(page, t('처리 기록', 'History'));
    await horizontalBounds(page.getByRole('button', { name: t('음성 메모 열기', 'Open voice memo') }), viewport.width);
    const table = page.locator('.table-scroll').first();
    if (await table.evaluate(element => element.scrollWidth > element.clientWidth + 1)) await swipeTable(page, table);
    await page.locator('.usage-stage-details summary').first().tap(); await capture('history');
    await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).tap(); await capture('home-long-title');
    await page.getByRole('button', { name: `${t('삭제', 'Delete')} ${title}`, exact: true }).tap();
    const confirmation = page.getByRole('group', { name: t('음성 메모 삭제 확인', 'Confirm voice memo deletion') }); await expect(confirmation).toBeVisible(); await capture('delete-confirmation');
    await confirmation.getByRole('button', { name: t('취소', 'Cancel'), exact: true }).tap(); await expect(confirmation).toHaveCount(0);
    await settingsAndLock();
    expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1);
    expect(calls.filter(call => call.url.endsWith('/chat/completions'))).toHaveLength(1); expect(errors).toEqual([]);
  });
}
