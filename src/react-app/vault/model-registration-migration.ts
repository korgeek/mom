import type { ModelRegistry } from '../domain/types';
import { getSTTModel } from '../providers/catalog';
import { registryRouteKey } from '../providers/model-registry';
import { normalizeRegistrations, registrationEndpoint, registrationSignature, validateRegistration, type ApiCredential, type ModelRegistration, type NormalizedModelRegistrations } from '../providers/model-registrations';
import { lookupRouterSTTProfile } from '../providers/stt-catalog';

export type SessionKeyTransfer = Readonly<{ sourceNamespace: string; targetId: string }>;
/** Pure migration plan; the caller commits catalog and secret values together. */
export function migrateModelRegistrations(
    raw: unknown, registry: ModelRegistry | undefined, secrets: Readonly<Record<string, string>>,
    sessionNamespaces: ReadonlySet<string>, makeId: () => string = () => crypto.randomUUID(),
): { changed: boolean; registrations: NormalizedModelRegistrations; values: Record<string, string>; sessionTransfers: SessionKeyTransfer[] } {
    const current = normalizeRegistrations(raw), values: Record<string, string> = Object.assign(Object.create(null), secrets), sessionTransfers: SessionKeyTransfer[] = [];
    if ((raw as { version?: number } | undefined)?.version === 2) return { changed: false, registrations: current, values, sessionTransfers };
    const entries: ModelRegistration[] = current.entries.map(entry => {
        const { lastTest, ...settings } = entry;
        const next: ModelRegistration = { ...settings, enabled: false, keyStorage: sessionNamespaces.has('registration:' + entry.id) ? 'session' : 'encrypted' };
        return { ...next, ...(lastTest?.signature === registrationSignature(next) ? { lastTest } : {}) };
    });
    const ids = new Set(entries.map(entry => entry.id)), legacyRouteIds = { ...current.legacyRouteIds }, defaults = { ...current.defaults };
    for (const entry of registry?.entries ?? []) {
        const route = entry.route, key = registryRouteKey(route);
        let id: string | undefined;
        for (let attempts = 0; attempts < 1000; attempts++) {
            const candidate = makeId();
            if (!ids.has(candidate)) { id = candidate; break; }
        }
        if (!id) throw Error('Unable to allocate model identity');
        ids.add(id); legacyRouteIds[key] = id;
        const stage = route.stage === 'stt' ? 'stt' : 'llm', baseUrl = route.provider === 'openai' ? 'https://api.openai.com/v1' : 'https://openrouter.ai/api/v1';
        const metadata = entry.acceptedMetadata, policy = registry?.openRouterSTT?.[route.connectionId];
        // Legacy execution reads provider namespaces, never arbitrary connection IDs.
        const sourceNamespace = route.provider, session = sessionNamespaces.has(sourceNamespace), hasKey = session || Object.prototype.hasOwnProperty.call(values, sourceNamespace);
        let stt: ModelRegistration['stt'] | undefined;
        if (stage === 'stt' && route.provider === 'openai') {
            try {
                const model = getSTTModel(route.modelId);
                stt = {
                    formats: ['mp3', 'wav'], responseFormat: model.responseFormat, maxBytes: model.maxBytes,
                    languageMode: model.languageHints === 'multiple' ? 'multiple' : model.languageHints === 'single-and-prompt' ? 'single' : 'none',
                    termMode: model.languageHints === 'single-and-prompt' ? 'prompt' : 'none', timestamps: model.responseFormat === 'verbose_json' ? 'segment' : 'none',
                };
            } catch { stt = {}; }
        } else if (stage === 'stt') {
            const profile = lookupRouterSTTProfile('openrouter-stt-json:' + route.modelId, route.modelId);
            stt = {
                responseFormat: 'json', languageMode: profile?.singleLanguageHint ? 'single' : 'none', termMode: 'none', timestamps: 'none',
                routerRequireZdr: policy?.policy.requireZdr !== false, ...(profile ? { formats: ['mp3', 'wav'], maxBytes: profile.maxAudioBytes } : {}),
            };
        }
        const model = validateRegistration({
            id, stage, name: entry.alias ?? metadata?.name ?? entry.observedMetadata.name, baseUrl,
            endpointUrl: baseUrl + (stage === 'stt' ? '/audio/transcriptions' : '/chat/completions'), adapter: route.provider,
            ...(route.provider === 'openrouter' && stage === 'llm' && route.endpointTag ? { routerEndpointTag: route.endpointTag } : {}),
            enabled: entry.userEnabled, revision: 0, modelId: route.modelId, auth: 'bearer', keyStorage: session ? 'session' : 'encrypted',
            credentialOrigin: hasKey ? new URL(baseUrl).origin : null, credentialVersion: hasKey ? 1 : 0,
            ...(metadata ? { catalogEvidence: metadata } : {}),
            ...(route.provider === 'openrouter' ? { routerPolicy: { requireZdr: policy?.policy.requireZdr !== false, acknowledged: policy?.acknowledgedDisclosureVersion === 'or-stt-1' } } : {}),
            ...(stt ? { stt } : { llm: {
                ...(metadata?.completionParameter ? { tokenField: metadata.completionParameter } : {}),
                ...(metadata?.limits.contextTokens ? { contextTokens: metadata.limits.contextTokens } : {}),
                ...(metadata?.limits.maxOutputTokens ? { maxTokens: metadata.limits.maxOutputTokens } : {}),
            } }),
        });
        entries.push(model);
        if (session) sessionTransfers.push({ sourceNamespace, targetId: id });
        else if (hasKey) values['registration:' + id] = values[sourceNamespace];
        if (registry?.defaults[route.stage] === key) defaults[stage] = id;
    }
    // Validate the combined capacity and every generated identity before any write.
    const registrations = normalizeRegistrations({ version: 2, entries, defaults, legacyRouteIds });
    return { changed: true, registrations, values, sessionTransfers };
}

/** Upgrade registered key namespaces without persisting session-only sources. */
export function migrateRegistrationCredentials(
    registrations: NormalizedModelRegistrations, secrets: Readonly<Record<string,string>>, sessionNamespaces: ReadonlySet<string>,
    legacyTransfers: readonly SessionKeyTransfer[] = [],
): {registrations:NormalizedModelRegistrations;values:Record<string,string>;credentialTransfers:Readonly<{sourceNamespace:string;targetNamespace:string}>[]} {
    const values:Record<string,string>=Object.assign(Object.create(null),secrets),credentials:ApiCredential[]=[...registrations.credentials],credentialTransfers:{sourceNamespace:string;targetNamespace:string}[]=[];
    const sessionSources=new Map<string,string>();
    const entries=registrations.entries.map(entry=>{
        if(entry.credentialId||entry.auth==='none')return entry;
        const origin=new URL(registrationEndpoint(entry)).origin;
        if(entry.credentialOrigin!==origin)return entry;
        const namespace='registration:'+entry.id,source=legacyTransfers.find(t=>t.targetId===entry.id)?.sourceNamespace??namespace;
        const session=sessionNamespaces.has(source)||entry.keyStorage==='session',mode=session?'session':'encrypted';
        const value=values[namespace]??null;
        let credential=credentials.find(c=>c.origin===origin&&c.keyStorage===mode&&(session?sessionSources.get(c.id)===source:value!==null&&values['credential:'+c.id]===value));
        if(!credential){
            let id=crypto.randomUUID();while(credentials.some(c=>c.id===id))id=crypto.randomUUID();
            credential={id,name:entry.name,origin,keyStorage:mode,version:entry.credentialVersion};credentials.push(credential);
            if(session){sessionSources.set(id,source);if(sessionNamespaces.has(source))credentialTransfers.push({sourceNamespace:source,targetNamespace:'credential:'+id});}
            else if(value!==null)values['credential:'+id]=value;
        }
        delete values[namespace];
        const {lastTest:_lastTest,...settings}=entry;void _lastTest;
        return {...settings,credentialId:credential.id,keyStorage:credential.keyStorage,credentialVersion:credential.version,revision:(entry.revision??0)+1};
    });
    return {registrations:normalizeRegistrations({...registrations,entries,credentials}),values,credentialTransfers};
}
