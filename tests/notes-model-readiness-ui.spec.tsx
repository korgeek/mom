// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import Minutes from '../src/react-app/ui/screens/Minutes';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import type {AppController} from '../src/react-app/App';
import type {MeetingProject} from '../src/react-app/domain/types';
afterEach(cleanup);
const stt={...createModelPreset('compatible-stt'),id:'registered-stt',enabled:true};
const text={...createModelPreset('compatible-text'),id:'registered-text',enabled:true};
const p={id:'test',title:'fixture',sourceAssets:[{id:'source',durationMs:1000}],audioOptions:{chunkMinutes:10,overlapSeconds:10,expectedLanguages:['ko'],sampleRateHz:16000,bitrateKbps:32},preparedChunks:[{id:'chunk',sourceId:'source',index:0,sourceStartMs:0,sourceEndMs:1000,encodedBytes:123,codec:'mp3',audioRecordId:'audio'}],retainedAudio:{sourceIds:['source'],chunkIds:['chunk']},rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null,minutesSettings:{registrationId:text.id,modelId:text.modelId,sections:['summary'],instructions:'',outputLanguage:'en'},minutesRuns:[],minutesRevisions:[],runs:[]} as unknown as MeetingProject;
function controller(extra:Partial<AppController>={}):AppController{return {session:'unlocked',preferences:{uiLanguage:'en',keyStorage:'encrypted'},settingsTab:'connections',modelRegistrations:{version:2,entries:[stt,text]},modelCatalog:[{id:stt.id,label:`${stt.name} · ${stt.modelId}`,modelId:stt.modelId,provider:'openai-compatible',kind:'stt',enabled:true},{id:text.id,label:text.name,modelId:text.modelId,provider:'openai-compatible',kind:'minutes',enabled:true}],connections:[],sttModelId:stt.id,sttConsentToken:'fixture',chunkStates:[],...extra} as unknown as AppController;}

it('hides unconfigured notes models while retaining a selected route without switching',()=>{
 const missing={...createModelPreset('openai-text'),id:'missing',name:'Missing key',enabled:true},other={...missing,id:'other',name:'Other missing'},local={...text,name:'Local ready'};
 const route=(m:typeof missing)=>({key:m.id,label:m.name,modelId:m.modelId,endpointTag:m.endpointUrl!,enabled:m.id===local.id});
 const change=vi.fn(),c=controller({modelRegistrations:{version:2,entries:[missing,other,local]},registrationKeyReady:[],minutesRouteKey:missing.id,comparisonOpen:true,comparisonBRouteKey:other.id,minutesRoutes:[missing,other,local].map(route),onMinutesRoute:change,onComparisonBRoute:change});
 render(<Minutes controller={c} project={{...p,minutesSettings:{...p.minutesSettings,registrationId:missing.id,modelId:missing.modelId}}}/>);
 const select=screen.getByRole('combobox',{name:'Notes model'}) as HTMLSelectElement;
 expect(select.value).toBe(missing.id);expect((within(select).getByRole('option',{name:'API setup required · choose a model'}) as HTMLOptionElement).disabled).toBe(true);
 expect(within(select).queryByRole('option',{name:'Other missing'})).toBeNull();expect(within(select).getByRole('option',{name:'Local ready'})).toBeTruthy();
 const b=screen.getByRole('combobox',{name:'Member B model'}) as HTMLSelectElement;expect(b.value).toBe(other.id);expect((within(b).getByRole('option',{name:'API setup required · choose a model'}) as HTMLOptionElement).disabled).toBe(true);expect(within(b).queryByRole('option',{name:'Missing key'})).toBeNull();expect(within(b).getByRole('option',{name:'Local ready'})).toBeTruthy();expect(change).not.toHaveBeenCalled();
});
