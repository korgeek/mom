import { test, expect } from '@playwright/test';
import { clickAppAction, createVault, fixtureTransport } from './helpers';

test('rendered desktop palettes, themes, language and keyboard settings navigation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await fixtureTransport(page);
  await createVault(page);
  await clickAppAction(page, '설정');
  await page.getByRole('tab', { name: '연결 설정', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '모델', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '처리 기본값', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '화면 · 언어', exact: true })).toBeFocused();
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: theme === 'light' ? '라이트' : '다크', exact: true }).click();
      for (const palette of ['cobalt', 'teal', 'mono'] as const) {
        const name = palette === 'cobalt' ? /^코발트/ : palette === 'teal' ? /^틸 · 스톤/ : /^모노/;
        await page.getByRole('button', { name }).click();
        await expect(page.locator('.mom')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('.mom')).toHaveAttribute('data-palette', palette);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `.superpowers/sdd/12-implementation-plan/appearance-${width}-${theme}-${palette}.png`, fullPage: true });
      }
    }
  }
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('.mom')).toHaveAttribute('data-theme', 'system');
  await page.screenshot({ path: '.superpowers/sdd/12-implementation-plan/appearance-1280-system-en.png', fullPage: true });
  expect(errors).toEqual([]);
});
