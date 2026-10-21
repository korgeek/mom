// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JsonResponse from '../src/react-app/ui/components/JsonResponse';

afterEach(cleanup);

it('shows read-only key/value data, escapes provider text and preserves the complete original JSON', async () => {
  const response = { model: 'SYNTHETIC_MODEL', usage: { seconds: 12, estimated: false }, provider: null, text: '<img src=x onerror=alert(1)>' };
  const before = structuredClone(response), user = userEvent.setup();
  render(<JsonResponse value={response} language="en" />);
  expect(screen.getByText('SYNTHETIC_MODEL')).toBeTruthy();
  expect(screen.getByText('12')).toBeTruthy(); expect(screen.getByText('false')).toBeTruthy(); expect(screen.getByText('null')).toBeTruthy();
  expect(document.querySelector('img')).toBeNull(); expect(screen.queryByRole('textbox')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'View original JSON' }));
  expect(JSON.parse(screen.getByLabelText('Original response JSON').textContent!)).toEqual(before);
  await user.click(screen.getByRole('button', { name: 'Back to structured view' }));
  expect(response).toEqual(before);
});

it('only renders long strings and array children when the user expands them', async () => {
  const text = 'SYNTHETIC_LONG_RESPONSE '.repeat(30), user = userEvent.setup();
  render(<JsonResponse value={{ text, segments: [{ text: 'SYNTHETIC_NESTED_RESPONSE' }] }} language="en" />);
  expect(screen.queryByText(text)).toBeNull(); expect(screen.queryByText('SYNTHETIC_NESTED_RESPONSE')).toBeNull();
  await user.click(screen.getByText('text', { selector: 'code' }));
  await waitFor(() => expect(screen.getByText(text, { normalizer: value => value }).textContent).toBe(text));
  await user.click(screen.getByText('segments', { selector: 'code' }));
  await waitFor(() => expect(screen.getByText('[0]', { selector: 'code' })).toBeTruthy());
  await user.click(screen.getByText('[0]', { selector: 'code' }));
  await waitFor(() => expect(screen.getByText('SYNTHETIC_NESTED_RESPONSE')).toBeTruthy());
});

it('bounds the initial rendered array and lets the user reveal every remaining value', async () => {
  const response = Array.from({ length: 120 }, (_, index) => 'SYNTHETIC_ITEM_' + index), user = userEvent.setup();
  render(<JsonResponse value={response} language="en" />);
  expect(screen.getByText('SYNTHETIC_ITEM_49')).toBeTruthy(); expect(screen.queryByText('SYNTHETIC_ITEM_50')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Show 50 more' }));
  expect(screen.getByText('SYNTHETIC_ITEM_99')).toBeTruthy(); expect(screen.queryByText('SYNTHETIC_ITEM_100')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Show 20 more' }));
  expect(screen.getByText('SYNTHETIC_ITEM_119')).toBeTruthy(); expect(screen.queryByRole('button', { name: /Show .* more/ })).toBeNull();
});

it.each([null, true, 0, 'SYNTHETIC_STRING'] as const)('accepts a primitive JSON root %s', value => {
  render(<JsonResponse value={value} language="ko" />);
  expect(screen.getByText(String(value))).toBeTruthy();
});

it.each([[{}, '{}'], [[], '[]']] as const)('shows an empty container instead of a blank response', (value, text) => {
  render(<JsonResponse value={value} language="en" />);
  expect(screen.getByText(text)).toBeTruthy();
});
