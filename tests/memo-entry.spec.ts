import {expect,it,vi} from 'vitest';
import {memoEntryScreen,languageHintSummary,registeredLanguageHint} from '../src/react-app/ui/copy';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import type {MeetingProject} from '../src/react-app/domain/types';
vi.mock('../src/react-app/media/prepare',()=>({planChunkRanges:()=>[{sourceStartMs:0,sourceEndMs:1000}]}));
const p={id:'p',sourceAssets:[],audioOptions:{},preparedChunks:[],rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null,minutesRuns:[],minutesRevisions:[],runs:[]} as unknown as MeetingProject;
it('opens the next useful stage from durable work without treating partial preparation as ready',()=>{
 expect(memoEntryScreen(p)).toBe('import');
 const prepared={...p,sourceAssets:[{id:'s'}],preparedChunks:[{id:'c',sourceId:'s',sourceStartMs:0,sourceEndMs:1000,encodedBytes:1,audioRecordId:'a'}],retainedAudio:{sourceIds:['s'],chunkIds:['c']}} as unknown as MeetingProject;
 expect(memoEntryScreen(prepared)).toBe('stt');expect(memoEntryScreen({...prepared,retainedAudio:{sourceIds:['s'],chunkIds:[]}})).toBe('import');
 const transcript={id:'v',segments:[{text:'Synthetic'}],missingRanges:[]};
 expect(memoEntryScreen({...p,transcriptVersions:[transcript],selectedTranscriptVersionId:'v'} as unknown as MeetingProject)).toBe('minutes');
 expect(memoEntryScreen({...p,transcriptVersions:[{...transcript,missingRanges:[{}]}],selectedTranscriptVersionId:'v'} as unknown as MeetingProject)).toBe('stt');
 expect(memoEntryScreen({...p,runs:[{state:'failed',intent:{kind:'stt'}}]} as unknown as MeetingProject)).toBe('stt');
 expect(memoEntryScreen({...p,runs:[{state:'failed',intent:{kind:'minutes'}}]} as unknown as MeetingProject)).toBe('minutes');
 expect(memoEntryScreen({...p,minutesRevisions:[{}]} as unknown as MeetingProject)).toBe('minutes');
});
it('describes the actual configured language mapping rather than a possible hint',()=>{
 const model=createModelPreset('openai-gpt-transcribe');expect(registeredLanguageHint(model,['ko','en'],'ko')).toBe('ko, en · 복수 언어 힌트');
 expect(registeredLanguageHint(createModelPreset('scribe-v2'),['ko','en'],'ko')).toBe('전송 안 함');
 expect(languageHintSummary('single',['ko','en'],'en')).toContain('edit input');
 expect(languageHintSummary('single',['ko'],'en')).toBe('ko · Single-language hint');
 expect(languageHintSummary(undefined,['ko'],'en')).toBe('Choose a transcription model');
});
