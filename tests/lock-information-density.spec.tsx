// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';

afterEach(cleanup);
const controller = (patch: Partial<AppController> = {}): AppController => ({ session: 'unlocked', screenAccess: 'open', preferences: defaultPreferences, projects: [], selectedProjectId: null, screen: 'settings', settingsTab: 'security', defaultAudioOptions: { chunkMinutes: 10, overlapSeconds: 10, bitrateKbps: 32, sampleRateHz: 16000, expectedLanguages: ['ko'] }, sttModelId: '', modelCatalog: [], connections: [], storageEstimate: null, ...patch });
it('keeps screen unlock concise while retaining protection limits in a closed disclosure', async () => {
  const unlock = vi.fn(), user = userEvent.setup();
  render(<App controller={controller({ screenAccess: 'locked', busy: true, onScreenUnlock: unlock })} />);
  expect(screen.getByText('진행 중인 작업은 계속됩니다. 암호를 입력해 음성 메모로 돌아가세요.')).toBeTruthy();
  const limits = screen.getByText(/작업 중에는 실행에 필요한 키와 데이터/).closest('details')!;
  expect(limits).not.toBeNull(); expect(limits.open).toBe(false);
  await user.click(within(limits).getByText('화면 잠금의 보호 범위'));
  expect(limits.open).toBe(true);
  await user.type(screen.getByLabelText('암호'), 'synthetic-only-passphrase');
  await user.click(screen.getByRole('button', { name: '화면 잠금 해제' }));
  expect(unlock).toHaveBeenCalledWith('synthetic-only-passphrase');
});
it('summarizes idle behavior and keeps daily security settings free of an exposed reset action', async () => {
  const reset = vi.fn(), user = userEvent.setup();
  render(<App controller={controller({ onResetVault: reset })} />);
  expect(screen.getByText('입력하거나 화면을 조작하면 대기 시간이 다시 시작됩니다.')).toBeTruthy();
  const timing = screen.getByText(/입력·클릭·터치·키보드·사용자 스크롤/).closest('details')!;
  expect(timing).not.toBeNull(); expect(timing.open).toBe(false);
  expect(screen.queryByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' })).toBeNull();
  const manage = screen.getByText('보관함 초기화').closest('details')!;
  expect(manage.open).toBe(false); expect(reset).not.toHaveBeenCalled();
  await user.click(within(manage).getByText('보관함 초기화'));
  await user.click(within(manage).getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' }));
  const dialog = screen.getByRole('dialog', { name: '이 브라우저의 보관함을 삭제할까요?' });
  const confirm = within(dialog).getByRole('button', { name: '보관함 데이터 영구 삭제' });
  expect((confirm as HTMLButtonElement).disabled).toBe(true);
  await user.type(within(dialog).getByRole('textbox'), 'delete');
  await user.click(within(manage).getByText('보관함 초기화'));
  await user.click(within(manage).getByText('보관함 초기화'));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(reset).not.toHaveBeenCalled();
  await user.click(within(manage).getByRole('button', { name: '이 브라우저의 MoM 데이터 모두 삭제하고 새로 시작' }));
  expect((screen.getByRole('dialog').querySelector('input') as HTMLInputElement).value).toBe('');
});
