import type { AppScreen } from '../App';
import type { MeetingProject } from '../domain/types';
import { planChunkRanges } from '../media/prepare';
import { initialSTTChunkIds } from '../transcript/batches';
import type { ModelRegistration } from '../providers/model-registrations';
import { sttInputSupport } from '../providers/model-registrations';
export const copy = (language: 'ko' | 'en', ko: string, en: string) => language === 'en' ? en : ko;
export const steps: readonly { id: AppScreen; ko: string; en: string }[] = [
  { id: 'import', ko: '음성 준비', en: 'Prepare audio' }, { id: 'stt', ko: '전사', en: 'Transcribe' },
  { id: 'minutes', ko: '메모 정리', en: 'Organize memo' },
];
export function memoEntryScreen(project: MeetingProject): AppScreen {
  if (project.minutesRevisions.length || project.minutesRuns.length || project.runs.some(run => run.intent?.kind === 'minutes')) return 'minutes';
  const selected=project.transcriptVersions.find(version=>version.id===project.selectedTranscriptVersionId);
  if (selected?.segments.some(segment=>segment.text.trim()) && !selected.missingRanges.length) return 'minutes';
  if (project.rawTranscripts.length || project.transcriptVersions.length || project.sttBatches?.length || project.runs.some(run=>run.intent?.kind==='stt') || preparedAudioReady(project)) return 'stt';
  return 'import';
}
export function languageHintSummary(mode: 'none'|'single'|'multiple'|undefined, languages:readonly string[], language:'ko'|'en') {
  if(mode===undefined)return copy(language,'전사 모델 선택 후 확인','Choose a transcription model');
  if(mode==='none')return copy(language,'전송 안 함','Not sent');
  if(!languages.length)return copy(language,'자동 감지 · 힌트 없음','Automatic detection · no hint');
  if(mode==='single'&&languages.length>1)return copy(language,'1개 언어만 지원 · 입력 수정 필요','One language supported · edit input');
  return `${languages.join(', ')} · ${mode==='multiple'?copy(language,'복수 언어 힌트','Multiple language hints'):copy(language,'단일 언어 힌트','Single-language hint')}`;
}
export function registeredLanguageHint(model:ModelRegistration|undefined,languages:readonly string[],language:'ko'|'en') {
  return languageHintSummary(model?sttInputSupport(model).languageMode:undefined,languages,language);
}
export { memoIcons } from '../settings/icons';
export { defaultMeetingColors as meetingColors, defaultSpokenLanguages as languages } from '../settings/lists';
export function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`; }
export function formatTime(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
export function savedChunkIds(project: MeetingProject) {
  return new Set(project.rawTranscripts.filter(raw => project.runs.some(run => run.id === raw.runId && run.state === 'saved' && run.checkpoint?.projectId === project.id && run.checkpoint.runId === run.id)).map(raw => raw.chunkId));
}
export function latestSTTChunkState(project: MeetingProject, id: string, progress: readonly { chunkId: string; state: string }[] = []) {
  const run = [...project.runs].reverse().find(run => run.intent?.kind === 'stt' && run.intent.chunkId === id || project.rawTranscripts.some(raw => raw.chunkId === id && raw.runId === run.id));
  if (run?.state === 'saved' && run.checkpoint?.projectId === project.id && run.checkpoint.runId === run.id && project.rawTranscripts.some(raw => raw.chunkId === id && raw.runId === run.id)) return 'saved';
  return progress.find(chunk => chunk.chunkId === id)?.state ?? run?.state ?? 'queued';
}
export function transcriptionComplete(project: MeetingProject, progress?: readonly { chunkId: string; state: string }[]) {
  const version = project.transcriptVersions.find(version => version.id === project.selectedTranscriptVersionId), saved = savedChunkIds(project);
  return !!(version && version.segments.some(segment => segment.text.trim()) && !version.missingRanges.length && project.preparedChunks.length && project.preparedChunks.every(chunk => saved.has(chunk.id) && latestSTTChunkState(project, chunk.id, progress) === 'saved'));
}
export function retainedChunks(project: MeetingProject) {
  return project.preparedChunks.filter(chunk => project.retainedAudio?.chunkIds.includes(chunk.id));
}
export function retainedSource(project: MeetingProject) {
  return !!project.sourceAssets[0] && !!project.retainedAudio?.sourceIds.includes(project.sourceAssets[0].id);
}
export function retainedInitialChunkIds(project: MeetingProject) {
  return initialSTTChunkIds(project).filter(id => project.retainedAudio?.chunkIds.includes(id));
}
/** Ready means every planned source range has a durable encoded chunk. */
export function preparedAudioReady(project: MeetingProject) {
  const source = project.sourceAssets[0];
  if (!source) return false;
  try {
    return planChunkRanges(source.durationMs, project.audioOptions).every(range => retainedChunks(project).some(chunk =>
      chunk.sourceId === source.id && chunk.sourceStartMs === range.sourceStartMs && chunk.sourceEndMs === range.sourceEndMs &&
      chunk.encodedBytes > 0 && !!chunk.audioRecordId));
  } catch { return false; }
}
