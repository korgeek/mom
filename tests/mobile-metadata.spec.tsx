// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Import from '../src/react-app/ui/screens/Import';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';

beforeEach(() => { vi.stubGlobal('matchMedia', () => Object.assign(new EventTarget(), { matches: true })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function project(): MeetingProject {
  return { id: 'metadata-fixture', title: 'Synthetic mobile memo', icon: 'mic', color: '#3B82F6', pinned: false,
    createdAt: '2026-10-17T00:00:00Z', updatedAt: '2026-10-17T00:00:00Z', sourceAssets: [],
    audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['ko'], bitrateKbps: 32, sampleRateHz: 16000 },
    preparedChunks: [], rawTranscripts: [], transcriptVersions: [], selectedTranscriptVersionId: null,
    minutesSettings: { outputLanguage: 'en', sections: ['summary'], instructions: '', modelId: '' },
    minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}

function controller(p: MeetingProject, extra: Partial<AppController> = {}): AppController {
  return { session: 'unlocked', projects: [p], selectedProjectId: p.id, screen: 'import', settingsTab: 'appearance',
    preferences: { ...defaultPreferences, uiLanguage: 'en' }, defaultAudioOptions: p.audioOptions,
    modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null,
    onUpdateMeeting: vi.fn(), onAudioOptions: vi.fn(), ...extra };
}

describe('mobile memo metadata disclosure', () => {
  it.each(['ko', 'en'] as const)('starts collapsed with title and languages outside the choices in %s', async language => {
    const p = project(), user = userEvent.setup();
    render(<Import project={p} controller={controller(p, { preferences: { ...defaultPreferences, uiLanguage: language } })} />);
    const toggle = screen.getByRole('button', { name: language === 'ko' ? '아이콘 · 색상 · 녹음 · #3B82F6' : 'Icon & color · Recording · #3B82F6' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const choices = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(choices).toBeTruthy();
    expect(choices.dataset.collapsed).toBe('true');
    const title = screen.getByRole('textbox', { name: language === 'ko' ? '메모 제목' : 'Memo title' });
    const languages = screen.getByRole('group', { name: language === 'ko' ? '사용 언어 · 복수 선택' : 'Spoken languages · select multiple' });
    expect(choices.contains(title)).toBe(false);
    expect(choices.contains(languages)).toBe(false);
    expect((title as HTMLInputElement).value).toBe(p.title);
    expect(within(languages).getByRole('button', { name: 'English' })).toBeTruthy();
    const originalChoices = Array.from(choices.querySelectorAll('button'));
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(choices.dataset.collapsed).toBe('false');
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(Array.from(choices.querySelectorAll('button'))).toEqual(originalChoices);
  });

  it('retains icon, color, title and spoken-language callbacks and refreshes the compact summary', async () => {
    const p = project(), c = controller(p), user = userEvent.setup();
    const view = render(<Import project={p} controller={c} />);
    const toggle = screen.getByRole('button', { name: 'Icon & color · Recording · #3B82F6' });
    await user.click(toggle);
    const choices = within(document.getElementById(toggle.getAttribute('aria-controls')!)!);
    await user.click(choices.getByRole('button', { name: 'People' }));
    expect(c.onUpdateMeeting).toHaveBeenLastCalledWith(p.id, { icon: 'users' });
    await user.click(choices.getByRole('button', { name: 'Color #03B26C' }));
    expect(c.onUpdateMeeting).toHaveBeenLastCalledWith(p.id, { color: '#03B26C' });
    await user.click(toggle);
    fireEvent.change(screen.getByRole('textbox', { name: 'Memo title' }), { target: { value: 'Edited fixture title' } });
    expect(c.onUpdateMeeting).toHaveBeenLastCalledWith(p.id, { title: 'Edited fixture title' });
    await user.click(within(screen.getByRole('group', { name: 'Spoken languages · select multiple' })).getByRole('button', { name: 'English' }));
    expect(c.onAudioOptions).toHaveBeenLastCalledWith(p.id, { ...p.audioOptions, expectedLanguages: ['ko', 'en'] });
    view.rerender(<Import project={{ ...p, icon: 'users', color: '#03B26C' }} controller={c} />);
    expect(screen.getByRole('button', { name: 'Icon & color · People · #03B26C' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the disclosure and existing editing controls disabled while busy', async () => {
    const p = project(), c = controller(p, { busy: true }), user = userEvent.setup();
    const view = render(<Import project={p} controller={c} />);
    const toggle = screen.getByRole('button', { name: 'Icon & color · Recording · #3B82F6' });
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const icon = screen.getByRole('button', { name: 'People' }) as HTMLButtonElement;
    const color = screen.getByRole('button', { name: 'Color #03B26C' }) as HTMLButtonElement;
    const english = within(screen.getByRole('group', { name: 'Spoken languages · select multiple' })).getByRole('button', { name: 'English' }) as HTMLButtonElement;
    expect(icon.disabled).toBe(true); expect(color.disabled).toBe(true); expect(english.disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Memo title' }) as HTMLInputElement).disabled).toBe(true);
    await user.click(icon); await user.click(color); await user.click(english);
    expect(c.onUpdateMeeting).not.toHaveBeenCalled(); expect(c.onAudioOptions).not.toHaveBeenCalled();
    view.rerender(<Import project={p} controller={{ ...c, meetingEditsSaving: true }} />);
    expect((screen.getByRole('textbox', { name: 'Memo title' }) as HTMLInputElement).disabled).toBe(false);
    expect(icon.disabled).toBe(true); expect(color.disabled).toBe(true); expect(english.disabled).toBe(true);
  });

  it.each(['People', 'Color #03B26C'])('avoids CSS blur before the mobile media callback for focused %s and removes its listener', name => {
    const media = Object.assign(new EventTarget(), { matches: false });
    const remove = vi.spyOn(media, 'removeEventListener');
    const matchMedia = vi.fn(() => media);
    vi.stubGlobal('matchMedia', matchMedia);
    const p = project(), view = render(<Import project={p} controller={controller(p)} />);
    const toggle = screen.getByRole('button', { name: 'Icon & color · Recording · #3B82F6' });
    const choice = screen.getByRole('button', { name });
    const choices = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    choice.focus();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    media.matches = true;
    // Browsers apply mobile CSS and blur display:none controls before firing the media callback.
    if (choices.dataset.collapsed === 'true') choice.blur();
    act(() => { media.dispatchEvent(new Event('change')); });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(choice);
    expect(matchMedia).toHaveBeenCalledWith('(max-width: 759px)');
    view.unmount();
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('keeps choices collapsed on entering mobile when focus was intentionally moved outside', () => {
    const media = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal('matchMedia', () => media);
    const p = project();
    render(<Import project={p} controller={controller(p)} />);
    const toggle = screen.getByRole('button', { name: 'Icon & color · Recording · #3B82F6' });
    screen.getByRole('button', { name: 'People' }).focus();
    const title = screen.getByRole('textbox', { name: 'Memo title' });
    title.focus();
    media.matches = true;
    act(() => { media.dispatchEvent(new Event('change')); });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)?.dataset.collapsed).toBe('true');
    expect(document.activeElement).toBe(title);
  });
});
