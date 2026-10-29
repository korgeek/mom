// @vitest-environment jsdom
import { afterEach, beforeAll, it, expect, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ModelRegistrations from '../src/react-app/ui/components/ModelRegistrations';
import { createModelPreset, exportModelProfiles } from '../src/react-app/providers/model-profiles';
import { registrationSignature, type RegistrationTestResult } from '../src/react-app/providers/model-registrations';
import type { AppController } from '../src/react-app/App';
afterEach(cleanup);
beforeAll(()=>{HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};});
function controller(): AppController { return { session:'unlocked',preferences:{uiLanguage:'ko',keyStorage:'encrypted'},modelRegistrations:{version:2,entries:[],defaults:{stt:null,llm:null}},registrationKeyReady:[],onSaveRegistration:vi.fn(async()=>{}),onImportRegistrations:vi.fn(async()=>{}),onSetRegistrationDefault:vi.fn(async()=>{}),onTestRegistration:vi.fn(async()=>{}) } as unknown as AppController; }
it('updates only the old preset output ceiling on explicit request while retaining custom settings and the shared key',()=>{
 const c=controller(),preset=createModelPreset('openai-text'),entry={...preset,name:'Custom Luna',enabled:true,credentialId:'shared',instructionTemplate:'Use {{output_language}}',requestParameters:{reasoning_effort:'none'},llm:{...preset.llm,maxTokens:4096,temperature:0.5}};
 c.modelRegistrations={version:2,entries:[entry],credentials:[{id:'shared',name:'Shared key',origin:'https://api.openai.com',keyStorage:'encrypted',version:1}]};
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));
 expect((screen.getByLabelText('모델 최대 출력 토큰') as HTMLInputElement).value).toBe('4096');
 expect(c.onSaveRegistration).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'예시 모델 출력 한도 적용'}));
 expect((screen.getByLabelText('모델 최대 출력 토큰') as HTMLInputElement).value).toBe('128000');
 fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({name:entry.name,enabled:true,credentialId:'shared',instructionTemplate:entry.instructionTemplate,llm:{...entry.llm,maxTokens:128000}}),{action:'keep'});
});
it('shows one unified list, filters by stage, and opens editing separately from testing',async()=>{
 const c=controller(),stt={...createModelPreset('openai-gpt-transcribe'),name:'Synthetic STT'},llm={...createModelPreset('openai-text'),name:'Synthetic LLM'};
 c.modelRegistrations={version:2,entries:[stt,llm]};render(<ModelRegistrations controller={c}/>);
 expect(screen.getByText(stt.name)).toBeTruthy();expect(screen.getByText(llm.name)).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'LLM'}));expect(screen.queryByText(stt.name)).toBeNull();expect(screen.getByText(llm.name)).toBeTruthy();
 fireEvent.click(screen.getByRole('tab',{name:'전체'}));fireEvent.click(within(screen.getByText(stt.name).closest('.registration-row')!).getByRole('button',{name:'수정'}));
 const dialog=screen.getByRole('dialog',{name:'모델 수정'});expect(within(dialog).getByLabelText('이름')).toBeTruthy();expect(within(dialog).queryByLabelText('테스트 전사문')).toBeNull();expect(within(dialog).queryByRole('button',{name:'테스트 호출'})).toBeNull();
 fireEvent.click(within(dialog).getByRole('button',{name:'닫기'}));expect(screen.queryByRole('dialog')).toBeNull();
});
it('opens model testing separately with an editable example and confirms deletion explicitly',async()=>{
 const c=controller(),entry=createModelPreset('compatible-text');c.modelRegistrations={version:2,entries:[entry]};c.onDeleteRegistration=vi.fn(async()=>{});
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'테스트'}));
 const dialog=screen.getByRole('dialog',{name:'LLM 테스트'});expect(within(dialog).getByLabelText('테스트 전사문')).toBeTruthy();expect(within(dialog).queryByLabelText('이름')).toBeNull();expect(c.onTestRegistration).not.toHaveBeenCalled();
 fireEvent.click(within(dialog).getByRole('button',{name:'닫기'}));fireEvent.click(screen.getByRole('button',{name:'삭제'}));
 expect(c.onDeleteRegistration).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'취소'}));expect(screen.queryByRole('alertdialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'삭제'}));fireEvent.click(screen.getByRole('button',{name:'모델 삭제'}));expect(c.onDeleteRegistration).toHaveBeenCalledWith(entry.id);
});
it('saves a model draft without requiring or creating a key',async()=>{
 const user=userEvent.setup(),c=controller();render(<ModelRegistrations controller={c}/>);
 await user.click(screen.getByRole('button',{name:'새 모델'}));
 expect(screen.queryByLabelText('새 API 키')).toBeNull();expect(screen.queryByRole('option',{name:'새 키 추가'})).toBeNull();
 await user.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({enabled:false,endpointUrl:'https://api.openai.com/v1/audio/transcriptions'}),{action:'keep'});
 expect(vi.mocked(c.onSaveRegistration!).mock.calls[0][0].credentialId).toBeUndefined();expect(c.onTestRegistration).not.toHaveBeenCalled();
});

it('keeps invalid JSON editable and removes drafts on lock',async()=>{
 const c=controller(),{rerender}=render(<ModelRegistrations controller={c}/>);
 fireEvent.click(screen.getByRole('tab',{name:'LLM'}));fireEvent.click(screen.getByRole('button',{name:'새 모델'}));
 fireEvent.click(screen.getByText('고급 설정'));
 fireEvent.change(screen.getByLabelText('매개변수 JSON'),{target:{value:'{oops'}});
 expect(screen.getByRole('alert').textContent).toContain('매개변수 JSON');
 expect((screen.getByLabelText('매개변수 JSON') as HTMLTextAreaElement).value).toBe('{oops');
 expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true);
 rerender(<ModelRegistrations controller={{...c,session:'locked'}}/>);expect(screen.queryByLabelText('매개변수 JSON')).toBeNull();
});
it('previews all keyless imports before an explicit save and sets stage defaults without testing',async()=>{
 const user=userEvent.setup(),c=controller(),entry=createModelPreset('openai-gpt-transcribe');
 c.modelRegistrations={version:2,entries:[{...entry,enabled:true}],defaults:{stt:null,llm:null}};c.registrationKeyReady=[entry.id];
 render(<ModelRegistrations controller={c}/>);
 await user.click(screen.getByRole('button',{name:'기본 모델 설정'}));
 fireEvent.change(screen.getByLabelText('STT 기본 모델'),{target:{value:entry.id}});
 expect(c.onSetRegistrationDefault).toHaveBeenCalledWith('stt',entry.id);
 await waitFor(()=>expect((screen.getByRole('button',{name:'닫기'}) as HTMLButtonElement).disabled).toBe(false));await user.click(screen.getByRole('button',{name:'닫기'}));
 await user.click(screen.getByRole('button',{name:'JSON 가져오기'}));
 fireEvent.change(screen.getByLabelText('모델 JSON'),{target:{value:exportModelProfiles([entry])}});
 await user.click(screen.getByRole('button',{name:'미리보기'}));
 expect(c.onImportRegistrations).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'가져오기'}));
 await waitFor(()=>expect(c.onImportRegistrations).toHaveBeenCalledWith([expect.objectContaining({enabled:false,credentialOrigin:null,credentialVersion:0})]));
 expect(c.onTestRegistration).not.toHaveBeenCalled();
});
it('retains explicit bounded tests and save-only result retries',async()=>{
 const c=controller(),entry=createModelPreset('compatible-text');
 c.modelRegistrations={version:2,entries:[entry]};
 c.registrationTest={id:entry.id,running:true,saving:false,saved:false,result:{state:'success',signature:'old',text:'fixture result',raw:'{}',inputSummary:'fixture',requestedModel:'local-model',returnedModel:null,usage:null,status:200,elapsedMs:1,inputSignature:'old',message:''}};
 c.onCancelRegistrationTest=vi.fn();c.onRetryRegistrationResult=vi.fn(async()=>{});
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'테스트'}));
 fireEvent.click(screen.getByRole('button',{name:'호출 취소'}));expect(c.onCancelRegistrationTest).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole('button',{name:'결과 저장 다시 시도'}));expect(c.onRetryRegistrationResult).toHaveBeenCalledOnce();expect(c.onTestRegistration).not.toHaveBeenCalled();
});

it('exports public options without credential references or tests',async()=>{
 const c=controller(),entry={...createModelPreset('mai-transcribe-2'),credentialId:'shared'};c.modelRegistrations={version:2,entries:[entry],credentials:[{id:'shared',name:'SYNTHETIC_KEY_NAME',origin:'https://openrouter.ai',keyStorage:'encrypted',version:1}]};
 const blobs:Blob[]=[];const create=vi.spyOn(URL,'createObjectURL').mockImplementation(blob=>{blobs.push(blob as Blob);return 'blob:fixture';});const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'JSON 내보내기'}));
 const exported=await blobs[0].text();expect(exported).toContain('diarization');expect(exported).not.toContain('SYNTHETIC_KEY_NAME');expect(exported).not.toContain('credential');expect(exported).not.toContain('lastTest');expect(revoke).toHaveBeenCalledWith('blob:fixture');
 fireEvent.click(screen.getByRole('button',{name:'수정'}));fireEvent.click(within(screen.getByRole('dialog',{name:'모델 수정'})).getByRole('button',{name:`${entry.name} JSON 내보내기`}));
 expect(JSON.parse(await blobs[1].text()).models).toHaveLength(1);expect(await blobs[1].text()).not.toContain('credential');
 create.mockRestore();revoke.mockRestore();click.mockRestore();
});

it('keeps the model editor retryable after a failed save without exposing internal details',async()=>{
 const c=controller();c.onSaveRegistration=vi.fn(async()=>{throw new Error('SYNTHETIC_PRIVATE_ERROR');});render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'새 모델'}));fireEvent.change(screen.getByLabelText('이름'),{target:{value:'Retryable model'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('완료하지 못했어요'));
 expect((screen.getByLabelText('이름') as HTMLInputElement).value).toBe('Retryable model');expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_ERROR');
});

it('clears the selected key when the model server or authentication changes',()=>{
 const c=controller();c.modelRegistrations={version:2,entries:[],credentials:[{id:'shared',name:'Router key',origin:'https://openrouter.ai',keyStorage:'encrypted',version:1}]};
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'새 모델'}));
 fireEvent.change(screen.getByLabelText('API 종류'),{target:{value:'openrouter'}});fireEvent.change(screen.getByLabelText('API 키 선택'),{target:{value:'shared'}});fireEvent.change(screen.getByLabelText('API 종류'),{target:{value:'openai'}});
 expect((screen.getByLabelText('전체 엔드포인트 URL') as HTMLInputElement).value).toBe('https://api.openai.com/v1/audio/transcriptions');expect((screen.getByLabelText('API 키 선택') as HTMLSelectElement).value).toBe('');expect(screen.queryByRole('option',{name:/Router key/})).toBeNull();
 fireEvent.change(screen.getByLabelText('API 종류'),{target:{value:'openrouter'}});fireEvent.change(screen.getByLabelText('API 키 선택'),{target:{value:'shared'}});fireEvent.change(screen.getByLabelText('인증'),{target:{value:'none'}});fireEvent.change(screen.getByLabelText('인증'),{target:{value:'bearer'}});expect((screen.getByLabelText('API 키 선택') as HTMLSelectElement).value).toBe('');
});
it('filters presets by provider and stage and keeps OpenAI as the new default',()=>{
 const c=controller();render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'새 모델'}));
 const type=screen.getByLabelText('종류'),api=screen.getByLabelText('API 종류'),preset=screen.getByLabelText('프리셋'),name=screen.getByLabelText('이름');
 expect(type.compareDocumentPosition(api)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(api.compareDocumentPosition(preset)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect((api as HTMLSelectElement).value).toBe('openai');expect((preset as HTMLSelectElement).value).toBe('openai-gpt-transcribe');
 expect(within(preset).getByRole('option',{name:'OpenAI · GPT Transcribe'})).toBeTruthy();expect(within(preset).queryByRole('option',{name:'OpenRouter · Whisper Large V3'})).toBeNull();
 fireEvent.change(type,{target:{value:'llm'}});expect((api as HTMLSelectElement).value).toBe('openai');expect((preset as HTMLSelectElement).value).toBe('openai-gpt-6.1-terra');
 expect((screen.getByLabelText('기본 추론 강도') as HTMLSelectElement).value).toBe('low');
 expect(within(preset).getByRole('option',{name:'OpenAI · GPT-6 Luna'})).toBeTruthy();expect(within(preset).queryByRole('option',{name:'OpenRouter · GPT-6.1 Sol'})).toBeNull();
 fireEvent.change(api,{target:{value:'openrouter'}});fireEvent.change(type,{target:{value:'stt'}});
 expect(within(preset).getByRole('option',{name:'OpenRouter · Whisper Large V3'})).toBeTruthy();fireEvent.change(preset,{target:{value:'router-whisper-large-v3'}});
 expect((name as HTMLInputElement).value).toBe('Whisper Large V3');expect((screen.getByLabelText('모델 ID') as HTMLInputElement).value).toBe('openai/whisper-large-v3');
 expect((screen.getByLabelText('전체 엔드포인트 URL') as HTMLInputElement).value).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
});

it('binds one same-origin credential without rotating it and hides raw input for existing keys',()=>{
 const c=controller(),entry={...createModelPreset('mai-transcribe-2'),credentialId:'shared'};
 c.modelRegistrations={version:2,entries:[entry],credentials:[{id:'shared',name:'Shared router',origin:'https://openrouter.ai',keyStorage:'session',version:1},{id:'other',name:'Other server',origin:'https://api.openai.com',keyStorage:'encrypted',version:1}]};
 render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));
 expect((screen.getByLabelText('API 키 선택') as HTMLSelectElement).value).toBe('shared');expect(screen.queryByLabelText('새 API 키')).toBeNull();expect(screen.queryByRole('option',{name:/Other server/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({credentialId:'shared',keyStorage:'session'}),{action:'keep'});expect(c.onTestRegistration).not.toHaveBeenCalled();
});


it('adopts the saved shared binding and revision before an immediate explicit model test',async()=>{
 const c=controller(),key={id:'fresh-key',name:'Shared OpenAI',origin:'https://api.openai.com',keyStorage:'encrypted' as const,version:1};
 c.modelRegistrations={version:2,entries:[],credentials:[key]};c.credentialKeyReady=[key.id];
 const user=userEvent.setup(),view=render(<ModelRegistrations controller={c}/>);
 await user.click(screen.getByRole('tab',{name:'LLM'}));await user.click(screen.getByRole('button',{name:'새 모델'}));await user.selectOptions(screen.getByLabelText('프리셋'),'openai-text');await user.selectOptions(screen.getByLabelText('API 키 선택'),key.id);await user.click(screen.getByRole('button',{name:'저장'}));
 const sent=vi.mocked(c.onSaveRegistration!).mock.calls[0][0];
 const saved={...sent,credentialId:key.id,credentialVersion:1,credentialOrigin:key.origin,revision:1};
 view.rerender(<ModelRegistrations controller={{...c,modelRegistrations:{version:2,entries:[saved],credentials:[key]},credentialKeyReady:[key.id],registrationKeyReady:[saved.id]}}/>);
 expect(screen.queryByRole('dialog')).toBeNull();await user.click(screen.getByRole('button',{name:'테스트'}));
 expect(screen.queryByLabelText('새 API 키')).toBeNull();expect((screen.getByRole('button',{name:'테스트 호출'}) as HTMLButtonElement).disabled).toBe(false);
 expect(c.onTestRegistration).not.toHaveBeenCalled();await user.click(screen.getByRole('button',{name:'테스트 호출'}));
 expect(c.onTestRegistration).toHaveBeenCalledWith(expect.objectContaining({credentialId:key.id,revision:1,credentialVersion:1}),expect.objectContaining({stage:'llm'}),false);
});
it('shows incompatible saved STT settings and limits choices for known models',()=>{
 const c=controller(),entry={...createModelPreset('openai-gpt-transcribe'),stt:{...createModelPreset('openai-gpt-transcribe').stt,responseFormat:'verbose_json' as const,languageMode:'none' as const,termMode:'prompt' as const,timestamps:'word' as const}};
 c.modelRegistrations={version:2,entries:[entry]};render(<ModelRegistrations controller={c}/>);
 fireEvent.click(screen.getByRole('button',{name:'수정'}));
 expect(screen.getByRole('alert').textContent).toContain('맞지 않아');
 expect((screen.getByLabelText('프리셋') as HTMLSelectElement).value).toBe('');
 fireEvent.click(screen.getByText('고급 설정'));
 const format=screen.getByLabelText('응답 형식') as HTMLSelectElement, language=screen.getByLabelText('언어 힌트 필드') as HTMLSelectElement;
 expect((screen.getByLabelText('시간 정보') as HTMLSelectElement).disabled).toBe(true);
 expect(format.value).toBe('verbose_json');expect((within(format).getByRole('option',{name:'verbose_json'}) as HTMLOptionElement).disabled).toBe(true);
 expect((within(language).getByRole('option',{name:'language'}) as HTMLOptionElement).disabled).toBe(true);
 expect((within(language).getByRole('option',{name:'languages[]'}) as HTMLOptionElement).disabled).toBe(false);
 fireEvent.change(screen.getByLabelText('프리셋'),{target:{value:'openai-gpt-transcribe'}});
 expect(format.value).toBe('json'); expect((screen.getByLabelText('시간 정보') as HTMLSelectElement).value).toBe('none');
 expect((screen.getByLabelText('용어·맥락 필드') as HTMLSelectElement).value).toBe('prompt-and-keywords');
 expect(c.onSaveRegistration).not.toHaveBeenCalled(); expect(c.modelRegistrations.entries[0].stt?.responseFormat).toBe('verbose_json');
 fireEvent.change(screen.getByLabelText('모델 ID'),{target:{value:'whisper-1'}});
 expect((within(format).getByRole('option',{name:'verbose_json'}) as HTMLOptionElement).disabled).toBe(false);
 expect((within(language).getByRole('option',{name:'languages[]'}) as HTMLOptionElement).disabled).toBe(true);
});

it('marks models without keys as setup required and preserves a saved default',()=>{
 const c=controller(),missing={...createModelPreset('openai-gpt-transcribe'),enabled:true},local={...createModelPreset('compatible-stt'),enabled:true};
 c.modelRegistrations={version:2,entries:[missing,local],defaults:{stt:missing.id,llm:null}};
 render(<ModelRegistrations controller={c}/>);
 const row=screen.getByText(missing.name).closest<HTMLElement>('.registration-row')!;expect(within(row).getByText('설정 전')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'기본 모델 설정'}));
 const select=screen.getByLabelText('STT 기본 모델') as HTMLSelectElement;
 expect(select.value).toBe(missing.id);expect((within(select).getByRole('option',{name:`${missing.name} · 설정 전`}) as HTMLOptionElement).disabled).toBe(true);
 expect((within(select).getByRole('option',{name:local.name}) as HTMLOptionElement).disabled).toBe(false);expect(c.onSetRegistrationDefault).not.toHaveBeenCalled();
});

it('shows configuration and test status independently, including running and stale results',()=>{
 const c=controller(),base={...createModelPreset('openai-gpt-transcribe'),enabled:true},local={...createModelPreset('compatible-stt'),id:'local',name:'Local',enabled:false};
 const result:RegistrationTestResult={state:'success',signature:registrationSignature(base),text:'fixture',raw:'{}',inputSummary:'fixture',requestedModel:base.modelId,returnedModel:null,usage:null,status:200,elapsedMs:1,inputSignature:'fixture',message:''};
 c.modelRegistrations={version:2,entries:[{...base,lastTest:result},local]};
 const {rerender}=render(<ModelRegistrations controller={c}/>),row=()=>screen.getByText(base.name).closest<HTMLElement>('.registration-row')!;
 expect(within(row()).getByText('설정 전').classList.contains('model-status--setup')).toBe(true);
 expect(within(row()).getByText('테스트 · 성공').classList.contains('model-status--success')).toBe(true);
 expect(within(screen.getByText('Local').closest<HTMLElement>('.registration-row')!).getByText('테스트 전')).toBeTruthy();
 c.registrationKeyReady=[base.id];c.registrationTest={id:base.id,running:true,saving:false,saved:false,result:null};rerender(<ModelRegistrations controller={c}/>);
 expect(within(row()).getByText('활성').classList.contains('model-status--active')).toBe(true);expect(within(row()).getByText('테스트 중')).toBeTruthy();
 c.registrationTest={id:base.id,running:false,saving:false,saved:false,result:{...result,state:'failed'}};rerender(<ModelRegistrations controller={c}/>);expect(within(row()).getByText('테스트 · 실패 (저장 전)')).toBeTruthy();
 c.registrationTest=null;c.modelRegistrations={version:2,entries:[{...base,modelId:'changed',lastTest:result},local]};rerender(<ModelRegistrations controller={c}/>);
 expect(within(row()).getByText('이전 테스트 · 성공 (설정 변경)').classList.contains('model-status--neutral')).toBe(true);
 expect(within(row()).queryByText('테스트 · 성공')).toBeNull();
 for(const [state,label,tone] of [['failed','실패','failed'],['incomplete','미완료','setup'],['cancelled','취소','neutral'],['outcome-unknown','결과 불명','setup']] as const){
  c.modelRegistrations={version:2,entries:[{...base,lastTest:{...result,state}},local]};rerender(<ModelRegistrations controller={c}/>);
  expect(within(row()).getByText(`테스트 · ${label}`).classList.contains(`model-status--${tone}`)).toBe(true);
 }
});

it('saves reasoning effort, preserves JSON and blocks incompatible sampling without discarding it',()=>{
 const c=controller(),entry={...createModelPreset('openai-text'),requestParameters:{reasoning_effort:'none',seed:3},llm:{...createModelPreset('openai-text').llm,temperature:0.5}};
 c.modelRegistrations={version:2,entries:[entry]};render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));
 const effort=screen.getByLabelText('기본 추론 강도') as HTMLSelectElement;expect(effort.value).toBe('none');
 for(const value of ['', 'none','low','medium','high','xhigh','max'])expect(within(effort).getByRole('option',{name:value===''?/API.*medium/i:new RegExp(`^${value}$`,'i')})).toBeTruthy();
 fireEvent.click(screen.getByText('고급 설정'));const temperature=screen.getByLabelText(/temperature/i) as HTMLInputElement;
 fireEvent.change(effort,{target:{value:'high'}});expect(temperature.value).toBe('0.5');expect(temperature.disabled).toBe(true);expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true);
 expect(screen.getByRole('alert').textContent).toMatch(/temperature|top_p/i);
 fireEvent.change(effort,{target:{value:'none'}});expect(temperature.disabled).toBe(false);fireEvent.change(temperature,{target:{value:''}});fireEvent.change(effort,{target:{value:'high'}});
 const params=screen.getByLabelText('매개변수 JSON') as HTMLTextAreaElement;expect(JSON.parse(params.value)).toMatchObject({reasoning_effort:'high',seed:3});
 fireEvent.change(params,{target:{value:JSON.stringify({reasoning_effort:'low',seed:3})}});expect(effort.value).toBe('low');
 fireEvent.change(params,{target:{value:JSON.stringify({seed:3})}});expect(effort.value).toBe('');
 fireEvent.change(effort,{target:{value:'high'}});
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({requestParameters:{reasoning_effort:'high',seed:3}}),{action:'keep'});
});
it('saves explicit stream delivery for the new transcription model',()=>{
 const c=controller();render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'새 모델'}));
 fireEvent.click(screen.getByText('고급 설정'));const delivery=screen.getByLabelText('응답 받기') as HTMLSelectElement;
 expect(delivery.value).toBe('json');fireEvent.change(delivery,{target:{value:'stream'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({modelId:'gpt-transcribe',stt:expect.objectContaining({stream:true})}),{action:'keep'});
});

it('limits OpenRouter default reasoning choices and sampling controls to the selected model',()=>{
 const c=controller();render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('tab',{name:'LLM'}));fireEvent.click(screen.getByRole('button',{name:'새 모델'}));
 fireEvent.change(screen.getByLabelText('API 종류'),{target:{value:'openrouter'}});fireEvent.change(screen.getByLabelText('프리셋'),{target:{value:'router-glm-5.3-flash'}});
 const effort=screen.getByLabelText('기본 추론 강도') as HTMLSelectElement;
 expect(within(effort).queryByRole('option',{name:'none'})).toBeNull();expect(within(effort).queryByRole('option',{name:'medium'})).toBeNull();
 expect(within(effort).getByRole('option',{name:/API.*max/})).toBeTruthy();fireEvent.change(effort,{target:{value:'high'}});
 fireEvent.click(screen.getByText('고급 설정'));const json=screen.getByLabelText('매개변수 JSON') as HTMLTextAreaElement;
 expect(JSON.parse(json.value)).toMatchObject({reasoning:{effort:'high'}});
 fireEvent.change(screen.getByLabelText('top_k'),{target:{value:'12'}});expect(JSON.parse(json.value)).toMatchObject({top_k:12,reasoning:{effort:'high'}});
 fireEvent.change(screen.getByLabelText('프리셋'),{target:{value:'router-gpt-6.1-sol'}});
 expect((screen.getByLabelText('temperature') as HTMLInputElement).disabled).toBe(true);expect(screen.queryByLabelText('top_k')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'저장'}));expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({requestParameters:{reasoning:{effort:'low'}}}),{action:'keep'});
 expect(c.onTestRegistration).not.toHaveBeenCalled();
});

it('edits documented STT provider options without removing unrelated JSON and reports incompatible diarization',()=>{
 const c=controller(),entry={...createModelPreset('scribe-v2'),requestParameters:{provider:{options:{elevenlabs:{custom_option:'retained'},other:{custom:true}}}}};
 c.modelRegistrations={version:2,entries:[entry]};render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));fireEvent.click(screen.getByText('고급 설정'));
 fireEvent.change(screen.getByLabelText('화자 분리'),{target:{value:'true'}});fireEvent.change(screen.getByLabelText('화자 수'),{target:{value:'3'}});
 fireEvent.change(screen.getByLabelText('화자 분리 임계값'),{target:{value:'0.2'}});
 expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.getByRole('alert').textContent).toContain('provider.options.elevenlabs');
 fireEvent.change(screen.getByLabelText('화자 분리 임계값'),{target:{value:''}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({requestParameters:{provider:{options:{elevenlabs:{custom_option:'retained',diarize:true,num_speakers:3},other:{custom:true}}}}}),{action:'keep'});
});

it('offers Groq prompt injection only after explicit opt in and retains unrelated provider options',()=>{
 const c=controller(),entry={...createModelPreset('router-whisper-large-v3'),requestParameters:{provider:{options:{groq:{custom_option:true}}}}};
 c.modelRegistrations={version:2,entries:[entry]};render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));fireEvent.click(screen.getByText('고급 설정'));
 expect(screen.queryByLabelText('기본 전사 맥락')).toBeNull();fireEvent.click(screen.getByLabelText('용어·맥락 주입 사용'));
 fireEvent.change(screen.getByLabelText('기본 전사 맥락'),{target:{value:'Synthetic MoM vocabulary'}});fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({requestParameters:{provider:{options:{groq:{custom_option:true,prompt:'Synthetic MoM vocabulary'}}}}}),{action:'keep'});
});

it('retains unsupported saved sampling values until the user explicitly removes them',()=>{
 const c=controller(),preset=createModelPreset('router-gpt-6.1-sol'),entry={...preset,llm:{...preset.llm,temperature:0.5,topP:0.9}};
 c.modelRegistrations={version:2,entries:[entry]};render(<ModelRegistrations controller={c}/>);fireEvent.click(screen.getByRole('button',{name:'수정'}));fireEvent.click(screen.getByText('고급 설정'));
 expect((screen.getByLabelText('temperature') as HTMLInputElement).value).toBe('0.5');expect((screen.getByRole('button',{name:'저장'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'지원되지 않는 temperature 제거'}));fireEvent.click(screen.getByRole('button',{name:'지원되지 않는 top_p 제거'}));fireEvent.click(screen.getByRole('button',{name:'저장'}));
 expect(c.onSaveRegistration).toHaveBeenCalledWith(expect.objectContaining({requestParameters:preset.requestParameters,llm:preset.llm}),{action:'keep'});
 expect(entry.llm.temperature).toBe(0.5);expect(entry.llm.topP).toBe(0.9);
});
