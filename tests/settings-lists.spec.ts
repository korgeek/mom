import { describe, expect, it } from 'vitest';
import { defaultSelectionLists, exportSelectionLists, normalizeListOverrides, normalizeSelectionLists, parseSelectionLists, resolveSelectionLists, selectionListOverrides, selectionListsPrompt } from '../src/react-app/settings/lists';
const input = () => ({ colors: ['#aAbBcC'], languages: [{ code: ' PT-BR ', name: ' Português ' }] });
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const file = (extra = {}) => ({ format: 'mom-color-language-settings', version: 1, ...input(), ...extra });

describe('color and spoken-language lists boundary', () => {
  it('validates preset icon choices and upgrades legacy files without losing defaults', () => {
    const lists = normalizeSelectionLists({ ...input(), icons: ['mic', 'headphones'] });
    expect(lists.icons).toEqual(['mic', 'headphones']);
    for (const icons of [[], ['mic', 'mic'], ['unknown'], ['<svg onload=alert(1)>']]) expect(() => normalizeSelectionLists({ ...input(), icons })).toThrow();
    expect(parseSelectionLists(bytes(file())).icons).toEqual(defaultSelectionLists.icons);
    expect(parseSelectionLists(bytes(file()), ['headphones']).icons).toEqual(['headphones']);
    expect(parseSelectionLists(new TextEncoder().encode(exportSelectionLists(lists)))).toEqual(lists);
  });
  it('normalizes detached values and stores only changed sections', () => {
    const source = input(), lists = normalizeSelectionLists(source);
    source.languages[0].name = 'changed';
    expect(lists).toEqual({ icons: defaultSelectionLists.icons, colors: ['#AABBCC'], languages: [{ code: 'pt-br', name: 'Português' }] });
    expect(selectionListOverrides(defaultSelectionLists)).toEqual({ version: 1 });
    const custom = { ...defaultSelectionLists, colors: lists.colors };
    expect(selectionListOverrides(custom)).toEqual({ version: 1, colors: ['#AABBCC'] });
    expect(resolveSelectionLists(selectionListOverrides(custom))).toEqual(custom);
    expect(resolveSelectionLists(undefined)).toEqual(defaultSelectionLists);
  });
  it.each([
    { ...input(), colors: [] }, { ...input(), colors: Array(65).fill('#123456') },
    { ...input(), colors: ['#aabbcc', '#AABBCC'] }, { ...input(), colors: ['var(--accent)'] },
    { ...input(), colors: ['#ABC'] }, { ...input(), colors: ['url(https://example.test)'] },
    { ...input(), languages: [] }, { ...input(), languages: [{ code: 'en', name: '' }] },
    { ...input(), languages: [{ code: 'en', name: 'a\nb' }] },
    { ...input(), languages: [{ code: 'e', name: 'English' }] },
    { ...input(), languages: [{ code: 'en', name: 'a'.repeat(81) }] },
    { ...input(), languages: [{ code: 'en', name: 'English' }, { code: 'EN', name: 'duplicate' }] },
    { ...input(), apiKey: 'FORBIDDEN_SYNTHETIC_FIELD' }, null,
  ])('rejects invalid or extra list data without silently changing it: %j', value => {
    expect(() => normalizeSelectionLists(value)).toThrow();
  });
  it('rejects malformed stored overrides but accepts absent legacy settings', () => {
    expect(normalizeListOverrides(undefined)).toEqual({ version: 1 });
    for (const value of [null, {}, { version: 2 }, { version: 1, colors: [] }, { version: 1, unexpected: true }]) expect(() => normalizeListOverrides(value)).toThrow();
  });
  it('imports exact versioned bounded UTF-8 JSON, never code or extra fields', () => {
    expect(parseSelectionLists(bytes(file()))).toEqual(normalizeSelectionLists(input()));
    for (const value of [file({ version: 2 }), file({ format: 'other' }), file({ icons: [] }), { format: 'mom-color-language-settings', version: 1, colors: ['#123456'] }]) expect(() => parseSelectionLists(bytes(value))).toThrow();
    expect(() => parseSelectionLists(new Uint8Array(256 * 1024 + 1))).toThrow();
    expect(() => parseSelectionLists(new Uint8Array([0xff]))).toThrow();
    expect(() => parseSelectionLists(new TextEncoder().encode('({colors:[]})'))).toThrow();
  });
  it('rejects prototype icon names, executable colors and secret fields in imported or persisted settings', () => {
    const current = JSON.parse(exportSelectionLists(defaultSelectionLists));
    for (const icons of [['__proto__'], ['constructor'], ['toString'], ['mic', 'mic']]) {
      expect(() => parseSelectionLists(bytes({ ...current, icons }))).toThrow();
      expect(() => normalizeListOverrides({ version: 1, icons })).toThrow();
    }
    for (const extra of [{ apiKey: 'SYNTHETIC_FORBIDDEN_FIELD' }, { colors: ['url(https://example.invalid)'] }, { languages: [{ code: 'en', name: 'English', token: 'SYNTHETIC_FORBIDDEN_FIELD' }] }]) expect(() => parseSelectionLists(bytes({ ...current, ...extra }))).toThrow();
    const prototypeField = `{"__proto__":{"polluted":true},${JSON.stringify(current).slice(1)}`;
    expect(() => parseSelectionLists(new TextEncoder().encode(prototypeField))).toThrow();
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
  it.each(['ko', 'en'] as const)('exports and prompts only the two applied lists in %s', language => {
    const value = { ...normalizeSelectionLists(input()), secret: 'NEVER_EXPORT_THIS' };
    const exported = exportSelectionLists(value), prompt = selectionListsPrompt(value, language);
    expect(JSON.parse(exported)).toEqual({ format: 'mom-appearance-settings', version: 1, ...normalizeSelectionLists(input()) });
    expect(parseSelectionLists(new TextEncoder().encode(exported))).toEqual(normalizeSelectionLists(input()));
    expect(prompt).toContain(exported); expect(prompt).toContain('256');
    expect(exported + prompt).not.toContain(value.secret);
  });
});
