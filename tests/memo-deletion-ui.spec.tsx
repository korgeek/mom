// @vitest-environment jsdom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { defaultPreferences, type AppController } from '../src/react-app/App';
import type { MeetingProject } from '../src/react-app/domain/types';

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; this.querySelector<HTMLButtonElement>('button')?.focus(); };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);
const project: MeetingProject = {id:'SYNTHETIC_MEMO', title:'SYNTHETIC named memo', icon:'mic',color:'#2B59C3',pinned:false,createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z',sourceAssets:[],audioOptions:{chunkMinutes:10,overlapSeconds:10,expectedLanguages:['en'],bitrateKbps:32,sampleRateHz:16000},preparedChunks:[],rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null,minutesSettings:{outputLanguage:'en',sections:['summary'],instructions:'',modelId:''},minutesRuns:[],minutesRevisions:[],selectedMinutesRevisionId:null,runs:[]};
function controller(extra: Partial<AppController> = {}): AppController {
  return {session:'unlocked',projects:[project],selectedProjectId:project.id,screen:'import',settingsTab:'models',preferences:{...defaultPreferences,uiLanguage:'en'},defaultAudioOptions:project.audioOptions,modelCatalog:null,sttModelId:'',connections:[],storageEstimate:null,onDeleteMeeting:vi.fn(),...extra};
}

it.each(['import','stt','minutes'] as const)('exposes labelled deletion in the active %s header with explicit named confirmation', async current => {
  const user = userEvent.setup(), c=controller({screen:current}); render(<App controller={c}/>);
  const opener=screen.getByRole('button',{name:'Delete voice memo'});
  expect(opener.closest('.flow-header')).toBeTruthy(); await user.click(opener);
  const dialog=screen.getByRole('alertdialog',{name:'Delete this voice memo?'});
  expect(within(dialog).getByText(project.title)).toBeTruthy();
  expect(within(dialog).getByText(/raw and edited transcripts.*request and usage history/)).toBeTruthy();
  expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'Cancel'}));
  await user.keyboard('{Enter}'); expect(screen.queryByRole('alertdialog')).toBeNull(); expect(c.onDeleteMeeting).not.toHaveBeenCalled(); expect(document.activeElement).toBe(opener);
  await user.click(opener); fireEvent(screen.getByRole('alertdialog'),new Event('cancel',{bubbles:true,cancelable:true}));
  expect(screen.queryByRole('alertdialog')).toBeNull();expect(c.onDeleteMeeting).not.toHaveBeenCalled();
  await user.click(opener); const confirm=screen.getByRole('button',{name:'Delete this memo'}); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(c.onDeleteMeeting).toHaveBeenCalledExactlyOnceWith(project.id);
});

it.each([{busy:true},{storageWorking:true},{recordingActive:true},{onDeleteMeeting:undefined}])('blocks deletion while unavailable: %j', extra => {
  render(<App controller={controller(extra)}/>); const button=screen.getByRole('button',{name:'Delete voice memo'});
  expect((button as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button);expect(screen.queryByRole('alertdialog')).toBeNull();
});

it('keeps confirmation open while deleting, reports failure and permits an explicit retry', async () => {
  const user=userEvent.setup(), c=controller(), view=render(<App controller={c}/>);
  await user.click(screen.getByRole('button',{name:'Delete voice memo'}));await user.click(screen.getByRole('button',{name:'Delete this memo'}));
  view.rerender(<App controller={{...c,busy:true}}/>);
  expect((screen.getByRole('button',{name:'Delete this memo'}) as HTMLButtonElement).disabled).toBe(true);
  expect((within(screen.getByRole('alertdialog')).getByRole('button',{name:'Cancel'}) as HTMLButtonElement).disabled).toBe(true);
  fireEvent(screen.getByRole('alertdialog'),new Event('cancel',{bubbles:true,cancelable:true}));expect(screen.getByRole('alertdialog')).toBeTruthy();
  view.rerender(<App controller={{...c,error:'SYNTHETIC storage failure'}}/>);
  expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toBe('SYNTHETIC storage failure');
  await user.click(screen.getByRole('button',{name:'Delete this memo'}));expect(c.onDeleteMeeting).toHaveBeenCalledTimes(2);
});

it('drops confirmation and sensitive title on lock, without restoring a stale dialog after unlock', async () => {
  const user=userEvent.setup(),c=controller(),view=render(<App controller={c}/>);
  await user.click(screen.getByRole('button',{name:'Delete voice memo'}));view.rerender(<App controller={{...c,screenAccess:'locked'}}/>);
  expect(screen.queryByRole('alertdialog')).toBeNull(); expect(screen.queryByText(project.title)).toBeNull();
  view.rerender(<App controller={c}/>);expect(screen.queryByRole('alertdialog')).toBeNull();expect(c.onDeleteMeeting).not.toHaveBeenCalled();
});
