import { useEffect, useId, useRef, useState } from 'react';
import type { AppController } from '../../App';
import { copy } from '../copy';
import SettingsDialog from './SettingsDialog';
import { CredentialForm } from './ApiKeys';
import { MODEL_PRESETS, createModelPreset, exportModelProfiles, importModelProfiles } from '../../providers/model-profiles';
import { openAIModelInfo, openAIReasoningIssue } from '../../providers/openai-models';
import { openRouterLLMInfo, openRouterLLMIssues } from '../../providers/openrouter-llm-options';
import { routerSTTOptions, routerSTTOptionIssue } from '../../providers/openrouter-stt-options';
import { asObject } from '../../domain/pipeline';
import { buildRegistrationRequest, registrationEndpoint, registrationInputSummary, registrationSignature, registrationReadiness, sttCapabilities, validateRegistration, validateRequestParameters, validateInstructionTemplate, withCredentialPolicy, type ApiCredential, type ModelRegistration, type RegistrationTestInput, type RegistrationTestResult } from '../../providers/model-registrations';
const list=(value:string)=>value.split(',').map(s=>s.trim()).filter(Boolean);
function downloadModels(entries:readonly ModelRegistration[]) {
    const url=URL.createObjectURL(new Blob([exportModelProfiles(entries)],{type:'application/json'}));
    try{const link=document.createElement('a');link.href=url;link.download='mom-models.json';link.click();}finally{URL.revokeObjectURL(url);}
}
export default function ModelRegistrations({controller:c}:{controller:AppController}) {
    const t=(ko:string,en:string)=>copy(c.preferences.uiLanguage,ko,en);
    const [stage,setStage]=useState<'all'|'stt'|'llm'>('all'),[selected,setSelected]=useState<ModelRegistration|null>(null),[mode,setMode]=useState<'edit'|'test'>('edit');
    const [deleting,setDeleting]=useState<ModelRegistration|null>(null),[panel,setPanel]=useState<'info'|'defaults'|null>(null);
    const [importing,setImporting]=useState(false),[json,setJson]=useState(''),[preview,setPreview]=useState<readonly ModelRegistration[]|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false);
    const id=useId(),importRevision=useRef(0);
    useEffect(()=>()=>{importRevision.current++;},[]);
    if(c.session!=='unlocked'){importRevision.current++;if(selected)setSelected(null);if(deleting)setDeleting(null);if(panel)setPanel(null);if(importing){setImporting(false);setJson('');setPreview(null);}return null;}
    const all=c.modelRegistrations?.entries??[],entries=all.filter(r=>stage==='all'||r.stage===stage),busy=!!c.busy||working;
    async function act(action:()=>Promise<void>,message:string){if(busy)return;setWorking(true);setError('');try{await action();setNotice(message);}catch{setError(t('저장하지 못했어요. 기존 값은 유지돼요. 설정과 브라우저 저장소를 확인하고 다시 시도하세요.','Could not save. Existing values are retained. Check settings and browser storage, then retry.'));}finally{setWorking(false);}}
    const missingKey=(r:ModelRegistration)=>r.auth==='bearer'&&!c.registrationKeyReady?.includes(r.id);
    const states={success:t('성공','Success'),failed:t('실패','Failed'),incomplete:t('미완료','Incomplete'),cancelled:t('취소','Cancelled'),'outcome-unknown':t('결과 불명','Outcome unknown')};
    return <section className="card model-registrations stack gap16" aria-label={t('모델 관리','Models')}>
      <div className="row-between wrap"><strong>{t('모델 관리','Models')}</strong><div className="actions wrap">
        <button disabled={busy} onClick={()=>{setImporting(true);setError('');}}>{t('JSON 가져오기','Import JSON')}</button>
        <button disabled={busy||!entries.length} onClick={()=>{try{downloadModels(entries);}catch{setError(t('내보내지 못했어요. 모델 설정을 확인하세요.','Could not export. Check model settings.'));}}}>{t('JSON 내보내기','Export JSON')}</button>
        <button type="button" className="primary" disabled={busy||!c.onSaveRegistration} onClick={()=>{setMode('edit');setSelected(createModelPreset(stage==='llm'?'openai-gpt-6.1-terra':'openai-gpt-transcribe'));}}>{t('새 모델','New model')}</button>
      </div></div>
      <div className="row-between wrap gap12">
        <div className="segmented align-start" role="tablist" aria-label={t('모델 종류','Model stage')} onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||busy)return;event.preventDefault();const filters=['all','stt','llm'] as const,index=filters.indexOf(stage),next=event.key==='Home'?'all':event.key==='End'?'llm':filters[(index+(event.key==='ArrowRight'?1:2))%3];setStage(next);document.getElementById(`${id}-${next}`)?.focus();}}>
          {(['all','stt','llm'] as const).map(value=><button key={value} id={`${id}-${value}`} role="tab" aria-controls={`${id}-panel`} aria-selected={stage===value} tabIndex={stage===value?0:-1} className={stage===value?'selected':''} disabled={busy} onClick={()=>setStage(value)}>{value==='all'?t('전체','All'):value.toUpperCase()}</button>)}
        </div>
        <button type="button" className="text-button" disabled={busy} onClick={()=>setPanel('defaults')}>{t('기본 모델 설정','Default models')}</button>
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${stage}`} className="stack gap12">
        <div className="registration-head" aria-hidden="true"><span>{t('모델','Model')}</span><span>{t('종류','Type')}</span><span>{t('상태','Status')}</span><span>{t('관리','Actions')}</span></div>
        <div role="list" aria-label={t('등록한 모델','Registered models')}>
          {entries.map(r=>{
            const test=c.registrationTest?.id===r.id?c.registrationTest:null;
            const running=!!test?.running, result=test?.result??r.lastTest;
            const stale=!!result&&result.signature!==registrationSignature(r);
            const testState=running?'running':result?.state;
            const testTone=stale&&!running?'neutral':testState==='success'?'success':testState==='failed'?'failed':testState==='running'?'running':testState==='incomplete'||testState==='outcome-unknown'?'setup':'neutral';
            return <div className="registration-row" role="listitem" key={r.id}>
            <div className="stack"><strong>{r.name}</strong><span className="hint registration-url">{r.modelId}</span><span className="hint">{new URL(registrationEndpoint(r)).host}{c.modelRegistrations?.defaults?.[r.stage]===r.id?` · ${r.stage.toUpperCase()} ${t('기본','default')}`:''}</span></div>
            <span className="model-stage">{r.stage.toUpperCase()}</span>
            <div className="model-statuses"><span className={`model-status model-status--${missingKey(r)?'setup':r.enabled?'active':'neutral'}`}>{missingKey(r)?t('설정 전','Setup required'):r.enabled?t('활성','Enabled'):t('비활성','Disabled')}</span>{missingKey(r)&&!r.enabled&&<span className="model-status model-status--neutral">{t('비활성','Disabled')}</span>}<span className={`model-status model-status--${testTone}`}>{running?t('테스트 중','Testing'):result?`${stale?t('이전 테스트','Previous test'):t('테스트','Test')} · ${states[result.state]}${stale?t(' (설정 변경)',' (settings changed)'):''}${test?.result&&!test.saved?t(' (저장 전)',' (not saved)'):''}`:t('테스트 전','Not tested')}</span></div>
            <div className="actions wrap"><button disabled={busy} onClick={()=>{setMode('test');setSelected(r);}}>{t('테스트','Test')}</button><button disabled={busy} onClick={()=>{setMode('edit');setSelected(r);}}>{t('수정','Edit')}</button><button className="text-danger" disabled={busy||!c.onDeleteRegistration} onClick={()=>{setDeleting(r);setError('');}}>{t('삭제','Delete')}</button></div>
          </div>})}
        </div>
        {!entries.length&&<span className="hint">{t('등록한 모델이 없어요.','No registered models.')}</span>}
        <span className="hint">{entries.length} {t('개 모델','models')}</span>
      </div>
      <div className="model-sharing-hint"><span><span aria-hidden="true">ⓘ </span>{t('저장은 암호화 · 실행할 때 선택한 서버로 직접 전송','Encrypted storage · sends directly to the selected server when run')}</span><button type="button" className="text-button" onClick={()=>setPanel('info')}>{t('전송·공유 안내','Transmission & sharing details')}</button></div>
      {selected&&<RegistrationForm key={`${selected.id}-${mode}`} initial={selected} mode={mode} controller={c} onClose={()=>setSelected(null)}/>}
      {deleting&&<SettingsDialog role="alertdialog" title={t('모델 삭제 확인','Confirm model deletion')} closeLabel={t('닫기','Close')} busy={busy} onClose={()=>setDeleting(null)}><strong>{deleting.name}</strong><p>{t('모델 등록만 삭제해요. 저장한 API 키와 기존 음성 메모·처리 결과는 유지돼요.','Only this model registration is deleted. Saved API keys, voice memos and existing results are retained.')}</p>{c.modelRegistrations?.defaults?.[deleting.stage]===deleting.id&&<p className="warning">{t('이 종류의 기본 모델 선택도 해제돼요. 다른 모델을 자동 선택하지 않아요.','This stage’s default is cleared. Another model is not selected automatically.')}</p>}<div className="actions"><button disabled={busy} onClick={()=>setDeleting(null)}>{t('취소','Cancel')}</button><button className="danger" disabled={busy||!c.onDeleteRegistration} onClick={()=>void act(async()=>{await c.onDeleteRegistration!(deleting.id);setDeleting(null);},t('모델을 삭제했어요.','Model deleted.'))}>{t('모델 삭제','Delete model')}</button></div>{error&&<span role="alert" className="error">{error}</span>}</SettingsDialog>}
      {panel&&<SettingsDialog title={panel==='info'?t('전송·공유 안내','Transmission & sharing details'):t('기본 모델 설정','Default models')} closeLabel={t('닫기','Close')} busy={busy} onClose={()=>setPanel(null)}>
        {panel==='info'?<><strong>{t('로컬 저장','Local storage')}</strong><p>{t('음성과 결과·설정·저장 키는 이 브라우저에 암호화 저장돼요.','Audio, results, settings and saved keys are encrypted in this browser.')}</p><strong>{t('제공사 전송','Provider transmission')}</strong><p>{t('전사는 음성을, 정리 노트는 선택 전사문과 지침을 선택한 서버로 직접 보내요. 로컬 암호화는 서버 로그·보관을 제어하지 않아요.','Transcription sends audio; notes sends the selected transcript and instructions directly to the selected server. Local encryption does not control server logs or retention.')}</p><strong>{t('내보내기와 공유','Exporting and sharing')}</strong><p>{t('복사·다운로드한 결과와 모델 JSON은 보관함 밖의 평문이에요. 모델 JSON에는 매개변수·작성 템플릿·용어가 포함돼요. API 키와 테스트 입력·응답은 제외돼요. 공유 전에 내용을 확인하세요.','Copied/downloaded results and model JSON are plaintext outside the vault. Model JSON includes parameters, instruction templates and terms. API keys and test inputs/responses are excluded. Review before sharing.')}</p></>:
          <>{(['stt','llm'] as const).map(value=><label key={value}>{value.toUpperCase()} {t('기본 모델','default model')}<select value={c.modelRegistrations?.defaults?.[value]??''} disabled={busy||!c.onSetRegistrationDefault} onChange={e=>void act(()=>c.onSetRegistrationDefault!(value,e.target.value||null),t('기본 모델을 저장했어요.','Default model saved.'))}><option value="">{t('선택 없음','None selected')}</option>{all.filter(r=>r.stage===value).map(r=><option key={r.id} value={r.id} disabled={!r.enabled||missingKey(r)}>{r.name}{missingKey(r)?t(' · 설정 전',' · setup required'):r.enabled?'':t(' · 비활성',' · disabled')}</option>)}</select></label>)}</>}
        {error&&<span role="alert" className="error">{error}</span>}
      </SettingsDialog>}
      {importing&&<SettingsDialog title={t('모델 가져오기','Import models')} closeLabel={t('닫기','Close')} busy={busy} onClose={()=>{importRevision.current++;setImporting(false);setJson('');setPreview(null);}}><section className="registration-form stack gap12" aria-label={t('모델 가져오기','Import models')}><label>{t('JSON 파일 (256 KiB 이하)','JSON file (up to 256 KiB)')}<input type="file" accept=".json,application/json" disabled={busy} onChange={async e=>{const file=e.target.files?.[0],revision=++importRevision.current;setPreview(null);setError('');if(!file)return;if(file.size>256*1024){setError(t('JSON 파일은 256 KiB 이하로 선택하세요.','Choose a JSON file up to 256 KiB.'));return;}try{const source=await file.text();if(revision===importRevision.current)setJson(source);}catch{if(revision===importRevision.current)setError(t('JSON 파일을 읽지 못했어요.','Could not read the JSON file.'));}}}/></label><label>{t('모델 JSON','Model JSON')}<textarea rows={7} value={json} disabled={busy} onChange={e=>{setJson(e.target.value);setPreview(null);setError('');}}/></label><div className="actions"><button disabled={busy} onClick={()=>{try{setPreview(importModelProfiles(json));setError('');}catch{setPreview(null);setError(t('모델 JSON을 확인하세요. 유효한 MoM 모델 JSON(256 KiB 이하)을 입력하고 키·비공개 필드는 제거하세요.','Check model JSON. Enter valid MoM model JSON up to 256 KiB and remove keys/private fields.'));}}}>{t('미리보기','Preview')}</button><button disabled={busy} onClick={()=>{importRevision.current++;setImporting(false);setJson('');setPreview(null);}}>{t('취소','Cancel')}</button></div>{preview&&<div className="stack gap12"><strong>{t('모두 비활성으로 가져와요. API 키는 따로 입력하세요.','All models are imported disabled. Enter API keys separately.')}</strong>{preview.map(r=><span className="hint registration-url" key={r.id}>{r.name} · {r.modelId} · {registrationEndpoint(r)}</span>)}<button className="primary align-start" disabled={busy||!preview.length||!c.onImportRegistrations} onClick={()=>void act(async()=>{await c.onImportRegistrations!(preview);setImporting(false);setJson('');setPreview(null);},t('모델을 비활성으로 가져왔어요.','Models imported disabled.'))}>{t('가져오기','Import')}</button></div>}{error&&<span role="alert" className="error">{error}</span>}</section></SettingsDialog>}
      {error&&!deleting&&!panel&&!importing&&<span role="alert" className="error">{error}</span>}{notice&&<span role="status" className="hint">{notice}</span>}
    </section>;
}

function RegistrationForm({ initial, mode, controller: c, onClose }: {
    initial: ModelRegistration;
    mode: 'edit'|'test';
    controller: AppController;
    onClose: () => void;
}) {
    const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
    const [newKey,setNewKey]=useState<ApiCredential|null>(null);
    const [draft, setDraft] = useState(initial), [error, setError] = useState(''), [notice, setNotice] = useState(''), [working, setWorking] = useState(false);
    const [presetId,setPresetId]=useState(c.modelRegistrations?.entries.some(r=>r.id===initial.id) ? '' : MODEL_PRESETS.find(p=>p.modelId===initial.modelId&&p.adapter===initial.adapter)?.id??'');
    const testedInput = useRef<RegistrationTestInput | null>(null);
    const [file, setFile] = useState<File | null>(null), [audioInfo, setAudioInfo] = useState<{
        bytes: number;
        durationMs: number;
    } | null>(null), [inspecting, setInspecting] = useState(false);
    const inspectionRevision = useRef(0);
    useEffect(() => () => { inspectionRevision.current++; }, []);
    const [languages, setLanguages] = useState(''), [glossary, setGlossary] = useState(''), [context, setContext] = useState('');
    const [transcript, setTranscript] = useState(t('합성 테스트 전사문: 팀은 다음 검토 일정을 논의했습니다. 담당자와 날짜는 지정하지 않았습니다.', 'Synthetic test transcript: The team discussed the next review. No owner or date was specified.'));
    const [outputLanguage, setOutputLanguage] = useState<string>(c.preferences.uiLanguage), [sections, setSections] = useState('summary, decisions, actions'), [instructions, setInstructions] = useState('');
    const [routerAcknowledged, setRouterAcknowledged] = useState(false);
    const saved = c.modelRegistrations?.entries.find(r => r.id === draft.id);
    const outputPreset = MODEL_PRESETS.find(p => p.stage === 'llm' && p.modelId === draft.modelId && p.adapter === draft.adapter && p.endpointUrl === draft.endpointUrl);
    const presetOutputLimit = outputPreset ? createModelPreset(outputPreset.id, () => draft.id).llm?.maxTokens : undefined;
    const [savedBinding,setSavedBinding]=useState(initial.credentialId);
    const [keySelection,setKeySelection]=useState(initial.credentialId??''), [parameters,setParameters]=useState(JSON.stringify(initial.requestParameters??{},null,2));
    const credentials=c.modelRegistrations?.credentials??[];
    let origin='';try{origin=new URL(draft.endpointUrl??draft.baseUrl).origin;}catch{ /* URL validation below explains the field. */ }
    const credential=draft.auth==='bearer'?credentials.find(item=>item.id===keySelection&&item.origin===origin):undefined;
    if(saved&&saved.credentialId!==savedBinding){setSavedBinding(saved.credentialId);setKeySelection(saved.credentialId??'');}
    const test = c.registrationTest?.id === draft.id ? c.registrationTest : null;
    const busy = !!c.busy || working || inspecting;
    let valid: ModelRegistration | null = null, preview = '', fieldError='';
    let requestParameters: Record<string,unknown>|undefined;
    try { requestParameters=validateRequestParameters(JSON.parse(parameters)); } catch { fieldError=t('매개변수 JSON: 유효한 JSON 객체를 입력하고 앱 제어 필드·키를 제거하세요. 입력 내용은 유지돼요.','Parameters JSON: enter a valid JSON object and remove app-managed fields or keys. Your text is retained.'); }
    const openAIInfo = draft.stage==='llm' ? openAIModelInfo(draft.adapter,draft.modelId) : null;
    const routerInfo = draft.stage==='llm' ? openRouterLLMInfo(draft) : null;
    const reasoningInfo = openAIInfo ?? routerInfo;
    const routerReasoning = asObject(requestParameters?.reasoning);
    const effort = routerInfo ? routerReasoning?.effort ?? requestParameters?.reasoning_effort : requestParameters?.reasoning_effort;
    const effortValue = effort===undefined ? routerReasoning?.max_tokens!==undefined?'budget':routerReasoning?.enabled!==undefined?'automatic':'' : typeof effort==='string'&&reasoningInfo?.efforts.some(value=>value===effort) ? effort : 'unsupported';
    const samplingLocked = !!openAIInfo && effort!=='none';
    const reasoningIssue = openAIInfo && requestParameters ? openAIReasoningIssue({...draft,requestParameters}) : undefined;
    const routerIssues = routerInfo && requestParameters ? openRouterLLMIssues({...draft,requestParameters}) : [];
    const providerIssue = draft.stage==='stt'&&draft.adapter==='openrouter' ? routerSTTOptionIssue(draft.modelId,requestParameters) : undefined;
    if(!fieldError&&reasoningIssue)fieldError=reasoningIssue==='sampling'?t('추론 강도: none 이외에서는 temperature·top_p·logprobs·top_logprobs를 함께 사용할 수 없어요. 기존 값은 유지돼요. none으로 전환해 값을 비우거나 매개변수 JSON을 수정하세요.','Reasoning effort: temperature, top_p, logprobs and top_logprobs cannot be combined with reasoning. Existing values are retained. Choose none to clear them or edit Parameters JSON.'):t('추론 강도: 이 모델이 지원하는 값을 선택하세요.','Reasoning effort: select a value supported by this model.');
    if(!fieldError&&routerIssues.length)fieldError=t(`모델 옵션을 확인하세요 (${routerIssues.join(', ')}). 지원 범위 밖의 값은 전송할 수 없어요. 입력 내용은 유지돼요.`,`Check model options (${routerIssues.join(', ')}). Values outside the supported range cannot be sent. Your input is retained.`);
    if(!fieldError&&providerIssue)fieldError=t(`제공사 옵션을 확인하세요: ${providerIssue}. 아래 제공사 옵션의 조건을 확인하세요.`,`Check provider option: ${providerIssue}. Review the provider option requirements below.`);
    if(!fieldError&&draft.instructionTemplate!==undefined)try{validateInstructionTemplate(draft.instructionTemplate);}catch{fieldError=t('작성 템플릿: transcript·output_language·sections·instructions 자리표시자만 사용하세요.','Instruction template: use only transcript, output_language, sections and instructions placeholders.');}
    try {
        if(fieldError)throw new Error();
        valid = withCredentialPolicy(validateRegistration({ ...draft, credentialId:credential?.id, requestParameters, keyStorage:credential?.keyStorage??draft.keyStorage, ...(saved ? { credentialVersion: saved.credentialVersion, credentialOrigin: saved.credentialOrigin, revision:saved.revision } : {}) }),credential);
        preview = buildRegistrationRequest(valid, 'preview').preview;
    }
    catch {
        preview = t('이름·주소·모델 ID와 호환 설정을 확인하세요.', 'Check name, URL, model ID and compatibility settings.');
        if(!fieldError)fieldError=!draft.name.trim()?t('이름을 입력하세요.','Enter a name.'):!draft.modelId.trim()?t('모델 ID를 입력하세요.','Enter a model ID.'):t('엔드포인트 URL·API 종류·고급 설정을 확인하세요. 공식 API는 지정 경로를 사용하며 사용자 서버는 호환 API로 선택하세요.','Check endpoint URL, API kind and advanced settings. Official APIs require their exact route; use Compatible API for a custom server.');
    }
    const sttOptions = sttCapabilities(draft);
    const sttCompatibility = valid ? registrationReadiness(valid).filter(issue => issue.startsWith('stt-model-')) : [];
    const ipv6Http = valid && new URL(valid.baseUrl).protocol === 'http:' && new URL(valid.baseUrl).hostname === '[::1]';
    const same = saved && valid && registrationSignature(saved) === registrationSignature(valid);
    const hasKey = draft.auth === 'none' || !!c.registrationKeyReady?.includes(draft.id) && !!same;
    const router = (() => { try {
        return draft.adapter === 'openrouter';
    }
    catch {
        return false;
    } })();
    const input: RegistrationTestInput | null = draft.stage === 'stt' ? (file ? { stage: 'stt', file, languages: list(languages), glossary: list(glossary), context } : null) : { stage: 'llm', transcript, outputLanguage, sections: list(sections), instructions };
    const result = test?.result ?? saved?.lastTest;
    const currentResult = !!result && !!valid && result.signature === registrationSignature(valid) && !!input && !!testedInput.current && registrationInputSummary(testedInput.current) === registrationInputSummary(input) && (input.stage !== 'stt' || testedInput.current.stage === 'stt' && testedInput.current.file === input.file);
    function change(patch: Partial<ModelRegistration>) {
        let originChanged=false;
        if(patch.endpointUrl!==undefined||patch.baseUrl!==undefined)try{originChanged=new URL(patch.endpointUrl??patch.baseUrl!).origin!==new URL(draft.endpointUrl??draft.baseUrl).origin;}catch{originChanged=true;}
        if(originChanged||patch.auth!==undefined&&patch.auth!==draft.auth||patch.adapter!==undefined&&patch.adapter!==draft.adapter){setKeySelection('');}
        setDraft({ ...draft, ...patch }); setError(''); setNotice(''); setRouterAcknowledged(false); }
    function numeric(value: string) { return value === '' ? undefined : Number(value); }
    function selectPreset(id:string) {
        const preset=createModelPreset(id);setPresetId(id);
        change({...preset,id:draft.id,credentialOrigin:draft.credentialOrigin,credentialVersion:draft.credentialVersion,stt:preset.stt,llm:preset.llm,routerPolicy:preset.routerPolicy,routerEndpointTag:undefined,catalogEvidence:undefined,instructionTemplate:undefined});
        setParameters(JSON.stringify(preset.requestParameters??{},null,2));setKeySelection('');
    }
    function selectProvider(adapter:NonNullable<ModelRegistration['adapter']>,nextStage=draft.stage) {
        const preset=MODEL_PRESETS.find(p=>p.stage===nextStage&&p.adapter===adapter);
        if(preset)selectPreset(preset.id);
    }
    function selectEffort(value:string) {
        if(!requestParameters)return;
        const next={...requestParameters};
        if(routerInfo){
            const reasoning={...routerReasoning};delete reasoning.enabled;delete reasoning.max_tokens;delete reasoning.effort;
            if(value)reasoning.effort=value;
            if(Object.keys(reasoning).length)next.reasoning=reasoning;else delete next.reasoning;
            delete next.reasoning_effort;
        }else if(value)next.reasoning_effort=value;else delete next.reasoning_effort;
        editParameters(next);
    }
    function editParameters(value:Record<string,unknown>){setParameters(JSON.stringify(value,null,2));setError('');setNotice('');setRouterAcknowledged(false);}
    function parameter(key:string,value:unknown){if(!requestParameters)return;const next={...requestParameters};if(value===undefined)delete next[key];else next[key]=value;editParameters(next);}
    function reasoningOption(key:string,value:unknown){
        if(!requestParameters)return;const reasoning={...routerReasoning};
        if(key==='max_tokens'&&value!==undefined){delete reasoning.effort;delete reasoning.enabled;}
        if(value===undefined)delete reasoning[key];else reasoning[key]=value;
        const next={...requestParameters};if(Object.keys(reasoning).length)next.reasoning=reasoning;else delete next.reasoning;
        if(key==='max_tokens'&&value!==undefined)delete next.reasoning_effort;
        editParameters(next);
    }
    async function act(action: () => Promise<void>, success = '') { if (busy)
        return; setWorking(true); setError(''); setNotice(''); try {
        await action();
        setNotice(success);
    }
    catch {
        setError(t('완료하지 못했어요. 설정과 저장소를 확인하세요. 기존 저장 값은 유지돼요.', 'Could not complete. Check settings and storage. Previously saved values are retained.'));
    }
    finally {
        setWorking(false);
    } }
    async function selectAudio(next: File | null) { const revision = ++inspectionRevision.current; setFile(null); setAudioInfo(null); setError(''); setRouterAcknowledged(false); if (!next)
        return; if (next.size > Math.min(5242880, draft.stt?.maxBytes ?? Infinity)) {
        setError(t('테스트 음성은 앱 제한 5 MiB 이하로 선택하세요.', 'Choose test audio within the app limit of 5 MiB.'));
        return;
    } setInspecting(true); try {
        const { inspectAudioDetails } = await import('../../media/inspect');
        const inspected = await inspectAudioDetails(next);
        if (revision !== inspectionRevision.current)
            return;
        if (inspected.asset.durationMs > Math.min(30, draft.stt?.maxSeconds ?? Infinity) * 1000)
            throw new Error();
        setFile(next);
        setAudioInfo({ bytes: next.size, durationMs: inspected.asset.durationMs });
    }
    catch {
        if (revision === inspectionRevision.current)
            setError(t('지원되는 30초 이하의 테스트 음성을 선택하세요.', 'Choose supported test audio up to 30 seconds.'));
    }
    finally {
        if (revision === inspectionRevision.current)
            setInspecting(false);
    } }
    return <SettingsDialog title={mode==='test'?`${draft.stage.toUpperCase()} ${t('테스트','test')}`:saved?t('모델 수정','Edit model'):t('새 모델 등록','New model registration')} closeLabel={t('닫기','Close')} busy={busy} onClose={onClose}>
  <section className="registration-form stack gap16">
  {mode==='edit'&&<fieldset disabled={busy} className="stack gap16">
   {!saved&&<label>{t('종류','Type')}<select value={draft.stage} onChange={e=>selectProvider(draft.adapter??'openai-compatible',e.target.value as 'stt'|'llm')}><option value="stt">STT</option><option value="llm">LLM</option></select></label>}
   <label>{t('API 종류','API kind')}<select value={draft.adapter??'openai-compatible'} onChange={e=>selectProvider(e.target.value as NonNullable<ModelRegistration['adapter']>)}><option value="openai">OpenAI</option><option value="openrouter">OpenRouter</option><option value="openai-compatible">{t('호환 API','Compatible API')}</option></select></label>
   <label>{t('프리셋', 'Preset')}<select value={presetId} onChange={e=>e.target.value?selectPreset(e.target.value):setPresetId('')}><option value="">{t('직접 입력','Custom configuration')}</option>{MODEL_PRESETS.filter(p=>p.stage===draft.stage&&p.adapter===(draft.adapter??'openai-compatible')).map(p=><option key={p.id} value={p.id}>{p.adapter==='openai'?'OpenAI':p.adapter==='openrouter'?'OpenRouter':t('호환 API','Compatible API')} · {p.name}</option>)}</select></label>
   <div className="registration-fields">
    <label className="registration-wide">{t('이름', 'Name')}<input value={draft.name} maxLength={512} onChange={e => change({ name: e.target.value })}/>
    </label>
    <label className="registration-wide">{t('전체 엔드포인트 URL','Full endpoint URL')}<input type="url" value={draft.endpointUrl??registrationEndpoint(draft)} spellCheck={false} onChange={e=>change({endpointUrl:e.target.value,baseUrl:e.target.value})}/></label>
    <label>{t('모델 ID', 'Model ID')}<input value={draft.modelId} maxLength={256} spellCheck={false} placeholder={draft.stage === 'stt' ? 'gpt-transcribe / whisper-local' : 'model-id'} onChange={e => {setPresetId('');change({ modelId: e.target.value });}}/>
    </label>
    <label>{t('인증', 'Authentication')}<select value={draft.auth} onChange={e => change({ auth: e.target.value as ModelRegistration['auth'] })}>
    <option value="bearer">Bearer API key</option>
    <option value="none">{t('인증 없음', 'No authentication')}</option>
    </select>
    </label>
   </div>
   {reasoningInfo&&<section className="stack gap12" aria-label={openAIInfo?t('OpenAI 모델 옵션','OpenAI model options'):t('OpenRouter 모델 옵션','OpenRouter model options')}>
     <label>{t('기본 추론 강도','Default reasoning effort')}<select value={effortValue} disabled={!requestParameters} onChange={e=>selectEffort(e.target.value)}><option value="">{t(`API 기본값 (${reasoningInfo.defaultEffort})`,`API default (${reasoningInfo.defaultEffort})`)}</option>{effortValue==='unsupported'&&<option value="unsupported" disabled>{t('지원하지 않는 현재 값','Unsupported current value')}</option>}{effortValue==='budget'&&<option value="budget" disabled>{t('토큰 예산 사용 (고급 설정)','Token budget (advanced settings)')}</option>}{effortValue==='automatic'&&<option value="automatic" disabled>{t('JSON의 enabled 값 사용','Uses enabled from JSON')}</option>}{reasoningInfo.efforts.map(value=><option key={value} value={value}>{value}</option>)}</select></label>
     <span className="hint">{t('메모 정리 시 이번 실행의 강도를 따로 고를 수 있어요. 높은 단계는 시간·출력 요금이 늘 수 있어요.','Choose another effort for an individual notes run. Higher effort can increase time and output cost.')}{routerInfo?.mandatory?` · ${t('추론 필수 모델','Reasoning required')}`:''}</span>
     {openAIInfo&&<>
     <span className="hint">Standard · USD / 1M tokens · {t('입력','Input')} ${openAIInfo.inputUsdPerMillion} · {t('출력','Output')} ${openAIInfo.outputUsdPerMillion}</span>
     <details><summary>{t('요금 조건','Pricing details')}</summary><span className="hint">{t(`입력 ${openAIInfo.longInputTokens.toLocaleString()} 토큰 초과 시 입력 ${openAIInfo.longInputMultiplier}배·출력 ${openAIInfo.longOutputMultiplier}배예요. 추론 토큰도 출력 요금에 포함돼요.`,`Above ${openAIInfo.longInputTokens.toLocaleString()} input tokens, input is ${openAIInfo.longInputMultiplier}x and output is ${openAIInfo.longOutputMultiplier}x. Reasoning tokens are billed as output.`)}</span><a href="https://developers.openai.com/api/docs/pricing" target="_blank" rel="noreferrer">{t('공식 요금','Official pricing')} · {openAIInfo.checkedAt}</a></details>
     </>}
     {routerInfo&&<details><summary>{t('지원 옵션·요금','Supported options & pricing')}</summary><div className="stack gap12"><span className="hint">{t('카탈로그 대표 단가','Catalog price')} · USD / 1M tokens · {t('입력','Input')} ${routerInfo.inputUsdPerMillion} · {t('출력','Output')} ${routerInfo.outputUsdPerMillion}</span>{routerInfo.priceOverrides.map(tier=><span key={tier.minInputTokens} className="hint">{t(`입력 ${tier.minInputTokens.toLocaleString()} 토큰 이상: 입력 $${tier.inputUsdPerMillion} · 출력 $${tier.outputUsdPerMillion}`,`From ${tier.minInputTokens.toLocaleString()} input tokens: input $${tier.inputUsdPerMillion} · output $${tier.outputUsdPerMillion}`)}</span>)}<span className="hint">{t('실제 요금은 처리 경로에 따라 달라져요. 추론 토큰도 출력 한도·요금에 포함돼요.','Actual pricing depends on the routed provider. Reasoning tokens also use the output limit and are billed.')}</span><span className="hint registration-url">{routerInfo.supportedParameters.join(' · ')}</span><a href={`https://openrouter.ai/${draft.modelId}`} target="_blank" rel="noreferrer">{t('모델 정보','Model details')} · {routerInfo.checkedAt}</a></div></details>}
   </section>}
   <label className="checkbox-line"><input type="checkbox" checked={draft.enabled===true} onChange={e=>change({enabled:e.target.checked})}/><span>{t('이 모델 활성화','Enable this model')}</span></label>
   <span className="hint">{t('프리셋도 실제 모델 지원·CORS 통과를 보장하지 않아요. 원격 HTTPS와 로컬 localhost·127.0.0.1 HTTP를 지원해요. 브라우저 CORS·로컬 네트워크 권한 제한 시 서버 설정을 확인하세요.', 'Presets do not verify model support or CORS. Remote HTTPS and local localhost/127.0.0.1 HTTP are supported. If CORS or local network permissions block access, check your server configuration.')}</span>
   {sttCompatibility.length > 0 && <span role="alert" className="warning">{t('모델과 응답 형식·언어 힌트·용어 설정이 맞지 않아 실행할 수 없어요. 해당 모델 프리셋을 선택하거나 고급 설정을 수정하세요.', 'The response format, language hint or vocabulary setting is incompatible with this model. Select its preset or adjust advanced settings before running.')}</span>}
   <details>
    <summary className="touch-summary">{t('고급 설정', 'Advanced settings')}</summary>
    <div className="registration-fields">
    {draft.stage === 'stt' ? <>
     {draft.adapter==='openai'&&draft.modelId==='gpt-transcribe'&&<label>{t('응답 받기','Response delivery')}<select value={draft.stt?.stream?'stream':'json'} onChange={e=>change({stt:{...draft.stt,stream:e.target.value==='stream'}})}><option value="json">{t('완료 후 받기','Completed response')}</option><option value="stream">{t('스트리밍 응답 (완료 후 표시)','Stream response (display after completion)')}</option></select></label>}
     <label>{t('응답 형식', 'Response format')}<select value={draft.stt?.responseFormat ?? 'json'} onChange={e => change({ stt: { ...draft.stt, responseFormat: e.target.value as 'json', timestamps: 'none' } })}>{(['json', 'verbose_json', 'diarized_json'] as const).map(v => <option key={v} disabled={!sttOptions.formats.includes(v)}>{v}</option>)}</select>
        </label>
     <label>{t('언어 힌트 필드', 'Language hint field')}<select value={draft.stt?.languageMode ?? 'none'} onChange={e => change({ stt: { ...draft.stt, languageMode: e.target.value as 'none' } })}>
        <option value="none">{t('전송 안 함', 'Omit')}</option>
        <option value="single" disabled={!sttOptions.languages.includes('single')}>language</option><option value="multiple" disabled={!sttOptions.languages.includes('multiple')}>languages[]</option></select>
        </label>
     <label>{t('용어·맥락 필드', 'Vocabulary / context field')}<select value={draft.stt?.termMode ?? 'none'} onChange={e => change({ stt: { ...draft.stt, termMode: e.target.value as 'none' } })}>
        <option value="none">{t('전송 안 함', 'Omit')}</option>
        <option value="prompt" disabled={!sttOptions.terms.includes('prompt')}>prompt</option>
        <option value="keywords" disabled={!sttOptions.terms.includes('keywords')}>keywords[]</option>
        <option value="prompt-and-keywords" disabled={!sttOptions.terms.includes('prompt-and-keywords')}>prompt + keywords[]</option></select>
        </label>
     <label>{t('시간 정보', 'Timestamps')}<select value={draft.stt?.timestamps ?? 'none'} disabled={(draft.stt?.responseFormat ?? 'json') !== 'verbose_json' || !sttOptions.formats.includes('verbose_json')} onChange={e => change({ stt: { ...draft.stt, timestamps: e.target.value as 'none' } })}>
        <option value="none">{t('전송 안 함', 'Omit')}</option>
        <option value="segment">segment</option>
        <option value="word">word</option>
        {router&&<option value="segment-and-word">segment + word</option>}
        </select>
        </label>
     <label>Temperature<input type="number" min={0} max={1} step="0.1" value={draft.stt?.temperature ?? ''} onChange={e => change({ stt: { ...draft.stt, temperature: numeric(e.target.value) } })}/></label>
     {router && <span className="hint">{t('OpenRouter 공통 언어 힌트는 1개만 지원하며 용어·맥락은 공통 필드로 전송하지 않아요. 일부 제공사별 옵션은 해당 제공사에서만 적용돼요.', 'OpenRouter common transcription supports one language hint; vocabulary and context are not sent as common fields. Provider-specific options apply only to that provider.')}</span>}
     <label>{t('파일 한도 (bytes)', 'File limit (bytes)')}<input type="number" min={1} value={draft.stt?.maxBytes ?? ''} onChange={e => change({ stt: { ...draft.stt, maxBytes: numeric(e.target.value) } })}/>
        </label>
     <label>{t('시간 한도 (초)', 'Duration limit (seconds)')}<input type="number" min={0.01} step="any" value={draft.stt?.maxSeconds ?? ''} onChange={e => change({ stt: { ...draft.stt, maxSeconds: numeric(e.target.value) } })}/>
        </label>
     {router&&<RouterSTTOptions modelId={draft.modelId} parameters={requestParameters} onChange={editParameters} t={t}/>}
    </> : <>
     <label>{t('컨텍스트 토큰 한도','Context token limit')}<input type="number" min={1} value={draft.llm?.contextTokens??''} onChange={e=>change({llm:{...draft.llm,contextTokens:numeric(e.target.value)}})}/></label>
     <label>{t('출력 한도 필드', 'Output limit field')}<select value={draft.llm?.tokenField ?? 'max_completion_tokens'} onChange={e => change({ llm: { ...draft.llm, tokenField: e.target.value as 'max_tokens' } })}>
        <option disabled={!!routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('max_completion_tokens')}>max_completion_tokens</option>
        <option disabled={!!routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('max_tokens')}>max_tokens</option>
        </select>
        </label>
     <div className="stack gap12"><label>{t('모델 최대 출력 토큰', 'Model maximum output tokens')}<input type="number" min={1} max={1000000} value={draft.llm?.maxTokens ?? ''} onChange={e => change({ llm: { ...draft.llm, maxTokens: numeric(e.target.value) } })}/></label>
       <span className="hint">{t('모델이 지원하는 출력 상한이에요. 정리 분량은 기본 4K이며, 메모별로 이 상한 안에서 선택해요.', 'This is the model’s output ceiling. Notes default to 4K; choose each memo’s length within this limit.')}</span>
       {presetOutputLimit !== undefined && (draft.llm?.maxTokens ?? 0) < presetOutputLimit && <button type="button" className="align-start" onClick={() => change({llm:{...draft.llm,maxTokens:presetOutputLimit}})}>{t('예시 모델 출력 한도 적용', 'Use preset output ceiling')}</button>}
     </div>
     <label>temperature<input type="number" min={0} max={2} step="any" disabled={samplingLocked||!!routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('temperature')} value={draft.llm?.temperature ?? ''} onChange={e => change({ llm: { ...draft.llm, temperature: numeric(e.target.value) } })}/>
        </label>
     {routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('temperature')&&draft.llm?.temperature!==undefined&&<button type="button" onClick={()=>change({llm:{...draft.llm,temperature:undefined}})}>{t('지원되지 않는 temperature 제거','Remove unsupported temperature')}</button>}
     <label>top_p<input type="number" min={0} max={1} step="any" disabled={samplingLocked||!!routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('top_p')} value={draft.llm?.topP ?? ''} onChange={e => change({ llm: { ...draft.llm, topP: numeric(e.target.value) } })}/>
        </label>
     {routerInfo&&!(routerInfo.supportedParameters as readonly string[]).includes('top_p')&&draft.llm?.topP!==undefined&&<button type="button" onClick={()=>change({llm:{...draft.llm,topP:undefined}})}>{t('지원되지 않는 top_p 제거','Remove unsupported top_p')}</button>}
     {routerInfo&&<fieldset className="registration-wide stack gap12" disabled={!requestParameters}><legend>{t('OpenRouter 추가 옵션','Additional OpenRouter options')}</legend><div className="registration-fields">
       {([['top_k',0,undefined,1],['min_p',0,1,'any'],['top_a',0,1,'any'],['frequency_penalty',-2,2,'any'],['presence_penalty',-2,2,'any'],['repetition_penalty',0,2,'any'],['seed',undefined,undefined,1],['top_logprobs',0,20,1]] as const).filter(([key])=>(routerInfo.supportedParameters as readonly string[]).includes(key)).map(([key,min,max,step])=><label key={key}>{key}<input type="number" min={min} max={max} step={step} value={typeof requestParameters?.[key]==='number'?requestParameters[key] as number:''} onChange={e=>parameter(key,numeric(e.target.value))}/></label>)}
       {(routerInfo.supportedParameters as readonly string[]).includes('logprobs')&&<label>logprobs<select value={requestParameters?.logprobs===undefined?'':String(requestParameters.logprobs)} onChange={e=>parameter('logprobs',e.target.value===''?undefined:e.target.value==='true')}><option value="">{t('전송 안 함','Omit')}</option><option value="true">true</option><option value="false">false</option></select></label>}
       {(routerInfo.supportedParameters as readonly string[]).includes('verbosity')&&<label>verbosity<select value={typeof requestParameters?.verbosity==='string'?requestParameters.verbosity:''} onChange={e=>parameter('verbosity',e.target.value||undefined)}><option value="">{t('API 기본값','API default')}</option>{['low','medium','high'].map(value=><option key={value}>{value}</option>)}</select></label>}
       <label>{t('기본 추론 토큰 예산','Default reasoning token budget')}<input type="number" min={1} step={1} max={draft.llm?.maxTokens} value={typeof routerReasoning?.max_tokens==='number'?routerReasoning.max_tokens:''} onChange={e=>reasoningOption('max_tokens',numeric(e.target.value))}/></label>
       <label>{t('응답에서 추론 제외','Exclude reasoning from response')}<select value={routerReasoning?.exclude===undefined?'':String(routerReasoning.exclude)} onChange={e=>reasoningOption('exclude',e.target.value===''?undefined:e.target.value==='true')}><option value="">{t('API 기본값','API default')}</option><option value="true">true</option><option value="false">false</option></select></label>
     </div><span className="hint">{t('추론 예산을 입력하면 기본 추론 강도를 대체해요. 제공사에 따라 강도로 변환될 수 있어요. stop·logit_bias 등 나머지 지원 옵션은 아래 JSON에서 설정하세요.','A token budget replaces the default effort and may be mapped to an effort by the provider. Set other supported options such as stop and logit_bias in JSON below.')}</span></fieldset>}
    </>}
   </div>
    <span className="hint">{t('선택 필드는 해당 서버·모델이 지원할 때만 설정하세요. 미설정 옵션은 생략해요. OpenRouter의 최상위 prompt는 무시돼요.', 'Set optional fields only when supported by your server and model. Unset options are omitted. OpenRouter ignores top-level prompt.')}</span>
    <label>{t('매개변수 JSON','Parameters JSON')}<textarea rows={7} value={parameters} spellCheck={false} onChange={e=>{setParameters(e.target.value);setError('');}}/></label>
    <span className="hint">{draft.stage==='llm'?t('model·messages·response_format·stream은 Markdown 정리용으로 앱이 관리해요. 도구 호출·구조화 출력은 이 흐름에서 사용할 수 없어요.','The app manages model, messages, response_format and stream for Markdown notes. Tool calls and structured output are unavailable in this workflow.'):t('공급자별 provider.options 등을 JSON 객체로 입력하세요. model·response_format 등 앱 제어 필드는 해당 입력란을 사용하세요.','Enter provider-specific provider.options as a JSON object. Use the dedicated controls for app-managed fields such as model and response_format.')}</span>
    {draft.stage==='llm'&&<><label>{t('작성 템플릿','Instruction template')}<textarea rows={5} value={draft.instructionTemplate??''} onChange={e=>change({instructionTemplate:e.target.value||undefined})}/></label><span className="hint">{'{{transcript}} · {{output_language}} · {{sections}} · {{instructions}}'} · {t('공유 JSON에 포함돼요.','Included in shared JSON.')}</span></>}
    {draft.stage==='stt'&&<div className="actions">{(['mp3','wav'] as const).map(format=><label className="checkbox-line" key={format}><input type="checkbox" checked={draft.stt?.formats?.includes(format)??true} onChange={e=>change({stt:{...draft.stt,formats:e.target.checked?[...(draft.stt?.formats??['mp3','wav']).filter(f=>f!==format),format]:(draft.stt?.formats??['mp3','wav']).filter(f=>f!==format)}})}/>{format}</label>)}</div>}
    {router&&draft.stage==='llm'&&<label>{t('처리 제공사 태그 (선택)','Processor tag (optional)')}<input value={draft.routerEndpointTag??''} onChange={e=>change({routerEndpointTag:e.target.value||undefined})}/></label>}
    </details>
    {draft.auth==='bearer'&&<div className="stack gap12">
      <label>{t('API 키 선택','API key')}<select value={credential?.id??''} onChange={e=>{setKeySelection(e.target.value);setError('');setNotice('');}}><option value="">{t('연결 안 함','No key linked')}</option>{credentials.filter(item=>item.origin===origin).map(item=><option key={item.id} value={item.id}>{item.name}{c.credentialKeyReady?.includes(item.id)?'':t(' · 키 입력 필요',' · key required')}</option>)}</select></label>
      {credential&&<span className="hint">{credential.origin} · {credential.keyStorage==='encrypted'?t('암호화 저장','Encrypted storage'):t('이 탭에서만','This tab only')} · {t('선택한 키를 재사용해요. 교체·보관 방식 변경은 오른쪽 API 키 카드에서 관리해요.','Reuses the selected key. Manage rotation and storage in the API keys card.')}</span>}
      <span className="hint">{t('같은 서버의 저장된 키를 선택하세요. 키 연결을 해제해도 공유 키는 유지돼요.','Select a saved key for the same server. Detaching a key keeps the shared credential.')}</span>
      <button type="button" className="align-start" disabled={!c.onSaveApiCredential} onClick={()=>setNewKey({id:crypto.randomUUID(),name:'',origin,keyStorage:'encrypted',version:0})}>{t('API 키 추가','Add API key')}</button>
    </div>}

   <div className="actions wrap align-end">
    {saved&&<button type="button" aria-label={t(`${saved.name} JSON 내보내기`,`Export ${saved.name} JSON`)} onClick={()=>{try{downloadModels([saved]);}catch{setError(t('내보내지 못했어요. 저장한 설정을 확인하세요.','Could not export. Check the saved settings.'));}}}>{t('저장한 설정 JSON 내보내기','Export saved model JSON')}</button>}
    <button type="button" className="primary" disabled={!valid || !c.onSaveRegistration} onClick={() => void act(async()=>{await c.onSaveRegistration!(valid!,{action:'keep'});onClose();})}>{t('저장', 'Save')}</button>
    </div>
  </fieldset>}
  {mode==='test'&&<section className="registration-test stack gap16">
  <div className="notice stack"><strong>{draft.name}</strong><span className="hint registration-url">{draft.modelId} · {valid?new URL(registrationEndpoint(valid)).host:''}</span></div>
  <details><summary>{t('요청 상세 보기','Request details')}</summary>
  <section className="stack gap12">
    <strong>{t('요청 템플릿 · 자동 미리보기', 'Request template · automatic preview')}</strong>
    <pre className="registration-preview" aria-label={t('요청 템플릿 미리보기', 'Request template preview')}>{preview}</pre>
    </section>
  </details>
  <fieldset disabled={busy} className="stack gap12">
    <legend>{t('테스트 입력', 'Test input')}</legend>
   {draft.stage === 'stt' ? <>
        <label>{t('테스트 음성 (30초 · 5 MiB 이하)', 'Test audio (up to 30 seconds · 5 MiB)')}<input type="file" accept=".wav,.mp3,.m4a,audio/*" onChange={e => void selectAudio(e.target.files?.[0] ?? null)}/>
        </label>{audioInfo && <span className="hint">{audioInfo.bytes.toLocaleString()} bytes · {(audioInfo.durationMs / 1000).toFixed(2)} s</span>}<details><summary>{t('추가 옵션','Additional options')}</summary><div className="stack gap12"><label>{t('예상 언어 (쉼표 구분)', 'Expected languages (comma separated)')}<input value={languages} maxLength={4000} placeholder="ko, en" onChange={e => { setLanguages(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        <label>{t('용어장 (쉼표 구분)', 'Vocabulary (comma separated)')}<input value={glossary} maxLength={4000} onChange={e => { setGlossary(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        <label>{t('녹음 맥락', 'Audio context')}<textarea value={context} maxLength={4000} onChange={e => { setContext(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        </div></details></> : <>
        <span className="hint">{t('아래는 편집 가능한 합성 예시예요. 현재 음성 메모 전사문은 자동으로 가져오지 않아요.', 'This editable synthetic example does not automatically include your current voice memo transcript.')}</span>
        <label>{t('테스트 전사문', 'Test transcript')}<textarea rows={4} maxLength={32768} value={transcript} onChange={e => { setTranscript(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        <details><summary>{t('추가 옵션','Additional options')}</summary><div className="registration-fields">
        <label>{t('출력 언어', 'Output language')}<input value={outputLanguage} maxLength={80} onChange={e => { setOutputLanguage(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        <label>{t('섹션 (쉼표 구분)', 'Sections (comma separated)')}<input value={sections} maxLength={4000} onChange={e => { setSections(e.target.value); setRouterAcknowledged(false); }}/>
        </label>
        </div>
        <span className="hint">summary, topics, decisions, actions, open, refs</span>
        <label>{t('추가 지침', 'Additional instructions')}<textarea value={instructions} maxLength={4000} onChange={e => { setInstructions(e.target.value); setRouterAcknowledged(false); }}/>
        </label></details>
        </>}
  </fieldset>
  <section className="notice stack gap12">
    <strong>{t('전송 전 확인', 'Review before sending')}</strong>
    <span className="registration-url mono">{valid ? registrationEndpoint(valid) : '—'}</span>
    <span className="mono registration-url">{draft.modelId || '—'}</span><span>{t('선택한 테스트 입력과 설정을 위 서버로 브라우저에서 직접 전송해요. 비용과 제공사 보관 정책이 적용될 수 있어요. 취소가 처리·비용 취소를 보장하지 않아요.', 'Your browser sends the selected test input and settings directly to this server. Charges and provider retention may apply. Cancellation does not guarantee that processing or charges stop.')}</span>{router && <span className="hint">{draft.stage === 'stt' ? (draft.routerPolicy?.requireZdr === false ? t('데이터 수집 거부 · 표준 보관 허용', 'Deny collection · standard retention allowed') : t('데이터 수집 거부 · ZDR 필수. 경로가 없으면 실패해요.', 'Deny collection · require ZDR. Fails if no eligible route exists.')) : t('제공사의 보관 정책이 적용돼요.', 'Provider retention policies apply.')}</span>}{router && <label className="checkbox-line">
        <input type="checkbox" checked={routerAcknowledged} disabled={busy} onChange={e => setRouterAcknowledged(e.target.checked)}/>
        <span>{t('OpenRouter 전송·보관 정책을 확인했어요.', 'I reviewed OpenRouter transmission and the selected retention policy.')} <a href="https://openrouter.ai/docs/guides/privacy/provider-logging" target="_blank" rel="noreferrer">{t('정책 읽기', 'Read policies')}</a>
        </span>
        </label>}
   <div className="actions wrap">
    {test?.running && <button type="button" onClick={c.onCancelRegistrationTest}>{t('호출 취소', 'Cancel call')}</button>}<button type="button" className="primary" disabled={busy || sttCompatibility.length > 0 || !!ipv6Http || !same || !hasKey || !input || !valid || !c.onTestRegistration || router && !routerAcknowledged || draft.stage === 'stt' && !audioInfo} onClick={() => { testedInput.current = input; void act(() => c.onTestRegistration!(valid!, input!, routerAcknowledged)); }}>{test?.running ? t('호출 중…', 'Calling…') : t('테스트 호출', 'Test call')}</button></div>
   {ipv6Http && <span role="alert" className="warning">{t('HTTP [::1] 직접 호출은 지원하지 않아요. localhost로 주소를 바꾸고 저장하세요. 인증 키를 사용한다면 새 origin에 키를 다시 저장해야 해요.', 'Direct HTTP [::1] calls are unsupported. Change the address to localhost and save it. If authentication is enabled, save the key again for the new origin.')}</span>}
   {!same && <span className="hint">{t('테스트 전에 현재 설정을 저장하세요.', 'Save the current configuration before testing.')}</span>}{same && !hasKey && <span className="hint">{t('저장된 키가 필요해요. 미저장 키는 사용하지 않아요.', 'A saved key is required. Unsaved key input is not used.')}</span>}
  </section>
  {result && <TestResult result={result} current={currentResult} saving={!!test?.saving} saved={test?.result === result ? test.saved : true} controller={c}/>}
  </section>}
  {fieldError && <span role="alert" className="error">{fieldError}</span>}
  {error && <span role="alert" className="error">{error}</span>}{notice && <span role="status" className="hint">{notice}</span>}
 </section>
 {newKey&&<CredentialForm initial={newKey} saved={false} controller={c} onClose={()=>setNewKey(null)} onSaved={()=>{setKeySelection(newKey.id);setNewKey(null);}}/>}
 </SettingsDialog>;
}
function RouterSTTOptions({modelId,parameters,onChange,t}:{modelId:string;parameters:Record<string,unknown>|undefined;onChange:(value:Record<string,unknown>)=>void;t:(ko:string,en:string)=>string}) {
    const info=routerSTTOptions(modelId);
    if(!info)return <span className="hint registration-wide">{t('이 모델의 추가 제공사 옵션은 확인되지 않았어요. 공통 옵션 외에는 공식 제공사 문서와 테스트로 확인하세요.','Additional provider options are unverified for this model. Check provider documentation and test options beyond the common fields.')}</span>;
    const provider=asObject(parameters?.provider),options=asObject(provider?.options),value=asObject(options?.[info.provider])??{};
    function update(patch:Record<string,unknown>){
        if(!parameters)return;const next={...value,...patch};for(const key of Object.keys(next))if(next[key]===undefined)delete next[key];
        onChange({...parameters,provider:{...provider,options:{...options,[info!.provider]:next}}});
    }
    const number=(value:string)=>value===''?undefined:Number(value);
    const diarization=asObject(value.diarization),phrases=asObject(value.phraseList),enhanced=asObject(value.enhancedMode),modelOptions=asObject(enhanced?.modelOptions);
    return <fieldset className="registration-wide stack gap12" disabled={!parameters}><legend>{t('제공사 옵션','Provider options')} · {info.provider}</legend>
      <span className="hint">{t('실제 처리 제공사가 일치할 때 적용돼요. STT 요청은 제공사 고정을 지원하지 않아요.','Applied when this provider handles the request. STT does not support pinning a provider.')}</span>
      {info.provider==='azure'&&<div className="registration-fields">
        <label>{t('화자 분리','Speaker diarization')}<select value={diarization?.enabled===undefined?'':String(diarization.enabled)} onChange={e=>{const next={...diarization};if(e.target.value==='')delete next.enabled;else next.enabled=e.target.value==='true';update({diarization:next});}}><option value="">{t('제공사 기본값','Provider default')}</option><option value="true">true</option><option value="false">false</option></select></label>
        <label>{t('최대 화자 수','Maximum speakers')}<input type="number" min={2} max={35} step={1} value={typeof diarization?.maxSpeakers==='number'?diarization.maxSpeakers:''} onChange={e=>{const next={...diarization};if(e.target.value==='')delete next.maxSpeakers;else next.maxSpeakers=Number(e.target.value);update({diarization:next});}}/></label>
        <label className="registration-wide">{t('기본 용어 (쉼표 구분)','Default vocabulary (comma separated)')}<textarea key={JSON.stringify(phrases?.phrases)} rows={2} maxLength={4000} defaultValue={Array.isArray(phrases?.phrases)?phrases.phrases.join(', '):''} onBlur={e=>update({phraseList:{...phrases,phrases:list(e.target.value)}})}/></label>
        <label>{t('전사 스타일','Transcription style')}<select value={typeof modelOptions?.transcribeStyle==='string'?modelOptions.transcribeStyle:''} onChange={e=>{const next={...modelOptions};if(e.target.value)next.transcribeStyle=e.target.value;else delete next.transcribeStyle;update({enhancedMode:{...enhanced,modelOptions:next}});}}><option value="">{t('제공사 기본값','Provider default')}</option><option value="clean">clean</option><option value="verbatim">verbatim</option></select></label>
      </div>}
      {info.provider==='groq'&&<>
        <label className="checkbox-line"><input type="checkbox" checked={value.prompt!==undefined} onChange={e=>update({prompt:e.target.checked?'':undefined})}/><span>{t('용어·맥락 주입 사용','Enable vocabulary and context hints')}</span></label>
        {value.prompt!==undefined&&<label>{t('기본 전사 맥락','Default audio context')}<textarea rows={3} maxLength={4000} value={typeof value.prompt==='string'?value.prompt:''} onChange={e=>update({prompt:e.target.value})}/></label>}
        <span className="hint">{t('주입을 켜면 메모의 용어·맥락을 Groq prompt로 보냅니다. 메모에 별도 입력이 없으면 기본값을 사용해요.','When enabled, memo vocabulary and context are sent as the Groq prompt. The default is used when a memo has no override.')}</span>
      </>}
      {info.provider==='elevenlabs'&&<><div className="registration-fields">
        {([['diarize','화자 분리','Speaker diarization'],['tag_audio_events','음성 외 소리 태그','Audio event tags'],['no_verbatim','말버릇·추임새 정리','Remove fillers']] as const).filter(([key])=>key!=='no_verbatim'||modelId==='elevenlabs/scribe-v2').map(([key,ko,en])=><label key={key}>{t(ko,en)}<select value={value[key]===undefined?'':String(value[key])} onChange={e=>update({[key]:e.target.value===''?undefined:e.target.value==='true'})}><option value="">{t('제공사 기본값','Provider default')}</option><option value="true">true</option><option value="false">false</option></select></label>)}
        <label>{t('화자 수','Speaker count')}<input type="number" min={1} max={32} step={1} value={typeof value.num_speakers==='number'?value.num_speakers:''} onChange={e=>update({num_speakers:number(e.target.value)})}/></label>
        <label>{t('화자 분리 임계값','Diarization threshold')}<input type="number" min={0.1} max={0.4} step="any" value={typeof value.diarization_threshold==='number'?value.diarization_threshold:''} onChange={e=>update({diarization_threshold:number(e.target.value)})}/></label>
        <label>seed<input type="number" min={0} max={2147483647} step={1} value={typeof value.seed==='number'?value.seed:''} onChange={e=>update({seed:number(e.target.value)})}/></label>
      </div><span className="hint">{t('화자 수·임계값은 화자 분리를 켜고 하나만 지정하세요. OpenRouter는 이 모델의 용어(keyterms)·맥락 주입을 전달하지 않아요.','Speaker count or threshold requires diarization; choose one. OpenRouter does not forward keyterms or context hints for this model.')}</span></>}
    </fieldset>;
}
function TestResult({ result: r, current, saved, saving, controller: c }: {
    result: RegistrationTestResult;
    current: boolean;
    saved: boolean;
    saving: boolean;
    controller: AppController;
}) {
    const t = (ko: string, en: string) => copy(c.preferences.uiLanguage, ko, en);
    const states = { success: t('성공', 'Success'), failed: t('실패', 'Failed'), incomplete: t('미완료', 'Incomplete'), cancelled: t('취소', 'Cancelled'), 'outcome-unknown': t('결과 불명', 'Outcome unknown') };
    return <section className="registration-result stack gap12" aria-label={t('테스트 결과', 'Test result')}>
    <strong>{t('테스트 결과', 'Test result')}: {states[r.state]}</strong>
    <span className="hint">{current ? t('현재 설정·입력의 결과', 'Result for current settings and input') : t('이전에 호출한 설정·입력의 결과', 'Result for previously called settings and input')} · {saving ? t('결과 암호화 저장 중…','Encrypting and saving result…') : saved ? t('암호화 저장됨', 'Encrypted and saved') : t('결과 저장 실패 · 재호출 없이 저장을 다시 시도하세요.', 'Result not saved · retry saving without another call.')}</span>
    <span>HTTP {r.status ?? t('미제공', 'unavailable')} · {r.elapsedMs} ms</span>
    <span className="registration-url">{t('요청 모델', 'Requested model')}: {r.requestedModel} · {t('반환 모델', 'Returned model')}: {r.returnedModel ?? t('미제공', 'unavailable')}</span>
    <span>{r.message}</span>
    <pre className="registration-preview">{r.text || t('반환 텍스트 없음', 'No returned text')}</pre>
    <details>
    <summary>{t('사용량 · 마스킹된 원본 응답', 'Usage · redacted raw response')}</summary>
    <pre className="registration-preview">{r.usage ? JSON.stringify(r.usage, null, 2) : t('사용량·비용 미제공', 'Usage and cost unavailable')}</pre>
    <pre className="registration-preview">{r.raw}</pre>
    <pre className="registration-preview">{r.inputSummary}</pre>
    </details>{!saved && !saving && <button type="button" className="align-start" disabled={!c.onRetryRegistrationResult} onClick={() => void c.onRetryRegistrationResult?.().catch(() => { })}>{t('결과 저장 다시 시도', 'Retry saving result')}</button>}</section>;
}
