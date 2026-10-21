// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelPicker from '../src/react-app/ui/ModelPicker';
import type { CatalogChoice } from '../src/react-app/providers/model-presentation';

afterEach(cleanup);
const choice = (id: string, enabled = true): CatalogChoice => ({ id, label: `Alias ${id}`, provider: 'openrouter', enabled });
describe('picker shortlist regression', () => {
  it('prefers eligible dated candidates, preserves disabled selection and searches beyond the compact list', async () => {
    const user = userEvent.setup(); const onChange = vi.fn(); const selected = 'saved/blocked';
    render(<ModelPicker models={[choice('a/not-curated'), choice('openai/gpt-6-luna'), choice('deepseek/deepseek-v4.1-flash'), choice(selected, false), choice('z/hidden-target')]} value={selected} language="en" disabled={false} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: /^Model$/ }) as HTMLSelectElement;
    expect(select.value).toBe(selected); expect(within(select).getByRole('option', { name: /saved\/blocked/ }).hasAttribute('disabled')).toBe(true);
    expect(within(select).queryByRole('option', { name: /a\/not-curated/ })).toBeNull();
    expect(within(select).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['', selected, 'deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna']);
    await user.click(screen.getByText('Details · model catalog')); await user.type(screen.getByRole('searchbox', { name: 'Search models' }), 'hidden-target');
    expect(within(select).getByRole('option', { name: /z\/hidden-target/ })).toBeTruthy(); expect(select.value).toBe(selected); expect(onChange).not.toHaveBeenCalled();
    await user.clear(screen.getByRole('searchbox', { name: 'Search models' })); await user.selectOptions(screen.getByRole('combobox', { name: 'Model category' }), 'all');
    expect(within(select).getByRole('option', { name: /a\/not-curated/ })).toBeTruthy(); expect(select.value).toBe(selected); expect(onChange).not.toHaveBeenCalled();
  });
  it('discloses source/date and the namespace fallback while avoiding free-suffix billing claims', async () => {
    const user = userEvent.setup(); render(<ModelPicker models={[choice('owner/model:free')]} value="owner/model:free" language="en" disabled={false} onChange={vi.fn()} />);
    await user.click(screen.getByText('Details · model catalog')); const details = screen.getByText('Details · model catalog').closest('details')!;
    expect(details.textContent).toContain('2026-10-02T16:51:45Z'); expect(details.textContent).toMatch(/namespace fallback/);
    expect(within(details).getByRole('link', { name: 'CC BY 4.0' }).getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(details.textContent).toMatch(/does not guarantee/); expect(details.textContent).toMatch(/not a quality/);
  });
});
