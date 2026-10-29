// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import Settings from '../src/react-app/ui/screens/Settings';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
const shared = { id: 'shared', name: 'Shared router', origin: 'https://openrouter.ai', keyStorage: 'encrypted' as const, version: 1, routerPolicy:{requireZdr:true,acknowledged:true} };
function controller(): AppController {
  return { session: 'unlocked', settingsTab: 'models', preferences: defaultPreferences, modelRegistrations: { version: 2, entries: [], credentials: [] },
    credentialKeyReady: [], onSaveApiCredential: vi.fn(async () => {}), onDeleteApiCredential: vi.fn(async () => {}), onSaveRegistration: vi.fn(async () => {}), onTestRegistration: vi.fn(async () => {}) } as unknown as AppController;
}
async function openKeys(c = controller()) {
  const view = render(<Settings controller={c} />);
  return { c, ...view };
}
it('saves a provider key before any model exists and never submits it to a provider', async () => {
  const { c } = await openKeys(), user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'API 키 추가' }));
  await user.type(screen.getByLabelText('키 이름'), 'My router');
  await user.selectOptions(screen.getByLabelText('제공사'), 'openrouter');
  expect(screen.queryByLabelText('서버 주소')).toBeNull();
  const input = screen.getByLabelText('새 API 키') as HTMLInputElement;
  expect(input.type).toBe('password'); expect(input.autocomplete).toBe('new-password');
  await user.type(input, 'SYNTHETIC_KEY_ONLY');
  expect((screen.getByRole('button',{name:'키 저장'}) as HTMLButtonElement).disabled).toBe(true);
  await user.click(screen.getByLabelText('선택한 OpenRouter 전송·보관 정책을 확인했어요'));
  await user.click(screen.getByRole('button', { name: '키 저장' }));
  expect(c.onSaveApiCredential).toHaveBeenCalledWith(expect.objectContaining({ name: 'My router', origin: 'https://openrouter.ai', keyStorage: 'encrypted' }), { action: 'replace', value: 'SYNTHETIC_KEY_ONLY' });
  expect(input.value).toBe(''); expect(screen.queryByLabelText('새 API 키')).toBeNull();
  expect(c.onSaveRegistration).not.toHaveBeenCalled(); expect(c.onTestRegistration).not.toHaveBeenCalled();
});
it('requires a safe custom origin and clears the pending key when its destination changes', async () => {
  const { c } = await openKeys(), user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'API 키 추가' }));
  await user.type(screen.getByLabelText('키 이름'), 'Local');
  await user.selectOptions(screen.getByLabelText('제공사'), 'custom');
  fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: 'http://remote.example' } });
  await user.type(screen.getByLabelText('새 API 키'), 'SYNTHETIC_CUSTOM');
  expect((screen.getByRole('button', { name: '키 저장' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: 'http://localhost:8000' } });
  expect((screen.getByLabelText('새 API 키') as HTMLInputElement).value).toBe('');
  await user.type(screen.getByLabelText('새 API 키'), 'SYNTHETIC_CUSTOM');
  await user.selectOptions(screen.getByLabelText('제공사'), 'openai');
  expect((screen.getByLabelText('새 API 키') as HTMLInputElement).value).toBe('');
  expect(screen.queryByLabelText('서버 주소')).toBeNull();
  await user.selectOptions(screen.getByLabelText('제공사'), 'custom');
  fireEvent.change(screen.getByLabelText('서버 주소'), { target: { value: 'http://localhost:8000' } });
  await user.type(screen.getByLabelText('새 API 키'), 'SYNTHETIC_CUSTOM');
  await user.click(screen.getByRole('button', { name: '키 저장' }));
  expect(c.onSaveApiCredential).toHaveBeenCalledWith(expect.objectContaining({ name: 'Local', origin: 'http://localhost:8000', keyStorage: 'encrypted' }), { action: 'replace', value: 'SYNTHETIC_CUSTOM' });
});
it('renames a key without replacing its secret or calling a provider', async () => {
  const c = controller(); c.modelRegistrations = { version: 2, entries: [], credentials: [shared] };
  await openKeys(c); const user = userEvent.setup();
  await user.click(screen.getByLabelText('Shared router 관리')); await user.click(screen.getByRole('button', { name: '키 수정' }));
  fireEvent.change(screen.getByLabelText('키 이름'), { target: { value: 'Renamed router' } });
  await user.click(screen.getByRole('button', { name: '키 저장' }));
  expect(c.onSaveApiCredential).toHaveBeenCalledWith({ ...shared, name: 'Renamed router' }, { action: 'keep' });
  expect(c.onTestRegistration).not.toHaveBeenCalled();
});
it('keeps a saved origin immutable and clears failed rotations and locked drafts', async () => {
  const c = controller(); c.modelRegistrations = { version: 2, entries: [], credentials: [shared] };
  c.onSaveApiCredential = vi.fn(async () => { throw Error('SYNTHETIC_PRIVATE_FAILURE'); });
  const view = await openKeys(c), user = userEvent.setup();
  await user.click(screen.getByLabelText('Shared router 관리'));
  await user.click(screen.getByRole('button', { name: '키 수정' }));
  expect((screen.getByLabelText('제공사') as HTMLSelectElement).disabled).toBe(true);
  const input = screen.getByLabelText('새 API 키') as HTMLInputElement;
  expect(input.value).toBe('');
  await user.type(input, 'SYNTHETIC_ROTATED');
  await user.click(screen.getByText('보관 옵션'));
  await user.selectOptions(screen.getByLabelText('키 저장 방식'), 'session');
  await user.click(screen.getByRole('button', { name: '키 저장' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('키를 저장하지 못했어요'));
  expect(c.onSaveApiCredential).toHaveBeenCalledWith({ ...shared, keyStorage: 'session' }, { action: 'replace', value: 'SYNTHETIC_ROTATED' });
  expect(input.value).toBe(''); expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_FAILURE');
  await user.type(input, 'SYNTHETIC_UNSAVED');
  view.rerender(<Settings controller={{ ...c, session: 'locked' }} />);
  expect(input.value).toBe(''); expect(screen.queryByLabelText('새 API 키')).toBeNull(); expect(screen.queryByText('Shared router')).toBeNull();
});
it('uses a compact shared key list and requires explicit deletion confirmation', async () => {
  const c = controller(); c.modelRegistrations = { version: 2, entries: [], credentials: [shared] }; c.credentialKeyReady = [shared.id];
  await openKeys(c); const user = userEvent.setup(), list = screen.getByRole('list', { name: '저장된 API 키' });
  expect(within(list).getByText('Shared router')).toBeTruthy(); expect(within(list).getByText('OpenRouter')).toBeTruthy();
  await user.click(screen.getByLabelText('Shared router 관리'));
  await user.click(screen.getByRole('button', { name: '키 삭제' }));
  expect(c.onDeleteApiCredential).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '취소' })); expect(screen.queryByRole('alertdialog')).toBeNull();
  await user.click(screen.getByLabelText('Shared router 관리'));
  await user.click(screen.getByRole('button', { name: '키 삭제' }));
  await user.click(screen.getByRole('button', { name: '키 영구 삭제' }));
  expect(c.onDeleteApiCredential).toHaveBeenCalledWith(shared.id);
});
it.each([
  [undefined, '확인 전', 'neutral'],
  [{ state: 'checking', message: '' }, '확인 중', 'running'],
  [{ state: 'verified', message: '인증을 확인했어요. 실제 모델 실행은 별도 테스트가 필요해요.' }, '인증 확인', 'success'],
  [{ state: 'failed', message: '인증에 실패했어요. API 키를 확인하세요.' }, '확인 실패', 'failed'],
  [{ state: 'unsupported', message: '등록한 모델에서 테스트하세요.' }, '확인 불가', 'setup'],
] as const)('shows compact authentication chips with optional details: %s', async (check, label, tone) => {
  const c = controller(); c.modelRegistrations = { version: 2, entries: [], credentials: [shared] }; c.credentialKeyReady = [shared.id];
  c.onCheckApiCredential = vi.fn(async () => {}); if (check) c.apiCredentialChecks = { [shared.id]: check };
  await openKeys(c);
  const status = within(screen.getByRole('list', { name: '저장된 API 키' })).getByRole('status');
  expect(status.textContent).toBe(label); expect(status.closest(`.model-status--${tone}`)).toBeTruthy();
  if (check?.message) {
    const details = status.closest('details')!;
    expect(details.open).toBe(false); fireEvent.click(status.closest('summary')!); expect(details.open).toBe(true);
    expect(within(details).getByText(check.message)).toBeTruthy();
  }
  expect(c.onCheckApiCredential).not.toHaveBeenCalled(); expect(c.onSaveApiCredential).not.toHaveBeenCalled();
});
it('shows a key-required chip instead of a stale authentication result when its secret is unavailable', async () => {
  const c = controller(); c.preferences = { ...defaultPreferences, uiLanguage: 'en' };
  c.modelRegistrations = { version: 2, entries: [], credentials: [shared] };
  c.apiCredentialChecks = { [shared.id]: { state: 'verified', message: 'Previous authentication result' } };
  await openKeys(c);
  const status = within(screen.getByRole('list', { name: 'Saved API keys' })).getByRole('status');
  expect(status.textContent).toBe('Key required'); expect(status.classList.contains('model-status--setup')).toBe(true);
  expect(screen.queryByText('Previous authentication result')).toBeNull();
  expect((screen.getByRole('button', { name: 'Check connection' }) as HTMLButtonElement).disabled).toBe(true);
});
it('cancels the key modal without losing the model draft and restores focus', async () => {
  const { c } = await openKeys(), user = userEvent.setup();
  expect(screen.queryByRole('tab', { name: 'API 키' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '새 모델' }));
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'Unsaved STT model' } });
  const opener = within(screen.getByRole('dialog', { name:'새 모델 등록' })).getByRole('button', { name: 'API 키 추가' }); await user.click(opener);
  const modal = screen.getByRole('dialog', { name: 'API 키 추가' });
  const input = within(modal).getByLabelText('새 API 키') as HTMLInputElement; await user.type(input, 'SYNTHETIC_PENDING');
  fireEvent(modal, new Event('cancel', { bubbles: false, cancelable: true }));
  expect(input.value).toBe(''); expect(screen.queryByRole('dialog',{name:'API 키 추가'})).toBeNull(); expect(document.activeElement).toBe(opener);
  expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('Unsaved STT model');
  expect(c.onSaveApiCredential).not.toHaveBeenCalled(); expect(c.onSaveRegistration).not.toHaveBeenCalled();
  expect(screen.queryByRole('option', { name: '새 키 추가' })).toBeNull(); expect(screen.getByLabelText('API 키 선택')).toBeTruthy();
});
it('keeps the model draft when a newly saved key becomes available and shares keys across STT and LLM', async () => {
  const { c, rerender } = await openKeys(), user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '새 모델' }));
  await user.selectOptions(screen.getByLabelText('API 종류'), 'openrouter');
  fireEvent.change(screen.getByLabelText('이름'), { target: { value: 'Keep this draft' } });
  await user.click(within(screen.getByRole('dialog',{name:'새 모델 등록'})).getByRole('button', { name: 'API 키 추가' }));
  await user.type(screen.getByLabelText('키 이름'), shared.name); await user.selectOptions(screen.getByLabelText('제공사'), 'openrouter');
  await user.type(screen.getByLabelText('새 API 키'), 'SYNTHETIC_SHARED'); await user.click(screen.getByLabelText('선택한 OpenRouter 전송·보관 정책을 확인했어요'));await user.click(screen.getByRole('button', { name: '키 저장' }));
  rerender(<Settings controller={{ ...c, modelRegistrations: { version: 2, entries: [], credentials: [shared] }, credentialKeyReady: [shared.id] }} />);
  expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('Keep this draft');
  await user.selectOptions(screen.getByLabelText('API 키 선택'), shared.id);
  await user.click(screen.getByRole('button',{name:'닫기'}));
  await user.click(screen.getByRole('tab', { name: 'LLM' }));
  expect(screen.getByRole('list', { name: '저장된 API 키' }).textContent).toContain(shared.name);
  await user.click(screen.getByRole('button', { name: '새 모델' }));
  fireEvent.change(screen.getByLabelText('API 종류'), { target: { value: 'openrouter' } });
  expect(screen.getByRole('option', { name: shared.name })).toBeTruthy();
});
it('requires a fresh API acknowledgement when retention changes and hides the policy for other providers',async()=>{
 const {c}=await openKeys(),user=userEvent.setup();await user.click(screen.getByRole('button',{name:'API 키 추가'}));
 await user.type(screen.getByLabelText('키 이름'),'Router policy');await user.selectOptions(screen.getByLabelText('제공사'),'openrouter');await user.type(screen.getByLabelText('새 API 키'),'SYNTHETIC_POLICY');
 await user.click(screen.getByLabelText('선택한 OpenRouter 전송·보관 정책을 확인했어요'));await user.selectOptions(screen.getByLabelText('OpenRouter 보관 정책'),'standard');
 expect((screen.getByLabelText('선택한 OpenRouter 전송·보관 정책을 확인했어요') as HTMLInputElement).checked).toBe(false);expect((screen.getByRole('button',{name:'키 저장'}) as HTMLButtonElement).disabled).toBe(true);
 await user.click(screen.getByLabelText('선택한 OpenRouter 전송·보관 정책을 확인했어요'));await user.click(screen.getByRole('button',{name:'키 저장'}));
 expect(c.onSaveApiCredential).toHaveBeenCalledWith(expect.objectContaining({routerPolicy:{requireZdr:false,acknowledged:true}}),{action:'replace',value:'SYNTHETIC_POLICY'});
 await user.click(screen.getByRole('button',{name:'API 키 추가'}));await user.selectOptions(screen.getByLabelText('제공사'),'openai');expect(screen.queryByLabelText('OpenRouter 보관 정책')).toBeNull();
});
