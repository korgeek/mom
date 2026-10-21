// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { defaultPreferences, type AppController } from '../src/react-app/App';
import Settings from '../src/react-app/ui/screens/Settings';
import STT from '../src/react-app/ui/screens/STT';
import Import from '../src/react-app/ui/screens/Import';
import Review from '../src/react-app/ui/screens/Review';
import type { DeletionPlan, MeetingProject } from '../src/react-app/domain/types';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function controller():AppController {
  return {session:'unlocked',projects:[],selectedProjectId:null,screen:'settings',settingsTab:'security',preferences:{...defaultPreferences,uiLanguage:'en'},defaultAudioOptions:{chunkMinutes:5,overlapSeconds:5,expectedLanguages:['en'],bitrateKbps:32,sampleRateHz:16000},modelCatalog:[],sttModelId:'',connections:[],storageEstimate:null,onRefreshStorage:vi.fn()};
}
it('shows precise current-vault storage and its optional origin-wide estimate separately',()=>{
  const c=controller(); c.storageInventory={sourceBytes:32044,chunkBytes:800,draftBytes:32,projectBytes:100,encryptedBytes:34000,vaultBytes:200,originUsage:90000,originQuota:1000000,projects:[]}; render(<Settings controller={c}/>);
  expect(screen.getByRole('heading',{name:'Storage management'})).toBeTruthy(); expect(screen.getByText('Encoded originals')).toBeTruthy(); expect(screen.getByText('Ciphertext payload')).toBeTruthy();
  expect(screen.getByRole('button',{name:'Refresh storage'})).toBeTruthy(); expect(screen.getByText(/Origin-wide estimate/)).toBeTruthy();
});
function meeting():MeetingProject {
 const id='TEST_ONLY_MEETING', rawId='TEST_ONLY_RAW',runId='TEST_ONLY_RUN',segment={id:'TEST_ONLY_SEGMENT',text:'TEST_ONLY retained edit',sourceStartMs:0,sourceEndMs:1000,rawIds:[rawId]};
 return {id,title:'TEST_ONLY named voice memo',icon:'mic',color:'#2B59C3',pinned:false,createdAt:'2026-10-02T00:00:00Z',updatedAt:'2026-10-02T00:00:00Z',sourceAssets:[{id:'TEST_ONLY_SOURCE',fileName:'TEST_ONLY.wav',bytes:32044,container:'wav',codec:'pcm_s16le',durationMs:1000,channels:1,sampleRateHz:16000}],audioOptions:{chunkMinutes:5,overlapSeconds:5,expectedLanguages:['en'],bitrateKbps:32,sampleRateHz:16000},preparedChunks:[{id:'TEST_ONLY_CHUNK',sourceId:'TEST_ONLY_SOURCE',index:0,sourceStartMs:0,sourceEndMs:1000,encodingOffsetMs:0,encodedBytes:2000,mimeType:'audio/mpeg',codec:'mp3',audioRecordId:'TEST_ONLY_AUDIO'}],rawTranscripts:[{id:rawId,chunkId:'TEST_ONLY_CHUNK',runId,response:{text:'TEST_ONLY'},text:'TEST_ONLY',segments:[segment],timing:'chunk',speakerScope:'none',execution:null}],transcriptVersions:[{id:'TEST_ONLY_VERSION',parentId:null,rawIds:[rawId],segments:[segment],issues:[],missingRanges:[]}],selectedTranscriptVersionId:'TEST_ONLY_VERSION',minutesSettings:{outputLanguage:'en',sections:['summary'],instructions:'',modelId:''},minutesRuns:[],minutesRevisions:[],selectedMinutesRevisionId:null,runs:[{id:runId,projectId:id,state:'saved',checkpoint:{id:'TEST_ONLY_CHECKPOINT',projectId:id,runId,recordIds:['TEST_ONLY_RAW'],committedAt:'2026-10-02T00:00:00Z'}}],retainedAudio:{sourceIds:['TEST_ONLY_SOURCE'],chunkIds:[]}};
}
it('blocks deleted chunk playback and paid rerun while preserving transcript editing',()=>{
 const p=meeting(),c={...controller(),projects:[p],selectedProjectId:p.id,modelCatalog:[{id:'gpt-transcribe',label:'TEST_ONLY model',provider:'openai' as const,kind:'stt' as const,enabled:true}],sttModelId:'gpt-transcribe',onPlayChunk:vi.fn(),onPlaySegment:vi.fn(),onRerunSTT:vi.fn(),onEditTranscript:vi.fn()};
 render(<STT controller={c} project={p}/>); const play=screen.getByRole('button',{name:'Play chunk 1'}),rerun=screen.getByRole('button',{name:'Re-transcribe'});
 expect((play as HTMLButtonElement).disabled).toBe(true); expect((rerun as HTMLButtonElement).disabled).toBe(true); fireEvent.click(play); fireEvent.click(rerun); expect(c.onPlayChunk).not.toHaveBeenCalled(); expect(c.onRerunSTT).not.toHaveBeenCalled();
 expect((screen.getByRole('button',{name:'Edit segment 1'}) as HTMLButtonElement).disabled).toBe(false); expect(screen.getByText('TEST_ONLY retained edit')).toBeTruthy();
});
it('does not advertise deleted segment replay from retained transcript metadata',()=>{
 const p=meeting(),c={...controller(),onPlaySegment:vi.fn(),onEditTranscript:vi.fn()}; render(<Review controller={c} project={p}/>);
 const play=screen.getByRole('button',{name:'00:00–00:01'}); expect((play as HTMLButtonElement).disabled).toBe(true); fireEvent.click(play); expect(c.onPlaySegment).not.toHaveBeenCalled();
});
it('shows original-byte loss and new-voice memo guidance instead of unverifiable reselection or source preview',()=>{
 vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{}); vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
 const p={...meeting(),retainedAudio:{sourceIds:[],chunkIds:['TEST_ONLY_CHUNK']}},c={...controller(),sourcePreviewUrl:'blob:TEST_ONLY_DELETED',onPickFile:vi.fn(),onPrepareAudio:vi.fn(),onClearFile:vi.fn()}; render(<Import controller={c} project={p}/>);
 expect(screen.queryByRole('button',{name:'Choose file for preview'})).toBeNull(); expect(screen.queryByLabelText('Source audio preview')).toBeNull();
 expect(screen.getByText(/cannot be verified.*new voice memo/i)).toBeTruthy(); expect((screen.getByRole('button',{name:'Prepare transcription'}) as HTMLButtonElement).disabled).toBe(true);
});
it('allows local reprepare from a retained source while keeping deleted chunk history out of replacement',()=>{
 const p={...meeting(),rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null},c={...controller(),onPickFile:vi.fn(),onPrepareAudio:vi.fn(),onClearFile:vi.fn()};render(<Import controller={c} project={p}/>);
 expect((screen.getByRole('button',{name:'Prepare transcription'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'Choose file for preview'}) as HTMLButtonElement).disabled).toBe(false);expect((screen.getByRole('button',{name:'Replace'}) as HTMLButtonElement).disabled).toBe(true);
});
it('binds acknowledgement to the current plan and prevents repeated confirmation while cleanup is pending',async()=>{
 const user=userEvent.setup(),p=meeting(),confirm=vi.fn(),cancel=vi.fn(),plan:DeletionPlan={scope:'chunks',projectId:p.id,recordIds:['TEST_ONLY_AUDIO'],draftIds:[],versionToken:'TEST_ONLY_OLD_TOKEN'},c={...controller(),projects:[p],audioDeletionPlan:plan,onConfirmAudioDeletion:confirm,onCancelAudioDeletion:cancel};
 const view=render(<Settings controller={c}/>);await user.click(screen.getByRole('checkbox',{name:'I understand the audio loss'}));expect((screen.getByRole('button',{name:'Delete selected audio'}) as HTMLButtonElement).disabled).toBe(false);
 view.rerender(<Settings controller={{...c,audioDeletionPlan:{...plan,versionToken:'TEST_ONLY_NEW_TOKEN'}}}/>);expect((screen.getByRole('button',{name:'Delete selected audio'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('checkbox',{name:'I understand the audio loss'}) as HTMLInputElement).checked).toBe(false);
 await user.click(screen.getByRole('checkbox',{name:'I understand the audio loss'}));view.rerender(<Settings controller={{...c,audioDeletionPlan:{...plan,versionToken:'TEST_ONLY_NEW_TOKEN'},storageWorking:true,busy:true}}/>);await user.click(screen.getByRole('button',{name:'Delete selected audio'}));await user.keyboard('{Escape}');expect(confirm).not.toHaveBeenCalled();expect(cancel).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByText(/Wait for confirmed completion/)).toBeTruthy();
});
it('requires explicit current-plan acknowledgement; Cancel, default Enter and Escape never delete',async()=>{
 const user=userEvent.setup(), p=meeting(), confirmed=vi.fn(),planned=vi.fn();
 const inventory={sourceBytes:32044,chunkBytes:2000,draftBytes:32,projectBytes:100,encryptedBytes:34500,vaultBytes:200,originUsage:null,originQuota:null,projects:[{projectId:p.id,sourceBytes:32044,chunkBytes:2000,draftBytes:32,projectBytes:100,encryptedBytes:34500,retainedAudio:{sourceIds:['TEST_ONLY_SOURCE'],chunkIds:['TEST_ONLY_CHUNK']},draftIds:['TEST_ONLY_DRAFT']}]};
 function Harness(){const [plan,setPlan]=useState<DeletionPlan|null>(null);return <Settings controller={{...controller(),projects:[p],storageInventory:inventory,audioDeletionPlan:plan,onPlanAudioDeletion:(scope,id)=>{planned(scope,id);setPlan({scope,projectId:id,recordIds:['TEST_ONLY_RECORD'],draftIds:scope==='source'?['TEST_ONLY_DRAFT']:[],versionToken:`TEST_ONLY-${scope}`});},onCancelAudioDeletion:()=>setPlan(null),onConfirmAudioDeletion:confirmed}}/>;}
 render(<Harness/>); const open=screen.getByRole('button',{name:'Delete original audio'}); await user.click(open); let dialog=screen.getByRole('dialog',{name:'Delete original audio?'});
 expect(document.activeElement).toBe(within(dialog).getByRole('button',{name:'Cancel'})); expect((within(dialog).getByRole('button',{name:'Delete selected audio'}) as HTMLButtonElement).disabled).toBe(true);
 expect(within(dialog).getByText(p.title)).toBeTruthy(); expect(within(dialog).getByText('TEST_ONLY_DRAFT')).toBeTruthy(); expect(within(dialog).getByText(/Raw STT responses/)).toBeTruthy();
 await user.keyboard('{Enter}'); expect(confirmed).not.toHaveBeenCalled(); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(open);
 await user.click(open); await user.keyboard('{Escape}'); expect(confirmed).not.toHaveBeenCalled(); await user.click(open); dialog=screen.getByRole('dialog');
 await user.click(within(dialog).getByRole('checkbox',{name:'I understand the audio loss'})); await user.click(within(dialog).getByRole('button',{name:'Delete selected audio'})); expect(confirmed).toHaveBeenCalledExactlyOnceWith('TEST_ONLY-source');
});
function cleanupFocusFixture(refresh=true){
 const p=meeting(),inventory={sourceBytes:32044,chunkBytes:2000,draftBytes:0,projectBytes:100,encryptedBytes:34500,vaultBytes:200,originUsage:null,originQuota:null,projects:[{projectId:p.id,sourceBytes:32044,chunkBytes:2000,draftBytes:0,projectBytes:100,encryptedBytes:34500,retainedAudio:{sourceIds:['TEST_ONLY_SOURCE'],chunkIds:['TEST_ONLY_CHUNK']},draftIds:[]}]};
 let c:AppController;
 const update=(patch:Partial<AppController>)=>{c={...c,...patch};view.rerender(<><button type="button">TEST_ONLY outside focus</button><Settings controller={c}/></>);};
 const confirmed=vi.fn(()=>update({audioDeletionPlan:null,storageWorking:true,busy:true}));
 c={...controller(),projects:[p],storageInventory:inventory,onRefreshStorage:refresh?vi.fn():undefined,onPlanAudioDeletion:(scope,id)=>update({audioDeletionPlan:{scope,projectId:id,recordIds:['TEST_ONLY_SOURCE'],draftIds:[],versionToken:'TEST_ONLY_FOCUS_TOKEN'}}),onCancelAudioDeletion:()=>update({audioDeletionPlan:null}),onConfirmAudioDeletion:confirmed};
 const view=render(<><button type="button">TEST_ONLY outside focus</button><Settings controller={c}/></>);
 return{confirmed,update,succeed:()=>update({busy:false,storageWorking:false,storageNotice:'TEST_ONLY confirmed',storageInventory:{...inventory,sourceBytes:0,projects:inventory.projects.map(item=>({...item,sourceBytes:0,retainedAudio:{...item.retainedAudio,sourceIds:[]}}))}}),fail:()=>update({busy:false,storageWorking:false,storageError:'TEST_ONLY unconfirmed failure'})};
}
it.each(['success','failure','heading-fallback'] as const)('restores cleanup focus after the real consumed-plan transition: %s',async outcome=>{
 const user=userEvent.setup(),f=cleanupFocusFixture(outcome!=='heading-fallback'),open=screen.getByRole('button',{name:'Delete original audio'});await user.click(open);await user.click(screen.getByRole('checkbox',{name:'I understand the audio loss'}));
 const confirm=screen.getByRole('button',{name:'Delete selected audio'});confirm.focus();await user.keyboard('{Enter}');expect(f.confirmed).toHaveBeenCalledExactlyOnceWith('TEST_ONLY_FOCUS_TOKEN');expect(screen.queryByRole('dialog')).toBeNull();
 const pendingFocus=document.activeElement;expect((open as HTMLButtonElement).disabled).toBe(true);if(outcome==='failure')f.fail();else f.succeed();
 const expected=outcome==='failure'?open:outcome==='heading-fallback'?screen.getByRole('heading',{name:'Storage management'}):screen.getByRole('button',{name:'Refresh storage'});
 expect(document.activeElement).toBe(expected);expect(pendingFocus?.getAttribute('role')).toBe('status');if(outcome!=='failure')expect((open as HTMLButtonElement).disabled).toBe(true);
});
it('discards cleanup focus ownership on lock rather than restoring a stale sensitive opener after unlock',async()=>{
 const user=userEvent.setup(),f=cleanupFocusFixture();await user.click(screen.getByRole('button',{name:'Delete original audio'}));await user.click(screen.getByRole('checkbox',{name:'I understand the audio loss'}));await user.click(screen.getByRole('button',{name:'Delete selected audio'}));
 f.update({session:'locked',projects:[],storageInventory:null,audioDeletionPlan:null,storageWorking:false,busy:false});const outside=screen.getByRole('button',{name:'TEST_ONLY outside focus'});outside.focus();f.update({session:'unlocked'});expect(document.activeElement).toBe(outside);expect(f.confirmed).toHaveBeenCalledTimes(1);
});
it('presents human-readable audio sizes while retaining exact bytes inside Storage details',()=>{
 const c=controller();c.storageInventory={sourceBytes:1048576,chunkBytes:2048,draftBytes:32,projectBytes:100,encryptedBytes:1051000,vaultBytes:200,originUsage:null,originQuota:null,projects:[]};render(<Settings controller={c}/>);
 expect(screen.getByText('Original audio')).toBeTruthy();expect(screen.getByText('1 MiB')).toBeTruthy();expect(screen.getByText('2 KiB')).toBeTruthy();expect(screen.getByText('Ciphertext payload').closest('details')).not.toBeNull();expect(screen.getByText('1,048,576 B')).toBeTruthy();
});
