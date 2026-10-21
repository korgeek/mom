import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { clickAppAction, createVault, toneWav } from './helpers';

const evidence = 'docs/superpowers/evidence/2026-10-21-lucide-icons';
for (const width of [1440, 360]) test(`Lucide icons keep controls and saved memo choices at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**/*', route => route.abort());
  await createVault(page);
  const create = page.getByRole('main').getByRole('button', { name: '+ 새 음성 메모', exact: true });
  await expect(create.locator('.lucide-plus')).toBeVisible(); await create.click();
  await page.getByRole('textbox', { name: /^메모 제목/ }).fill('SYNTHETIC_LUCIDE_MEMO');
  if (width === 360) await page.getByRole('button', { name: /^아이콘 · 색상 · 녹음 ·/ }).click();
  const schedule = page.getByRole('button', { name: '일정', exact: true });
  await expect(schedule.locator('.lucide-calendar')).toBeVisible(); await schedule.click();
  await expect(schedule).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.flow-title .lucide-calendar')).toBeVisible();
  await page.getByLabel('음성 파일 선택', { exact: true }).setInputFiles({ name: 'SYNTHETIC_LUCIDE.wav', mimeType: 'audio/wav', buffer: toneWav(5) });
  await page.getByRole('button', { name: '전사 준비', exact: true }).click();
  const transcribe = page.getByRole('button', { name: '전사하기 →', exact: true });
  await expect(transcribe).toBeEnabled(); await expect(transcribe.locator('.lucide-arrow-right')).toBeVisible(); await transcribe.click();
  await expect(page.getByRole('button', { name: '청크·압축 편집', exact: true }).locator('.lucide-pencil')).toBeVisible();
  await expect(page.getByRole('button', { name: '청크 1 재생', exact: true }).locator('.lucide-play')).toBeVisible();
  await expect(page.getByRole('button', { name: '청크 1 정지', exact: true }).locator('.lucide-square')).toBeVisible();
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${width}-stt.png`, fullPage: true });
  await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button').nth(2).click();
  await expect(page.getByRole('button', { name: /위로 이동/ }).first().locator('.lucide-chevron-up')).toBeVisible();
  await page.getByRole('button', { name: 'Minutes of Meeting', exact: true }).click();
  const pin = page.getByRole('button', { name: '고정 SYNTHETIC_LUCIDE_MEMO', exact: true });
  await expect(pin.locator('.lucide-pin')).toBeVisible(); await pin.click();
  await expect(page.getByRole('button', { name: '고정 해제 SYNTHETIC_LUCIDE_MEMO', exact: true }).locator('.lucide-pin-off')).toBeVisible();
  await page.screenshot({ path: `${evidence}/${width}-home.png`, fullPage: true });
  if (width === 360) {
    const menu = page.getByRole('button', { name: '탐색 메뉴', exact: true }); await menu.click();
    await expect(menu.locator('.lucide-ellipsis')).toHaveCSS('width', '24px');
    const navigation = page.getByRole('navigation', { name: '빠른 탐색', exact: true });
    await expect(navigation.locator('svg.lucide')).toHaveCount(3);
    await page.screenshot({ path: `${evidence}/${width}-menu.png`, fullPage: true }); await page.keyboard.press('Escape');
  }
  await clickAppAction(page, '설정'); await page.getByRole('tab', { name: '화면 · 언어', exact: true }).click();
  await expect(page.getByRole('region', { name: '아이콘 목록', exact: true }).locator('svg.lucide')).toHaveCount(9);
  await page.getByRole('tab', { name: '보안 · 잠금', exact: true }).click();
  const summary = page.getByText('저장과 보호 범위 자세히', { exact: true });
  await summary.focus(); await page.keyboard.press('Enter'); await expect(summary.locator('..')).toHaveAttribute('open');
  await expect(summary).toHaveCSS('font-size', '14px');
  const marker = await summary.evaluate(element => getComputedStyle(element, '::before').maskImage);
  expect(marker).toContain('/icons/chevron-right.svg');
  await page.keyboard.press('Space'); await expect(summary.locator('..')).not.toHaveAttribute('open');
  expect((await page.request.get('/icons/chevron-right.svg')).ok()).toBe(true);
  const audit = await page.evaluate(() => ({
    nonLucideIcons: [...document.querySelectorAll('svg:not(.lucide)')].map(icon => icon.getAttribute('viewBox')),
    decorative: [...document.querySelectorAll('svg.lucide')].every(icon => icon.getAttribute('aria-hidden') === 'true'),
    overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('main')!.scrollWidth > document.querySelector('main')!.clientWidth,
  }));
  expect(audit).toEqual({ nonLucideIcons: [], decorative: true, overflow: false }); expect(errors).toEqual([]);
  await page.screenshot({ path: `${evidence}/${width}-settings.png`, fullPage: true });
  writeFileSync(`${evidence}/${width}.json`, JSON.stringify({ width, audit, marker, errors }, null, 2));
});
