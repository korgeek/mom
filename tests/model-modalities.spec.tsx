// @vitest-environment jsdom
// Public catalog and synthetic UI fixtures only; no credentials or provider calls.
import { webcrypto } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';
import { comparisonConsentToken, freezeMinutesComparison, previewComparison } from '../src/react-app/minutes/compare';
import { previewMinutesSelection, selectionConsentSnapshot } from '../src/react-app/minutes/selection';
import { parseRouterEndpoints, parseRouterModels, type RouterModel } from '../src/react-app/providers/catalog';
import { canonicalizeRouterModels } from '../src/react-app/providers/model-presentation';
import Minutes from '../src/react-app/ui/screens/Minutes';

beforeAll(() => { Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto }); });
afterEach(cleanup);

const at = '2026-10-01T00:00:00.000Z';
const pricing = { prompt: '0.000001', completion: '0.000002', request: '0' };
function choice(id = 'fixture/a', input = ['text', 'image', 'audio', 'video', 'file'], output = ['text', 'image']) {
 const model = parseRouterModels({ data: [{ id, name: id, context_length: 12000, top_provider: { max_completion_tokens: 4096 }, architecture: { input_modalities: input, output_modalities: output }, supported_parameters: ['max_tokens'], pricing }] }, at)[0];
 const endpoint = parseRouterEndpoints({ data: { endpoints: [{ tag: `Fixture/${id}`, provider_name: 'Fixture', context_length: 8000, max_prompt_tokens: 6000, max_completion_tokens: 2000, supported_parameters: ['max_tokens'], pricing }] } }, id, at)[0];
 return { model, endpoint };
}
const messages = [{ role: 'user' as const, content: 'TEST_ONLY_SELECTED_TRANSCRIPT' }];
const transcript = { id: 'fixture-transcript', parentId: null, rawIds: [], segments: [{ id: 's', text: messages[0].content, sourceStartMs: 0, sourceEndMs: 1000, rawIds: [] }], issues: [], missingRanges: [] };
function project(): MeetingProject {
 return { id: 'fixture-project', title: 'Fixture voice memo', icon: 'mic', color: '#3B82F6', pinned: false, createdAt: at, updatedAt: at, sourceAssets: [],
  audioOptions: { chunkMinutes: 10, overlapSeconds: 10, expectedLanguages: ['en'], bitrateKbps: 32, sampleRateHz: 16000 }, preparedChunks: [], rawTranscripts: [],
  transcriptVersions: [transcript], selectedTranscriptVersionId: transcript.id, minutesSettings: { modelId: 'fixture/a', outputLanguage: 'en', sections: ['summary'], instructions: '' },
  minutesRuns: [], minutesRevisions: [], selectedMinutesRevisionId: null, runs: [] };
}
function controller(extra: Partial<AppController> = {}): AppController {
 return { session: 'unlocked', projects: [], selectedProjectId: null, screen: 'minutes', settingsTab: 'connections', preferences: { ...defaultPreferences, uiLanguage: 'en' },
  defaultAudioOptions: project().audioOptions, modelCatalog: null, sttModelId: '', connections: [], storageEstimate: null, ...extra };
}
function preview(selected = choice()) {
 return previewMinutesSelection({ ...selected, messages, outputTokens: 1600, reasoningReserveTokens: 0 });
}
function field(card: HTMLElement, label: string) {
 const term = within(card).getByText(label, { selector: 'dt' });
 return term.parentElement!.querySelector('dd')!;
}

describe('catalog modality projection and consent', () => {
 it('projects validated catalog modalities without narrowing multimodal models to text', () => {
  const selected = choice(); const result = preview(selected);
  expect(result.modalities).toEqual({ input: selected.model.inputModalities, output: selected.model.outputModalities });
  expect(result.limits).toMatchObject({ contextTokens: 8000, maxPromptTokens: 6000, maxOutputTokens: 2000, outputTokens: 1600 });
  expect(JSON.stringify(result)).not.toContain(messages[0].content);
 });
 it('copies and freezes modality arrays while leaving the source independently editable', () => {
  const selected = choice(); const input = ['text', 'image']; const output = ['text'];
  const model = { ...selected.model, inputModalities: input, outputModalities: output };
  const result = preview({ ...selected, model });
  expect(Object.isFrozen(result.modalities?.input)).toBe(true);
  expect(Object.isFrozen(result.modalities?.output)).toBe(true);
  input.push('audio'); output.push('image');
  expect(result.modalities).toEqual({ input: ['text', 'image'], output: ['text'] });
 });
 it('keeps empty or absent metadata unknown instead of inventing text capabilities', () => {
  const selected = choice();
  expect(preview({ ...selected, model: { ...selected.model, inputModalities: [], outputModalities: [] } }).modalities).toEqual({ input: [], output: [] });
  const legacy = { ...selected.model, inputModalities: undefined, outputModalities: undefined } as unknown as RouterModel;
  expect(preview({ ...selected, model: legacy }).modalities).toEqual({ input: [], output: [] });
  expect(previewMinutesSelection({ model: null, endpoint: null, messages: null, outputTokens: null, reasoningReserveTokens: 0 }).modalities).toEqual({ input: [], output: [] });
 });
 it('marks a conflicting catalog sentinel unavailable rather than advertising its structural text arrays', () => {
  const selected = choice(); const other = { ...selected.model, inputModalities: ['text', 'audio'] };
  const model = canonicalizeRouterModels([selected.model, other])[0];
  expect(model.catalogConflict).toHaveLength(2);
  const result = preview({ ...selected, model });
  expect(result.modalities).toEqual({ input: [], output: [] });
  render(<Minutes controller={controller({ minutesSelection: result })} project={project()} />);
  const card = screen.getByRole('region', { name: 'Model details' });
  expect(within(card).queryByText('Catalog input modalities')).toBeNull();
  expect(within(card).queryByText('Catalog output modalities')).toBeNull();
 });
 it('binds catalog conflict availability even when modality arrays and existing consent fields stay identical', () => {
  const selected = choice();
  const baseline = selectionConsentSnapshot(selected.model, selected.endpoint, 1600, 0);
  const conflicting = selectionConsentSnapshot({ ...selected.model, catalogConflict: [selected.model, { ...selected.model, inputModalities: ['text'] }] }, selected.endpoint, 1600, 0);
  expect(conflicting).not.toEqual(baseline);
 });
 it('binds and freezes both modality dimensions in the immutable consent snapshot', () => {
  const selected = choice(); const input = ['text', 'image']; const output = ['text'];
  const model = { ...selected.model, inputModalities: input, outputModalities: output };
  const snapshot = selectionConsentSnapshot(model, selected.endpoint, 1600, 0);
  expect(snapshot.model).toMatchObject({ inputModalities: ['text', 'image'], outputModalities: ['text'] });
  expect(Object.isFrozen(snapshot.model.inputModalities)).toBe(true); expect(Object.isFrozen(snapshot.model.outputModalities)).toBe(true);
  input.push('audio'); output.push('image');
  expect(snapshot.model).toMatchObject({ inputModalities: ['text', 'image'], outputModalities: ['text'] });
  expect(selectionConsentSnapshot(model, selected.endpoint, 1600, 0)).not.toEqual(snapshot);
  expect(selectionConsentSnapshot({ ...model, inputModalities: ['text', 'image'], outputModalities: ['text', 'audio'] }, selected.endpoint, 1600, 0)).not.toEqual(snapshot);
 });
 it('invalidates comparison consent for catalog modality changes while retaining the frozen comparison', async () => {
  const p = project(); const a = choice(); const b = choice('fixture/b', ['text', 'audio'], ['text']); const choices = [a, b] as const;
  const frozen = await freezeMinutesComparison(p.id, transcript, p.minutesSettings, choices, 1600);
  const before = JSON.stringify(frozen); const token = await comparisonConsentToken(frozen, choices, 0, null);
  for (const changed of [{ ...a, model: { ...a.model, inputModalities: ['text'] } }, { ...a, model: { ...a.model, outputModalities: ['text', 'audio'] } }]) {
   expect(await comparisonConsentToken(frozen, [changed, b], 0, null)).not.toBe(token);
  }
  expect(JSON.stringify(frozen)).toBe(before);
  expect(frozen.members[0].selectionSnapshot).toMatchObject({ model: { inputModalities: a.model.inputModalities, outputModalities: a.model.outputModalities } });
 });
});

describe('single and comparison model details', () => {
 it.each(['en', 'ko'] as const)('shows catalog modalities and honest pre-run duration in the single card (%s)', language => {
  render(<Minutes controller={controller({ preferences: { ...defaultPreferences, uiLanguage: language }, minutesSelection: preview() })} project={project()} />);
  const card = screen.getByRole('region', { name: language === 'en' ? 'Model details' : '모델 상세' });
  expect(field(card, language === 'en' ? 'Catalog input modalities' : '카탈로그 입력 형식').textContent).toBe('text, image, audio, video, file');
  expect(field(card, language === 'en' ? 'Catalog output modalities' : '카탈로그 출력 형식').textContent).toBe('text, image');
  const details=card.closest('details')!;expect(details.open).toBe(false);fireEvent.click(details.querySelector('summary')!);expect(details.open).toBe(true);
  expect(within(card).queryByText(language === 'en' ? 'Duration' : '소요 시간')).toBeNull();
  expect(within(card).getByText(language === 'en' ? 'Catalog modalities do not guarantee support on the selected route. Notes requests send only text.' : '카탈로그 형식은 선택한 경로의 실제 지원을 보장하지 않아요. 정리 요청은 텍스트만 보내요.')).toBeTruthy();
 });
 it('shows each member’s actual catalog modalities in the A/B cards', () => {
  const p = project(); const a = choice(); const b = choice('fixture/b', ['text', 'audio'], ['text', 'audio']);
  const minutesComparison = previewComparison({ transcript, settings: p.minutesSettings, choices: [a, b] });
  render(<Minutes controller={controller({ comparisonOpen: true, minutesComparison })} project={p} />);
  const cards = screen.getAllByRole('region', { name: 'Model details' });
  expect(cards).toHaveLength(2);
  expect(field(cards[0], 'Catalog input modalities').textContent).toBe('text, image, audio, video, file');
  expect(field(cards[1], 'Catalog input modalities').textContent).toBe('text, audio');
  expect(field(cards[1], 'Catalog output modalities').textContent).toBe('text, audio');
  const details=cards[0].closest('details')!;expect(details.open).toBe(false);fireEvent.click(details.querySelector('summary')!);expect(details.open).toBe(true);
  for (const card of cards) expect(within(card).queryByText('Duration')).toBeNull();
 });
 it.each(['empty', 'legacy'] as const)('labels unknown modality dimensions unavailable (%s preview)', kind => {
  const selected = choice(); const result = kind === 'empty' ? preview({ ...selected, model: { ...selected.model, inputModalities: [], outputModalities: [] } }) : preview(selected);
  const legacy = { ...result, modalities: undefined };
  render(<Minutes controller={controller({ minutesSelection: kind === 'legacy' ? legacy : result })} project={project()} />);
  const card = screen.getByRole('region', { name: 'Model details' });
  expect(within(card).queryByText('Catalog input modalities')).toBeNull();
  expect(within(card).queryByText('Catalog output modalities')).toBeNull();
 });
});
