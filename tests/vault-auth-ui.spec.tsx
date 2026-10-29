// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import { AuthenticationPolicyNotice } from '../src/react-app/ui/ScreenLock';
afterEach(cleanup);
const base = { preferences: { ...defaultPreferences, uiLanguage: 'en' } } as AppController;
it('warns on failures three and four and provides a deletion retry only while pending',()=>{
 const retry=vi.fn(); const view=render(<AuthenticationPolicyNotice controller={{...base,authFailures:3,onResetVault:retry}}/>);
 expect(screen.getByText(/Warning after 3 failures/)).toBeTruthy();
 const details=screen.getByText('Deletion policy details').closest('details')!; expect(details.open).toBe(false);
 expect(details.textContent).toContain('damaged encryption header'); expect(details.textContent).toContain('offline guessing');
 expect(screen.getByRole('alert').textContent).toContain('2 more failures');
 view.rerender(<AuthenticationPolicyNotice controller={{...base,authFailures:4,onResetVault:retry}}/>);
 expect(screen.getByRole('alert').textContent).toContain('One more failure');
 view.rerender(<AuthenticationPolicyNotice controller={{...base,authFailures:5,authDeletionPending:true,onResetVault:retry}}/>);
 expect(screen.getByRole('alert').textContent).toContain('deletion is pending');
 fireEvent.click(screen.getByRole('button',{name:'Retry vault deletion'})); expect(retry).toHaveBeenCalledOnce();
 view.rerender(<AuthenticationPolicyNotice controller={{...base,authFailures:5,authDeleted:true}}/>);
 expect(screen.getByRole('alert').textContent).toContain('was deleted');
});
