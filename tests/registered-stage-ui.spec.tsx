// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import Settings from '../src/react-app/ui/screens/Settings';
import STT from '../src/react-app/ui/screens/STT';
import Import from '../src/react-app/ui/screens/Import';
import {previewRegisteredMinutesSelection} from '../src/react-app/minutes/selection';
import Minutes from '../src/react-app/ui/screens/Minutes';
import Review from '../src/react-app/ui/screens/Review';
import {createModelPreset} from '../src/react-app/providers/model-profiles';
import {buildRegistrationRequest} from '../src/react-app/providers/model-registrations';
import type {AppController} from '../src/react-app/App';
import type {MeetingProject} from '../src/react-app/domain/types';
vi.mock('../src/react-app/media/prepare',()=>({planChunkRanges:(durationMs:number)=>[{sourceStartMs:0,sourceEndMs:durationMs}]}));
afterEach(cleanup);
const stt={...createModelPreset('compatible-stt'),id:'registered-stt',enabled:true};
const text={...createModelPreset('compatible-text'),id:'registered-text',enabled:true};
const p={id:'test',title:'fixture',sourceAssets:[{id:'source',durationMs:1000}],audioOptions:{chunkMinutes:10,overlapSeconds:10,expectedLanguages:['ko'],sampleRateHz:16000,bitrateKbps:32},preparedChunks:[{id:'chunk',sourceId:'source',index:0,sourceStartMs:0,sourceEndMs:1000,encodedBytes:123,codec:'mp3',audioRecordId:'audio'}],retainedAudio:{sourceIds:['source'],chunkIds:['chunk']},rawTranscripts:[],transcriptVersions:[],selectedTranscriptVersionId:null,minutesSettings:{registrationId:text.id,modelId:text.modelId,sections:['summary'],instructions:'',outputLanguage:'en'},minutesRuns:[],minutesRevisions:[],runs:[]} as unknown as MeetingProject;
function controller(extra:Partial<AppController>={}):AppController{return {session:'unlocked',preferences:{uiLanguage:'en',keyStorage:'encrypted'},settingsTab:'connections',modelRegistrations:{version:2,entries:[stt,text]},modelCatalog:[{id:stt.id,label:`${stt.name} · ${stt.modelId}`,modelId:stt.modelId,provider:'openai-compatible',kind:'stt',enabled:true},{id:text.id,label:text.name,modelId:text.modelId,provider:'openai-compatible',kind:'minutes',enabled:true}],connections:[],sttModelId:stt.id,sttConsentToken:'fixture',chunkStates:[],...extra} as unknown as AppController;}
it('routes legacy connections tabs to one model manager without provider key panels',()=>{
 render(<Settings controller={controller()}/>);expect(screen.queryByRole('tab',{name:'Connections'})).toBeNull();expect(screen.getByRole('tab',{name:'Models'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('button',{name:'New model'})).toBeTruthy();expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
});
it('shows custom STT endpoint/model and enables a confirmed ready recording',()=>{
 const c=controller({onStartSTT:vi.fn()});render(<STT controller={c} project={p}/>);
 expect(screen.getByRole('option',{name:stt.name})).toBeTruthy();
 expect(screen.queryByText(/Unknown creator|Preflight total|Processor/)).toBeNull();
 expect(screen.queryByText('Details',{selector:'summary'})).toBeNull();
 expect(screen.getByText('http://localhost:8000').closest('dd')?.textContent).toBe('http://localhost:8000/v1/audio/transcriptions');
 expect(screen.getAllByText('whisper-local').some(element=>!element.closest('details'))).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:"I've reviewed the above"}));expect((screen.getByRole('button',{name:'Transcribe'}) as HTMLButtonElement).disabled).toBe(false);
});
it('hides STT models without an API key and preserves the saved selection as setup required',()=>{
 const missing={...createModelPreset('openai-gpt-transcribe'),id:'missing-key',name:'Unconfigured API model',enabled:true};
 const c=controller({modelRegistrations:{version:2,entries:[missing,stt]},registrationKeyReady:[],sttModelId:missing.id,onSTTModel:vi.fn(),onStartSTT:vi.fn(),modelCatalog:[{id:missing.id,label:missing.name,provider:'openai',kind:'stt',enabled:true},{id:stt.id,label:stt.name,provider:'openai-compatible',kind:'stt',enabled:true}]});
 render(<STT controller={c} project={p}/>);
 const select=screen.getByRole('combobox',{name:'Transcription model'}) as HTMLSelectElement;
 expect(select.value).toBe(missing.id);
 expect(screen.queryByRole('option',{name:missing.name})).toBeNull();
 expect((within(select).getByRole('option',{name:'API setup required · choose a model'}) as HTMLOptionElement).disabled).toBe(true);
 expect((within(select).getByRole('option',{name:stt.name}) as HTMLOptionElement).disabled).toBe(false);
 fireEvent.click(screen.getByRole('checkbox',{name:"I've reviewed the above"}));
 expect((screen.getByRole('button',{name:'Transcribe'}) as HTMLButtonElement).disabled).toBe(true);
 expect(c.onSTTModel).not.toHaveBeenCalled();expect(c.onStartSTT).not.toHaveBeenCalled();
});
it('maps edited GPT Transcribe inputs into language, keyword and context request fields without sending audio',()=>{
 const model={...createModelPreset('openai-gpt-transcribe'),enabled:true},save=vi.fn(),start=vi.fn();
 render(<STT controller={controller({modelRegistrations:{version:2,entries:[model]},registrationKeyReady:[model.id],sttModelId:model.id,modelCatalog:[{id:model.id,label:model.name,provider:'openai',kind:'stt',enabled:true}],onAudioOptions:save,onStartSTT:start})} project={p}/>);
 const before=screen.getByRole('region',{name:'Before sending'});
 fireEvent.click(within(before).getByRole('button',{name:'Edit transcription input'}));
 fireEvent.change(screen.getByLabelText('Spoken languages · comma-separated'),{target:{value:'ko, en'}});
 fireEvent.change(screen.getByLabelText('Vocabulary · one per line'),{target:{value:'MoM\nAC-42'}});
 fireEvent.change(screen.getByLabelText('Context'),{target:{value:'Synthetic customer support call'}});
 fireEvent.click(screen.getByRole('button',{name:'Apply input settings'}));
 const options=save.mock.calls[0][1];
 const body=buildRegistrationRequest(model,{stage:'stt',file:new File(['synthetic'],'synthetic.mp3',{type:'audio/mpeg'}),languages:options.expectedLanguages,glossary:options.transcriptionHints.terms,context:options.transcriptionHints.context}).body as FormData;
 expect(body.getAll('languages[]')).toEqual(['ko','en']);expect(body.getAll('keywords[]')).toEqual(['MoM','AC-42']);expect(body.get('prompt')).toBe('Synthetic customer support call');
 expect(start).not.toHaveBeenCalled();
});
it('rejects provider-invalid GPT keywords and language codes before applying or sending',()=>{
 const model={...createModelPreset('openai-gpt-transcribe'),enabled:true},save=vi.fn(),start=vi.fn();
 render(<STT controller={controller({modelRegistrations:{version:2,entries:[model]},registrationKeyReady:[model.id],sttModelId:model.id,modelCatalog:[{id:model.id,label:model.name,provider:'openai',kind:'stt',enabled:true}],onAudioOptions:save,onStartSTT:start})} project={p}/>);
 fireEvent.click(screen.getByRole('button',{name:'Edit transcription input'}));
 fireEvent.change(screen.getByLabelText('Vocabulary · one per line'),{target:{value:'<forbidden>'}});
 const apply=screen.getByRole('button',{name:'Apply input settings'}) as HTMLButtonElement;
 expect(apply.disabled).toBe(true);expect(screen.getByText('Vocabulary: < and > are not allowed.')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Vocabulary · one per line'),{target:{value:'MoM'}});
 fireEvent.change(screen.getByLabelText('Spoken languages · comma-separated'),{target:{value:'en-US'}});expect(apply.disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Spoken languages · comma-separated'),{target:{value:'en, zh-cn'}});expect(apply.disabled).toBe(false);
 fireEvent.click(apply);expect(save.mock.calls[0][1].expectedLanguages).toEqual(['en','zh-cn']);expect(start).not.toHaveBeenCalled();
});
it('distinguishes custom STT endpoint aliases without showing registration IDs',()=>{
 const other={...stt,id:'other-registration',endpointUrl:'http://localhost:9000/v1/audio/transcriptions'};
 const c=controller({modelRegistrations:{version:2,entries:[stt,other]},modelCatalog:[stt,other].map(model=>({id:model.id,label:model.name,provider:'openai-compatible',kind:'stt',enabled:true}))});
 render(<STT controller={c} project={p}/>);
 expect(screen.getByRole('option',{name:`${stt.name} · whisper-local (localhost:8000)`})).toBeTruthy();
 expect(screen.getByRole('option',{name:`${stt.name} · whisper-local (localhost:9000)`})).toBeTruthy();
 expect(screen.queryByRole('option',{name:/registered-stt|other-registration|Unknown creator/})).toBeNull();
});
it('applies memo-only transcription input and requires fresh confirmation after editing',()=>{
 const model={...stt,stt:{...stt.stt!,termMode:'prompt' as const}},save=vi.fn(),start=vi.fn();
 const c=controller({modelRegistrations:{version:2,entries:[model,text]},onAudioOptions:save,onStartSTT:start});
 const view=render(<STT controller={c} project={p}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:"I've reviewed the above"}));
 fireEvent.click(screen.getByRole('button',{name:'Edit transcription input'}));
 fireEvent.change(screen.getByLabelText('Vocabulary · one per line'),{target:{value:'SYNTHETIC_TERM\nMoM'}});
 fireEvent.change(screen.getByLabelText('Context'),{target:{value:'Synthetic meeting context'}});
 expect((screen.getByRole('button',{name:'Transcribe'}) as HTMLButtonElement).disabled).toBe(true);
 expect((screen.getByRole('checkbox',{name:"I've reviewed the above"}) as HTMLInputElement).checked).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Apply input settings'}));
 const options=save.mock.calls[0][1];expect(options.transcriptionHints).toEqual({terms:['SYNTHETIC_TERM','MoM'],context:'Synthetic meeting context'});
 expect(c.modelRegistrations!.entries[0]).toEqual(model);expect(start).not.toHaveBeenCalled();
 view.rerender(<STT controller={c} project={{...p,audioOptions:options}}/>);
 expect((screen.getByRole('button',{name:'Transcribe'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:"I've reviewed the above"}));expect((screen.getByRole('button',{name:'Transcribe'}) as HTMLButtonElement).disabled).toBe(false);
});
it('uses registered Notes identity and direct endpoint disclosure instead of catalog IDs',()=>{
 render(<Minutes controller={controller({minutesRouteKey:text.id,minutesRoutes:[{key:text.id,label:'Compatible text · localhost:8000',modelId:text.modelId,endpointTag:text.endpointUrl!,enabled:true}]})} project={p}/>);
 expect(screen.getAllByText(/http:\/\/localhost:8000\/v1\/chat\/completions/).length).toBeGreaterThan(0);
});
it('shows server-provided speakers and frozen model provenance',()=>{
 const batch={id:'batch',modelId:stt.modelId,modelSnapshot:stt,languages:['ko'],attemptRunIds:[],chunkIds:['chunk'],createdAt:'2026-10-17',sourceId:'source'};
 const version={id:'version',parentId:null,batchId:'batch',rawIds:[],segments:[{id:'segment',text:'fixture speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[],speaker:'server-speaker'}],issues:[],missingRanges:[]};
 render(<Review controller={controller()} project={{...p,sttBatches:[batch],transcriptVersions:[version],selectedTranscriptVersionId:'version'} as unknown as MeetingProject}/>);
 expect(screen.getByText(/Speaker.*server-speaker/)).toBeTruthy();expect(within(screen.getByLabelText('Transcript version')).getByText(/localhost:8000/)).toBeTruthy();
});

it('preserves memo hints when resetting only audio preparation defaults',()=>{
 const hints={terms:['SYNTHETIC_KEEP'],context:'Keep context'},save=vi.fn(),plan=vi.fn();
 render(<Import controller={controller({onAudioOptions:save,onPlanPreparationReset:plan,defaultAudioOptions:{...p.audioOptions,chunkMinutes:15,expectedLanguages:['en']}})} project={{...p,audioOptions:{...p.audioOptions,transcriptionHints:hints}}}/>);
 fireEvent.click(screen.getByText('Expand processing settings'));
 fireEvent.click(screen.getByRole('button',{name:'Reset to defaults'}));
 expect(save).not.toHaveBeenCalled();expect(plan).not.toHaveBeenCalled();
 expect(within(screen.getByRole('group',{name:'Chunk length'})).getByRole('button',{name:'15 min'}).getAttribute('aria-pressed')).toBe('true');
 fireEvent.click(screen.getByRole('button',{name:'Apply changes'}));
 expect(plan).toHaveBeenCalledWith(p.id,{...p.audioOptions,chunkMinutes:15,transcriptionHints:hints});expect(save).not.toHaveBeenCalled();
});
it('omits unavailable model facts and keeps the frozen generated model name after switching models',()=>{
 const old={...text,name:'SYNTHETIC_FROZEN_ALIAS'},usage={inputTokens:null,outputTokens:null,durationSeconds:null,audioInputTokens:null,textInputTokens:null,audioOutputTokens:null,textOutputTokens:null,elapsedMs:1,cost:null,costKind:'unavailable' as const,currency:null,rateSource:null,rateCheckedAt:null,rateSnapshot:null};
 const run={id:'saved',transcriptVersionId:'speech',settings:p.minutesSettings,generatedMarkdown:'# Synthetic saved notes',usage,requestedModel:old.modelId,returnedModel:null,actualProvider:null,modelSnapshot:old};
 const selected={...p,minutesRuns:[run],minutesRevisions:[{id:'revision',runId:run.id,parentId:null,markdown:run.generatedMarkdown}],selectedMinutesRevisionId:'revision'};
 const preview=previewRegisteredMinutesSelection(text,null,p.minutesSettings);
 render(<Minutes controller={controller({minutesSelection:preview})} project={selected}/>);
 const detail=screen.getByText('Model and pricing details').closest('details')!;expect(detail.open).toBe(false);fireEvent.click(screen.getByText('Model and pricing details'));
 const facts=screen.getByRole('region',{name:'Model details'});
 expect(facts.closest('details')?.open).toBe(true); expect(within(facts).queryByText(/Unknown|Unavailable|creator|Duration|Input · USD/)).toBeNull();
 expect(within(screen.getByText('Notes result').closest('.minutes-results')!).getByText('SYNTHETIC_FROZEN_ALIAS')).toBeTruthy();
 expect(screen.getByText('Model and pricing details')).toBeTruthy();
});
it('keeps output budget edits local until Apply, blocks invalid limits and clears prior consent',()=>{
 const version={id:'speech',parentId:null,rawIds:[],segments:[{id:'s',text:'Synthetic speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[]}],issues:[],missingRanges:[]};
 const model={...text,llm:{tokenField:'max_tokens' as const,contextTokens:8192,maxTokens:4096}},save=vi.fn(),project={...p,transcriptVersions:[version],selectedTranscriptVersionId:version.id};
 const c=controller({modelRegistrations:{version:2,entries:[model]},minutesConsentToken:'budget-consent',minutesSelection:previewRegisteredMinutesSelection(model,version,p.minutesSettings),onMinutesSettings:save,onGenerateMinutes:vi.fn()});
 const view=render(<Minutes controller={c} project={project}/>),ack=screen.getByRole('checkbox',{name:'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.'});
 fireEvent.click(ack);expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(false);
 fireEvent.change(screen.getByRole('combobox',{name:'Notes length'}),{target:{value:'__custom'}});
 const input=screen.getByLabelText('Custom maximum · tokens');fireEvent.change(input,{target:{value:'4097'}});expect((screen.getByRole('button',{name:'Apply length'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(input,{target:{value:'1024'}});expect(save).not.toHaveBeenCalled();expect((ack as HTMLInputElement).checked).toBe(false);expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Apply length'}));expect(save).toHaveBeenCalledWith(p.id,{...p.minutesSettings,outputTokens:1024});
 view.rerender(<Minutes controller={c} project={{...project,minutesSettings:save.mock.calls[0][1]}}/>);expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(true);expect((input as HTMLInputElement).value).toBe('1024');
});
it('starts at 4K and enables 8K and 16K for a supported preset without saving a new budget',()=>{
 const model=createModelPreset('openai-text'),save=vi.fn(),project={...p,minutesSettings:{...p.minutesSettings,registrationId:model.id,modelId:model.modelId}};
 render(<Minutes controller={controller({modelRegistrations:{version:2,entries:[model]},minutesSelection:previewRegisteredMinutesSelection(model,null,project.minutesSettings),onMinutesSettings:save})} project={project}/>);
 const select=screen.getByRole('combobox',{name:'Notes length'}) as HTMLSelectElement;
 expect(select.value).toBe('4096');
 for(const name of ['4K · Short','8K · Detailed','16K · Long'])expect((within(select).getByRole('option',{name}) as HTMLOptionElement).disabled).toBe(false);
 expect(save).not.toHaveBeenCalled();
});
it('does not restore an old pending preset when a saved budget is selected again',()=>{
 const model={...text,llm:{tokenField:'max_tokens' as const,contextTokens:64000,maxTokens:16384}},save=vi.fn(),drafts:Record<string,unknown>={};
 let project={...p,minutesSettings:{...p.minutesSettings,outputTokens:4096}};
 const c=controller({modelRegistrations:{version:2,entries:[model]},uiDrafts:drafts,onUIDraft:(key,value)=>{drafts[key]=value;},onMinutesSettings:save});
 const renderView=()=> <Minutes controller={{...c,minutesSelection:previewRegisteredMinutesSelection(model,null,project.minutesSettings)}} project={project}/>;
 const view=render(renderView()),select=screen.getByRole('combobox',{name:'Notes length'}) as HTMLSelectElement;
 const saved=()=>{project={...project,minutesSettings:save.mock.calls.at(-1)![1]};view.rerender(renderView());};
 for(const value of ['8192','16384']){fireEvent.change(select,{target:{value}});saved();expect(select.value).toBe(value);}
 fireEvent.change(select,{target:{value:'__custom'}});fireEvent.change(screen.getByLabelText('Custom maximum · tokens'),{target:{value:'8192'}});
 fireEvent.click(screen.getByRole('button',{name:'Apply length'}));saved();expect(select.value).toBe('8192');
});
it('offers readable length presets, preserves custom entry and explains unsupported model lengths',()=>{
 const model={...text,llm:{tokenField:'max_tokens' as const,contextTokens:32000,maxTokens:8192}},save=vi.fn(),project={...p,minutesSettings:{...p.minutesSettings,outputTokens:4096}};
 render(<Minutes controller={controller({modelRegistrations:{version:2,entries:[model]},minutesSelection:previewRegisteredMinutesSelection(model,null,project.minutesSettings),onMinutesSettings:save})} project={project}/>);
 const select=screen.getByRole('combobox',{name:'Notes length'});
 expect((within(select).getByRole('option',{name:'16K · Long'}) as HTMLOptionElement).disabled).toBe(true);
 fireEvent.change(select,{target:{value:'8192'}});expect(save).toHaveBeenLastCalledWith(p.id,{...project.minutesSettings,outputTokens:8192});expect(model.llm.maxTokens).toBe(8192);
 fireEvent.change(select,{target:{value:'__custom'}});expect(screen.getByLabelText('Custom maximum · tokens')).toBeTruthy();
 expect(screen.getByText(/The number sets a maximum/)).toBeTruthy();
});
it('supports instructions-only notes and shows the missing condition beside the disabled generation button',()=>{
 const model={...text,llm:{tokenField:'max_tokens' as const,contextTokens:32000,maxTokens:8192}},save=vi.fn(),generate=vi.fn();
 const version={id:'speech',parentId:null,rawIds:[],segments:[{id:'s',text:'Synthetic speech',sourceStartMs:0,sourceEndMs:1000,rawIds:[]}],issues:[],missingRanges:[]};
 let project={...p,transcriptVersions:[version],selectedTranscriptVersionId:version.id};
 const c=controller({modelRegistrations:{version:2,entries:[model]},minutesConsentToken:'instruction-token',minutesSelection:previewRegisteredMinutesSelection(model,version,p.minutesSettings),onMinutesSettings:save,onGenerateMinutes:generate});
 const view=render(<Minutes controller={c} project={project}/>);
 expect(screen.getByRole('status',{name:'Generation readiness'}).textContent).toBe('Review transcript transmission to enable generation.');
 fireEvent.click(screen.getByRole('button',{name:'Use instructions only'}));expect(save.mock.calls[0][1].sections).toEqual([]);
 project={...project,minutesSettings:save.mock.calls[0][1]};view.rerender(<Minutes controller={{...c,minutesSelection:previewRegisteredMinutesSelection(model,version,project.minutesSettings)}} project={project}/>);
 expect(screen.getByRole('status',{name:'Generation readiness'}).textContent).toBe('Enter extra instructions or select at least one section.');
 expect(screen.getAllByRole('checkbox').filter(input=>(input as HTMLInputElement).checked)).toHaveLength(0);
 const instructions=screen.getByRole('textbox',{name:'Extra instructions'});fireEvent.change(instructions,{target:{value:'Write one short paragraph.'}});
 project={...project,minutesSettings:save.mock.calls[1][1]};view.rerender(<Minutes controller={{...c,minutesConsentToken:'updated-instruction-token',minutesSelection:previewRegisteredMinutesSelection(model,version,project.minutesSettings)}} project={project}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'I understand that the selected transcript and settings will be sent, and charges may apply. Audio will not be sent again.'}));
 const button=screen.getByRole('button',{name:'Generate notes'});expect((button as HTMLButtonElement).disabled).toBe(false);fireEvent.click(button);expect(generate).toHaveBeenCalledOnce();
 expect(screen.queryByText('Uses the selected transcript. Audio is not sent again.')).toBeNull();
});
it('shows saved Groq context and refreshes the editor when the saved model settings change',()=>{
 const model={...createModelPreset('router-whisper-large-v3'),enabled:true,auth:'none' as const,requestParameters:{provider:{options:{groq:{prompt:'SYNTHETIC SAVED CONTEXT'}}}}};
 const makeController=(entry:typeof model)=>controller({modelRegistrations:{version:2,entries:[entry]},sttModelId:entry.id,modelCatalog:[{id:entry.id,label:entry.name,provider:'openrouter',kind:'stt',enabled:true}],onAudioOptions:vi.fn(),onStartSTT:vi.fn()});
 const view=render(<STT controller={makeController(model)} project={p}/>);
 expect(screen.getByText('SYNTHETIC SAVED CONTEXT')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Edit transcription input'}));
 expect((screen.getByLabelText('Context') as HTMLTextAreaElement).value).toBe('SYNTHETIC SAVED CONTEXT');
 fireEvent.change(screen.getByLabelText('Context'),{target:{value:'UNSAVED DRAFT'}});
 const changed={...model,requestParameters:{provider:{options:{groq:{prompt:'UPDATED SAVED CONTEXT'}}}}};
 view.rerender(<STT controller={makeController(changed)} project={p}/>);
 expect((screen.getByLabelText('Context') as HTMLTextAreaElement).value).toBe('UPDATED SAVED CONTEXT');
 expect(screen.getByText('UPDATED SAVED CONTEXT',{selector:'dd'})).toBeTruthy();
});
