import { modelIdentity, modelOptionLabel, type CatalogChoice } from '../providers/model-presentation';
import { copy } from './copy';

export default function ModelIdentity({ id, name = id, provider, requestedEndpoint, requestedProvider, returnedModel, actualProvider, result = false, language }: {
  id: string; name?: string; provider: CatalogChoice['provider']; requestedEndpoint?: string | null; requestedProvider?: string | null;
  returnedModel?: string | null; actualProvider?: string | null; result?: boolean; language: 'ko' | 'en';
}) {
  const t = (ko: string, en: string) => copy(language, ko, en); const unknown = t('확인 불가', 'Unknown');
  const identity = modelIdentity(id, provider, name);
  const endpoint = requestedEndpoint ? `${requestedProvider && requestedProvider !== requestedEndpoint ? `${requestedProvider} · ` : ''}${requestedEndpoint}` : unknown;
  return <div className="model-identity stack">
    <span className="mono model-route">{modelOptionLabel({ id, label: name, provider, enabled: true }, language)}</span>
    <span className="hint">{t('모델 제작자', 'Model creator')}: {identity.creator ?? unknown}</span>
    <span className="hint">{t('요청 실행 엔드포인트', 'Requested execution endpoint')}: {endpoint}</span>
    {result && <><span className="mono">{t('반환 모델', 'Returned model')}: {returnedModel ?? unknown}</span><span className="hint">{t('응답에 보고된 실행 제공사', 'Reported execution provider')}: {actualProvider ?? unknown}</span></>}
  </div>;
}
