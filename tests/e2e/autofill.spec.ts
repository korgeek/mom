import { test, expect } from '@playwright/test';
import { clickAppAction, createVault, unlock } from './helpers';

test('API token fields stay separate from the vault and manual reveal still works', async ({ page }) => {
  const outbound: string[] = [];
  await page.route('https://**/*', route => { if (route.request().method() !== 'GET' || route.request().url() !== 'https://openrouter.ai/api/v1/models') outbound.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.getByLabel('암호', { exact: true })).toHaveAttribute('minlength', '8');
  await expect(page.getByLabel('암호', { exact: true })).toHaveAttribute('passwordrules', 'minlength: 8; maxlength: 256;');
  await page.screenshot({ path: '/tmp/mom-autofill-vault.png', fullPage: true });
  await createVault(page);
  await clickAppAction(page, '설정');
  for (const [provider, label] of [['openai', 'OpenAI'], ['openrouter', 'OpenRouter']]) {
    const input = page.getByLabel(`${label} API 키`);
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('name', `mom-${provider}-api-token`);
    await expect(input).toHaveAttribute('autocomplete', `section-${provider} new-password`);
    const card = page.locator('section').filter({ has: input });
    await input.fill('KEYLESS_AUTOFILL_UI_TEST');
    await card.getByRole('button', { name: '보기', exact: true }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await card.getByRole('button', { name: '가리기', exact: true }).click();
    await expect(input).toHaveAttribute('type', 'password');
    await card.getByText('추가 정보', { exact: true }).click();
    await card.getByRole('button', { name: '지우기', exact: true }).click();
    await expect(input).toHaveValue('');
  }
  await page.screenshot({ path: '/tmp/mom-autofill-settings.png', fullPage: true });
  await clickAppAction(page, '지금 잠그기');
  await expect(page.getByLabel('암호', { exact: true })).toHaveAttribute('autocomplete', 'current-password');
  await unlock(page);
  await clickAppAction(page, '설정');
  await expect(page.getByLabel('OpenAI API 키')).toHaveValue('');
  await expect(page.getByLabel('OpenRouter API 키')).toHaveValue('');
  expect(outbound).toEqual([]);
});
