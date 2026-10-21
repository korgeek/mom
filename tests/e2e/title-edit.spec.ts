import { expect, test } from '@playwright/test';
import { clickAppAction, createVault, fixtureTransport, unlock } from './helpers';

for (const viewport of [{ width: 360, height: 800 }, { width: 1440, height: 900 }]) {
  test(`native title keyboard survives autosave and encrypted lock reload at ${viewport.width}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport); const calls = await fixtureTransport(page); await createVault(page);
    await page.screenshot({ path: testInfo.outputPath(`home-${viewport.width}.png`), fullPage: true });
    await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
    const title = page.getByRole('textbox', { name: /^메모 제목/ });
    await title.fill(''); await title.focus();
    // Real native key gaps exceed the existing 250ms autosave debounce.
    await page.keyboard.type('SLOW_TITLE', { delay: 320 });
    await page.screenshot({ path: testInfo.outputPath(`title-${viewport.width}.png`), fullPage: true });
    await expect(title).toHaveValue('SLOW_TITLE'); await expect(title).toBeFocused();
    await clickAppAction(page, '지금 잠그기');
    await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
    await expect(page.getByLabel('암호', { exact: true })).toBeEnabled();
    expect(await page.locator('body').innerText()).not.toContain('SLOW_TITLE');
    expect(await page.locator('input,textarea').evaluateAll(nodes => nodes.map(node => (node as HTMLInputElement).value).join(' '))).not.toContain('SLOW_TITLE');
    await page.reload(); await unlock(page); await expect(page.getByRole('main').getByText('SLOW_TITLE', { exact: true })).toBeVisible();
    expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toHaveLength(0);
  });
}
