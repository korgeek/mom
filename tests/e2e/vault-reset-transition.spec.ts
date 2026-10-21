import { test, expect } from '@playwright/test';
import { clickAppAction, createVault, fixtureTransport } from './helpers';

for (const { language, width, height } of [
  { language: 'ko', width: 1440, height: 900 },
  { language: 'en', width: 360, height: 800 },
] as const) {
  test(`reset confirmation replaces help and cancel restores it: ${language} ${width}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    const calls = await fixtureTransport(page);
    await createVault(page);
    if (language === 'en') {
      await clickAppAction(page, '설정');
      await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
      await page.getByRole('button', { name: 'English', exact: true }).click();
      await page.getByRole('tab', { name: 'Security & lock', exact: true }).click();
    } else {
      await clickAppAction(page, '지금 잠그기');
    }
    const resetName = language === 'ko' ? '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' : 'Delete all MoM data in this browser and start over';
    const helpName = language === 'ko' ? '암호를 잊었나요?' : 'Forgot your passphrase?';
    const cancelName = language === 'ko' ? '취소' : 'Cancel';
    const finalName = language === 'ko' ? '보관함 데이터 영구 삭제' : 'Permanently delete vault data';
    await page.getByRole('button', { name: resetName, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByText(helpName, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: resetName, exact: true })).toHaveCount(0);
    await dialog.getByRole('textbox').fill('delete');
    await expect(dialog.getByRole('button', { name: finalName, exact: true })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('confirmation.png'), fullPage: true });
    await dialog.getByRole('button', { name: cancelName, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(helpName, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: resetName, exact: true }).click();
    await expect(dialog.getByRole('textbox')).toHaveValue('');
    await expect(dialog.getByRole('button', { name: finalName, exact: true })).toBeDisabled();
    expect(calls.filter(call => /audio\/transcriptions|chat\/completions/.test(call.url))).toEqual([]);
  });
}
