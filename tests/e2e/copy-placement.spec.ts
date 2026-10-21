import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { clickAppAction, createVault } from './helpers';

const evidence = '.superpowers/sdd/remaining-work/task-workflow-3a/copy-placement';
async function fits(page: Page) {
  const actual = await page.evaluate(() => ({ documentWidth: document.documentElement.clientWidth, documentScroll: document.documentElement.scrollWidth,
    mainWidth: document.querySelector('main')?.clientWidth, mainScroll: document.querySelector('main')?.scrollWidth }));
  expect(actual.documentScroll).toBeLessThanOrEqual(actual.documentWidth + 1);
  if (actual.mainWidth !== undefined) expect(actual.mainScroll).toBeLessThanOrEqual(actual.mainWidth + 1);
  return actual;
}
for (const language of ['ko', 'en'] as const) for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) test.describe(`${language} ${viewport.width} copy placement`, () => {
  test.use({ viewport, hasTouch: viewport.width === 360 });
  test('approved empty copy, native disclosure, shared Settings links and vault branding', async ({ page }) => {
    const t = (ko: string, en: string) => language === 'ko' ? ko : en;
    const errors: string[] = [], intercepted: string[] = []; page.on('pageerror', error => errors.push(error.message));
    // No provider traffic leaves the browser. The ordinary automatic public catalog is an empty fixture.
    await page.route('https://**/*', async route => {
      intercepted.push(route.request().url());
      if (route.request().url() === 'https://openrouter.ai/api/v1/models') await route.fulfill({ contentType: 'application/json', body: '{"data":[]}' });
      else await route.abort();
    });
    await createVault(page);
    if (language === 'en') {
      await clickAppAction(page, '설정');
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
    }
    const sidebar = page.getByRole('complementary');
    await expect(page.getByText(t('테스트 빌드 · 실제 AI 미검증', 'Test build · live AI unverified'), { exact: true })).toHaveCount(0);
    await expect(sidebar.getByRole('link')).toHaveCount(0);
    await page.getByRole('main').getByRole('button', { name: t('+ 새 음성 메모', '+ New voice memo'), exact: true }).click();
    await page.getByRole('tab', { name: t('파일 업로드', 'File upload'), exact: true }).click();
    await expect(page.getByText(t('음성 파일이 준비되지 않았어요', 'No audio file is ready yet'), { exact: true })).toBeVisible();
    const summary = page.locator('summary').filter({ hasText: new RegExp(`^${t('언어 안내', 'Language guidance')}$`) });
    const disclosure = page.locator('details').filter({ has: summary });
    const explanation = page.getByText(t('선택한 언어는 가능한 경우 힌트로 제공돼요. 다른 언어의 발화도 제외하지 않아요. 모델에 따라 힌트가 지원되지 않을 수 있어요.', 'Selected languages are provided as hints when possible. Speech in other languages is also retained. Some models may not support these hints.'), { exact: true });
    await expect(disclosure).not.toHaveAttribute('open'); await expect(explanation).not.toBeVisible();
    const metrics: unknown[] = [{ state: 'import-collapsed', ...await fits(page) }];
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${viewport.width}-${language}-import-collapsed.png`, fullPage: true });
    await summary.focus(); await expect(summary).toBeFocused(); await page.keyboard.press('Enter');
    await expect(disclosure).toHaveAttribute('open'); await expect(explanation).toBeVisible();
    metrics.push({ state: 'import-expanded', ...await fits(page) });
    if (viewport.width === 360) expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `${evidence}/${viewport.width}-${language}-import-expanded.png`, fullPage: true });
    await page.keyboard.press('Space'); await expect(disclosure).not.toHaveAttribute('open'); await expect(explanation).not.toBeVisible();
    await expect(page.getByRole('group', { name: t('사용 언어 · 복수 선택', 'Spoken languages · select multiple') })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above") })).toHaveCount(0);
    await page.getByRole('navigation', { name: t('음성 메모 단계', 'Memo steps') }).getByRole('button').nth(1).click();
    await expect(page.getByText(t('모델 선택 후 확인', 'Choose a model to review the route'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('보내지 않는 것', 'Not sent'), { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: t('위 내용을 확인했어요', "I've reviewed the above") })).toBeVisible();
    await clickAppAction(page, t('설정', 'Settings'));
    const footer = page.getByRole('navigation', { name: t('앱 정보 · 라이선스', 'App info & licenses') });
    for (const [name, route] of [[t('MoM 라이선스', 'MoM license'), '/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt'], [t('제3자 라이선스', 'Third-party licenses'), '/THIRD_PARTY_NOTICES.txt'], [t('제3자 소스 · 재빌드 · 재연결', 'Third-party source · rebuild · relink'), '/sources/REBUILD.md']]) {
      const link = footer.getByRole('link', { name, exact: true });
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(1); await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', route); await expect(link).toHaveAttribute('target', '_blank'); await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await link.focus(); await expect(link).toBeFocused();
      const popupReady = page.waitForEvent('popup'); await page.keyboard.press('Enter'); const popup = await popupReady;
      await popup.waitForLoadState('domcontentloaded'); expect(new URL(popup.url()).pathname).toBe(route); expect(new URL(popup.url()).origin).toBe(new URL(page.url()).origin);
      await popup.close();
    }
    metrics.push({ state: 'settings-footer', ...await fits(page) });
    await footer.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/${viewport.width}-${language}-settings-footer.png`, fullPage: true });
    await expect(sidebar.getByRole('link')).toHaveCount(0);
    await page.getByRole('button', { name: t('지금 잠그기', 'Lock now'), exact: true }).first().click();
    await expect(page.getByRole('heading', { name: t('암호로 잠금 해제', 'Unlock with your passphrase') })).toBeVisible();
    await expect(page.getByText(t('테스트 빌드 · 실제 AI 미검증', 'Test build · live AI unverified'), { exact: true })).toHaveCount(0);
    await expect(page.getByText('Minutes of Meeting', { exact: true })).toBeVisible();
    await expect(page.getByRole('link')).toHaveCount(0);
    metrics.push({ state: 'locked-gate', ...await fits(page) });
    await page.screenshot({ path: `${evidence}/${viewport.width}-${language}-locked-gate.png`, fullPage: true });
    expect(intercepted.every(url => url === 'https://openrouter.ai/api/v1/models')).toBe(true); expect(errors).toEqual([]);
    await writeFile(`${evidence}/${viewport.width}-${language}-events.json`, JSON.stringify({ metrics, interceptedCatalogFixtures: intercepted.length, providerRequestsSent: 0, keysEntered: 0, errors }, null, 2));
  });
});
