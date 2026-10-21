import { clickAppAction } from './helpers';
import { test, expect } from '@playwright/test';

test('eight-character passphrases create and reopen an encrypted vault', async ({ page }) => {
  const outbound: string[] = [];
  await page.route('https://**/*', route => {
    if (new URL(route.request().url()).origin === new URL(test.info().project.use.baseURL!).origin) return route.continue();
    outbound.push(route.request().url());
    return route.abort();
  });
  await page.goto('/');
  const pass = page.getByLabel('암호', { exact: true });
  const confirmation = page.getByLabel('암호 확인', { exact: true });
  const create = page.getByRole('button', { name: '보관함 만들기', exact: true });
  await expect(page.getByText(/8~256자의 고유한 암호/)).toBeVisible();
  await expect(pass).toHaveAttribute('minlength', '8');
  await expect(confirmation).toHaveAttribute('minlength', '8');
  for (const invalid of ['Seven12', '12345678']) {
    await pass.fill(invalid); await confirmation.fill(invalid);
    await expect(create).toBeDisabled();
  }
  await pass.fill('Eight123'); await confirmation.fill('Eight124');
  await expect(create).toBeDisabled();
  await confirmation.fill('Eight123');
  await expect(create).toBeEnabled();
  await page.screenshot({ path: '/tmp/mom-eight-character-create.png', fullPage: true });
  await create.click();
  await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
  await clickAppAction(page, '지금 잠그기');
  await page.reload();
  await pass.fill('Wrong123');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('보관함을 열 수 없어요');
  await pass.fill('Eight123');
  await page.getByRole('button', { name: '잠금 해제', exact: true }).click();
  await expect(page.getByRole('heading', { name: '음성 메모', exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/mom-eight-character-reopened.png', fullPage: true });
  expect(outbound).toEqual([]);
});
