import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { createVault } from './helpers';

for (const language of ['ko', 'en'] as const) for (const width of [1440, 360]) {
  test(`${language} ${width} Settings shows the adopted license and opens its exact terms`, async ({ page }) => {
    const t = (ko: string, en: string) => language === 'ko' ? ko : en;
    await page.setViewportSize({ width, height: 900 });
    await page.route('https://**/*', route => route.abort());
    await createVault(page);
    await page.getByRole('button', { name: '설정', exact: true }).click();
    if (language === 'en') {
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('tab', { name: 'Models', exact: true }).click();
    }
    const footer = page.locator('footer.settings-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toContainText('MoM Source Available License 1.0');
    await expect(footer).toContainText(t('LGPL 예외와 제3자 권리는 유지돼요.', 'LGPL exceptions and third-party rights remain unchanged.'));
    const legal = footer.getByRole('navigation', { name: t('앱 정보 · 라이선스', 'App info & licenses') });
    await expect(legal.getByRole('link')).toHaveCount(3);
    for (const [name, href] of [[t('MoM 라이선스', 'MoM license'), '/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt'], [t('제3자 라이선스', 'Third-party licenses'), '/THIRD_PARTY_NOTICES.txt'], [t('제3자 소스 · 재빌드 · 재연결', 'Third-party source · rebuild · relink'), '/sources/REBUILD.md']]) {
      await expect(legal.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      expect((await page.request.get(href)).ok()).toBe(true);
    }
    const bounds = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(bounds.content).toBeLessThanOrEqual(bounds.viewport + 1);
    const evidence = 'docs/superpowers/evidence/2026-10-19-license';
    await mkdir(evidence, { recursive: true });
    await footer.screenshot({ path: `${evidence}/${width}-${language}-license.png` });
    const pending = page.waitForEvent('popup');
    await legal.getByRole('link', { name: t('MoM 라이선스', 'MoM license'), exact: true }).click();
    const popup = await pending;
    await popup.waitForLoadState('domcontentloaded');
    expect(new URL(popup.url()).pathname).toBe('/licenses/MoM-SOURCE-AVAILABLE-LICENSE.txt');
    const response = await page.request.get(popup.url());
    expect(response.headers()['content-type']).toContain('text/plain');
    expect(await response.text()).toBe(await readFile('LICENSE', 'utf8'));
    await expect(popup.locator('body')).toContainText('제7조 제3자 라이선스와 LGPL 예외');
    await popup.close();
  });
}
