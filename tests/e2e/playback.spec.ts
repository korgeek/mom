import { expect, test, type Page } from '@playwright/test';
import { clickAppAction, prepareForTranscription, createVault, enterFixtureKeys, fixtureText, fixtureTransport, unlock } from './helpers';

// Synthesized PCM only. Native Audio is observed rather than replacing its media behavior.
function syntheticTone(seconds: number) {
  const count = 16000 * seconds, buffer = Buffer.alloc(44 + count * 2), view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  buffer.write('RIFF'); view.setUint32(4, buffer.length - 8, true); buffer.write('WAVE', 8); buffer.write('fmt ', 12);
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  buffer.write('data', 36); view.setUint32(40, count * 2, true); for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.round(1500 * Math.sin(i * .1)), true);
  return buffer;
}
type Observation = { players: HTMLAudioElement[]; events: string[]; created: string[]; revoked: string[] };
async function lastPlayer(page: Page) {
  return page.evaluate(() => {
    const observation = (window as unknown as { task5Audio: Observation }).task5Audio, audio = observation.players.at(-1)!;
    return { paused: audio.paused, time: audio.currentTime, src: audio.getAttribute('src'), count: observation.players.length, events: observation.events };
  });
}
test('real chunk audio supports keyboard pause/resume, Stop reset, native preview, ended/error and lock cleanup', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const observation: Observation = { players: [], events: [], created: [], revoked: [] };
    (window as unknown as { task5Audio: Observation }).task5Audio = observation;
    window.Audio = new Proxy(window.Audio, { construct(target, args) {
      const audio = Reflect.construct(target, args) as HTMLAudioElement; observation.players.push(audio);
      for (const event of ['playing', 'pause', 'ended', 'error']) audio.addEventListener(event, () => observation.events.push(event));
      return audio;
    } });
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); observation.created.push(url); return url; };
    URL.revokeObjectURL = url => { observation.revoked.push(url); revoke(url); };
  });
  const calls = await fixtureTransport(page); await createVault(page); await enterFixtureKeys(page);
  await page.getByRole('main').getByRole('button', { name: /새 음성 메모/ }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'SYNTHETIC_PLAYBACK.wav', mimeType: 'audio/wav', buffer: syntheticTone(6) });
  await prepareForTranscription(page);
 await page.getByLabel('전사 모델').selectOption('gpt-transcribe'); await page.getByRole('checkbox', { name: '위 내용을 확인했어요' }).check();
  await page.getByRole('button', { name: '전사 실행' }).click(); await expect(page.getByText(fixtureText).first()).toBeVisible();
  const stt = () => page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button', { name: /전사$/ }).click();
  await stt(); const status = page.getByRole('status', { name: '청크 1 재생 상태' });
  await page.getByRole('button', { name: '청크 1 재생', exact: true }).click(); await expect(status).toHaveText('재생 중');
  const count = (await lastPlayer(page)).count; await expect.poll(async () => (await lastPlayer(page)).time).toBeGreaterThan(.3);
  await page.keyboard.press('Space'); await expect(status).toHaveText('일시정지됨'); const paused = await lastPlayer(page);
  expect(paused.paused).toBe(true); await page.waitForTimeout(250); expect((await lastPlayer(page)).time).toBe(paused.time);
  await page.keyboard.press('Enter'); await expect(status).toHaveText('재생 중'); await expect.poll(async () => (await lastPlayer(page)).time).toBeGreaterThan(paused.time + .15);
  expect((await lastPlayer(page)).count).toBe(count);
  await page.screenshot({ path: '.superpowers/sdd/remaining-work/task-workflow-3a/native-playing-1440.png', fullPage: true });
  await page.getByRole('button', { name: '청크 1 정지' }).click(); await expect(status).toHaveText('정지됨');
  const stopped = await lastPlayer(page); expect(stopped.paused).toBe(true); expect(stopped.src).toBeNull(); expect(stopped.time).toBeLessThan(paused.time);
  await page.getByRole('button', { name: '청크 1 재생', exact: true }).click(); await expect(status).toHaveText('재생 중');
  await page.getByRole('navigation', { name: '음성 메모 단계' }).getByRole('button', { name: /음성 준비$/ }).click(); expect((await lastPlayer(page)).paused).toBe(true);
  const source = page.getByLabel('원본 음성 미리듣기'); await source.evaluate(audio => (audio as HTMLAudioElement).play());
  expect(await source.evaluate(audio => (audio as HTMLAudioElement).paused)).toBe(false);
  await stt(); const removedSourcePaused = await page.evaluate(() => document.querySelector('audio') === null); expect(removedSourcePaused).toBe(true);
  await page.getByRole('button', { name: '청크 1 재생', exact: true }).click(); await expect(status).toHaveText('재생 중');
  await page.evaluate(() => { const audio = (window as unknown as { task5Audio: Observation }).task5Audio.players.at(-1)!; audio.currentTime = Math.max(0, audio.duration - .15); });
  await expect(status).toHaveText('정지됨'); expect((await lastPlayer(page)).events).toContain('ended');
  await page.getByRole('button', { name: '청크 1 재생', exact: true }).click(); await expect(status).toHaveText('재생 중');
  const invalidUrl = await page.evaluate(() => { const audio = (window as unknown as { task5Audio: Observation }).task5Audio.players.at(-1)!; const url = URL.createObjectURL(new Blob(['SYNTHETIC_INVALID_AUDIO'], { type: 'audio/wav' })); audio.src = url; audio.load(); return url; });
  await expect(status).toHaveText('재생 실패 · 다시 시도하세요'); expect((await lastPlayer(page)).events).toContain('error');
  await page.evaluate(url => URL.revokeObjectURL(url), invalidUrl);
  await page.getByRole('button', { name: '청크 1 재생', exact: true }).click(); await expect(status).toHaveText('재생 중');
  await clickAppAction(page, '지금 잠그기'); await expect(page.getByRole('heading', { name: '암호로 잠금 해제' })).toBeVisible();
  expect((await lastPlayer(page)).paused).toBe(true); expect((await lastPlayer(page)).src).toBeNull();
  expect(await page.evaluate(() => { const observation = (window as unknown as { task5Audio: Observation }).task5Audio; return observation.created.every(url => observation.revoked.includes(url)); })).toBe(true);
  const lockCount = (await lastPlayer(page)).count; await unlock(page); expect((await lastPlayer(page)).count).toBe(lockCount);
  expect(calls.filter(call => call.url.endsWith('/audio/transcriptions'))).toHaveLength(1); expect(calls.some(call => call.url.endsWith('/chat/completions'))).toBe(false);
  expect(errors).toEqual([]);
});
