import { clickAppAction } from './helpers';
// Disposable synthetic vaults only; never inspect/reset the user's browser context.
import { expect, test } from '@playwright/test';

for (const phrase of ['Aa12345!', '  Synthetic spaces A1!  ', '가나다라마바사아A1!']) {
  test(`create → reopen → unlock → reset for ${phrase === 'Aa12345!' ? 'short mixed' : phrase.startsWith(' ') ? 'spaced' : 'Korean'} passphrase`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('암호', { exact: true }).fill(phrase);
    await page.getByLabel('암호 확인', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: '보관함 만들기', exact: true }).click();
    await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible();
    await page.getByLabel('암호', { exact: true }).fill(phrase);
    await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
    await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
    await clickAppAction(page, '지금 잠그기');
    await expect(page.getByRole('heading', { name: '암호로 잠금 해제', exact: true })).toBeVisible();
    await page.getByLabel('암호', { exact: true }).fill('SYNTHETIC_WRONG_PASSWORD');
    await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('textbox').fill('delete');
    await dialog.getByRole('button', { name: '보관함 데이터 영구 삭제', exact: true }).click();
    await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '새 보관함 만들기', exact: true })).toBeVisible();
  });
}
