// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import SelectionListSettings from '../src/react-app/ui/components/SelectionListSettings';
import { defaultSelectionLists, exportSelectionLists, type SelectionLists } from '../src/react-app/settings/lists';
import { memoIcons } from '../src/react-app/ui/copy';
const custom: SelectionLists = { icons: ['headphones', 'mic'], colors: ['#123456'], languages: [{ code: 'fr', name: 'French fixture' }] };
function Harness({ save = async () => {}, language = 'en' }: { save?: (value: SelectionLists) => Promise<void>; language?: 'ko' | 'en' }) {
  const [lists, setLists] = useState(defaultSelectionLists);
  const c: AppController = { session: 'unlocked', preferences: { ...defaultPreferences, uiLanguage: language }, projects: [], selectedProjectId: null, screen: 'settings', settingsTab: 'appearance', defaultAudioOptions: { chunkMinutes: 5, overlapSeconds: 5, expectedLanguages: ['ko', 'en'], bitrateKbps: 32, sampleRateHz: 16000 }, modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, selectionLists: lists, onSaveSelectionLists: async value => { await save(value); setLists(value); } };
  return <SelectionListSettings controller={c} />;
}
function file(text: string, read = async () => new TextEncoder().encode(text).buffer) {
  const result = new File([text], 'lists.json', { type: 'application/json' }); Object.defineProperty(result, 'arrayBuffer', { value: read, configurable: true }); return result;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('shows the built-in memo icons separately from editable colors and language names/codes', () => {
  render(<Harness />);
  const icons = screen.getByRole('region', { name: 'Icon list' });
  for (const id of defaultSelectionLists.icons) expect(within(icons).getByText(memoIcons[id].en)).toBeTruthy();
  expect(within(icons).getByRole('button', { name: 'Add icon' })).toBeTruthy();
  expect(screen.getByText('Display name / Language code')).toBeTruthy();
  expect(screen.getByText(/memo title icon/)).toBeTruthy();
});
it('adds, edits and deletes colors/languages and resets each section independently', async () => {
  const user = userEvent.setup(), save = vi.fn<(value: SelectionLists) => Promise<void>>(async () => {}); render(<Harness save={save} />);
  await user.click(screen.getByRole('button', { name: 'Add color' }));
  await user.clear(screen.getByLabelText('HEX color')); await user.type(screen.getByLabelText('HEX color'), '#112233'); await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Edit color #112233' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Add language' }));
  await user.type(screen.getByLabelText('Language code'), 'fr'); await user.type(screen.getByLabelText('Display name'), 'French'); await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('button', { name: 'Edit language fr' })); await user.clear(screen.getByLabelText('Display name')); await user.type(screen.getByLabelText('Display name'), 'Français'); await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByText('Français')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Reset colors' })); expect(screen.queryByRole('button', { name: 'Edit color #112233' })).toBeNull(); expect(screen.getByText('Français')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Delete language fr' })); expect(screen.queryByText('Français')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Delete color #3B82F6' })); expect(screen.queryByRole('button', { name: 'Edit color #3B82F6' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Reset languages' })); expect(save.mock.calls.at(-1)?.[0].languages).toEqual(defaultSelectionLists.languages);
});
it('adds catalog icons, removes and resets choices while preserving the other lists', async () => {
  const user = userEvent.setup(), save = vi.fn<(value: SelectionLists) => Promise<void>>(async () => {}); render(<Harness save={save} />);
  await user.click(screen.getByRole('button', { name: 'Add icon' }));
  await user.selectOptions(screen.getByLabelText('Icon to add'), 'headphones');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('button', { name: 'Remove icon headphones' })).toBeTruthy();
  expect(save.mock.calls.at(-1)?.[0].colors).toEqual(defaultSelectionLists.colors);
  await user.click(screen.getByRole('button', { name: 'Remove icon mic' }));
  expect(screen.queryByRole('button', { name: 'Remove icon mic' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Reset icons' }));
  expect(save.mock.calls.at(-1)?.[0]).toEqual(defaultSelectionLists);
});
it('keeps a rejected edit for retry and rejects duplicate/invalid rows before saving', async () => {
  const user = userEvent.setup(), save = vi.fn<(value: SelectionLists) => Promise<void>>(async () => { throw new Error('synthetic quota'); }); render(<Harness save={save} />);
  await user.click(screen.getByRole('button', { name: 'Edit language ko' }));
  await user.clear(screen.getByLabelText('Display name')); await user.type(screen.getByLabelText('Display name'), 'Changed'); await user.click(screen.getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('alert')).toBeTruthy(); expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Changed'); expect(screen.getByText('한국어')).toBeTruthy();
  save.mockImplementation(async () => {}); await user.click(screen.getByRole('button', { name: 'Save' })); expect(screen.getByText('Changed')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Add color' })); await user.clear(screen.getByLabelText('HEX color')); await user.type(screen.getByLabelText('HEX color'), 'url(bad)'); await user.click(screen.getByRole('button', { name: 'Save' })); expect(save).toHaveBeenCalledTimes(2);
});
it('previews, cancels and atomically imports complete lists while displaying names as text', async () => {
  const user = userEvent.setup(), save = vi.fn<(value: SelectionLists) => Promise<void>>(async () => {}); render(<Harness save={save} />);
  const incoming = { ...custom, languages: [{ code: 'fr', name: '<img src=x onerror=alert(1)>' }] };
  await user.upload(screen.getByLabelText('Import settings JSON'), file(exportSelectionLists(incoming)));
  expect(await screen.findByRole('group', { name: 'Import preview' })).toBeTruthy(); expect(save).not.toHaveBeenCalled(); expect(document.querySelector('img')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel import' })); expect(screen.queryByRole('group', { name: 'Import preview' })).toBeNull(); expect(save).not.toHaveBeenCalled();
  await user.upload(screen.getByLabelText('Import settings JSON'), file(exportSelectionLists(incoming))); await screen.findByRole('group', { name: 'Import preview' }); await user.click(screen.getByRole('button', { name: 'Apply imported settings' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(incoming)); expect(screen.queryByRole('group', { name: 'Import preview' })).toBeNull(); expect(document.querySelector('img')).toBeNull();
});
it('rejects oversized and unknown-field files and ignores a read completing after unmount', async () => {
  const user = userEvent.setup(), save = vi.fn(async () => {}), view = render(<Harness save={save} />);
  await user.upload(screen.getByLabelText('Import settings JSON'), file(JSON.stringify({ ...JSON.parse(exportSelectionLists(custom)), unknown: [] }))); expect(await screen.findByRole('alert')).toBeTruthy(); expect(save).not.toHaveBeenCalled();
  const oversized = file('x'), read = vi.fn(); Object.defineProperty(oversized, 'size', { value: 256 * 1024 + 1 }); Object.defineProperty(oversized, 'arrayBuffer', { value: read, configurable: true });
  await user.upload(screen.getByLabelText('Import settings JSON'), oversized); expect(read).not.toHaveBeenCalled();
  let release!: (value: ArrayBuffer) => void; const gate = new Promise<ArrayBuffer>(resolve => { release = resolve; });
  await user.upload(screen.getByLabelText('Import settings JSON'), file('', () => gate)); view.unmount(); release(new TextEncoder().encode(exportSelectionLists(custom)).buffer); await gate; expect(save).not.toHaveBeenCalled();
});
it('copies current applied JSON with instructions and reports clipboard failures truthfully', async () => {
  const user = userEvent.setup(), write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(); render(<Harness />);
  await user.click(screen.getByRole('button', { name: 'Copy AI editing prompt' }));
  await waitFor(() => expect(write).toHaveBeenCalledOnce()); expect(write.mock.calls[0][0]).toContain(exportSelectionLists(defaultSelectionLists)); expect(screen.getByRole('status').textContent).toContain('copied');
  write.mockRejectedValueOnce(new Error('denied')); await user.click(screen.getByRole('button', { name: 'Copy AI editing prompt' })); expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.queryByRole('status')).toBeNull();
});
