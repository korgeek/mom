export type MediaErrorCode = 'unsupported-container' | 'unsupported-codec' | 'unsupported-layout' | 'unsupported-browser' | 'damaged-input' | 'no-audio-track' | 'unsupported-options' | 'encoded-too-large' | 'media-limit' | 'worker-unavailable' | 'busy';
export class MediaError extends Error {
  constructor(public readonly code: MediaErrorCode, message: string) { super(message); this.name = 'MediaError'; }
}

// Fixed, allowlisted messages only. Parser/decoder messages may contain file data.
const guidance: Record<MediaErrorCode, readonly [string, string]> = {
  'unsupported-container': ['MP3, PCM16 WAV 또는 AAC-LC M4A 음성 파일을 선택하세요. 영상·Ogg는 지원하지 않아요.', 'Select MP3, PCM16 WAV or AAC-LC M4A audio. Video and Ogg are not supported.'],
  'unsupported-codec': ['이 음성 코덱은 지원하지 않아요. ALAC·HE-AAC 파일은 AAC-LC M4A, MP3 또는 PCM16 WAV로 다시 내보내세요. 모노·스테레오, 16/44.1/48 kHz를 지원해요.', 'This audio codec is unsupported. Re-export ALAC or HE-AAC as AAC-LC M4A, MP3 or PCM16 WAV. Mono/stereo at 16/44.1/48 kHz is supported.'],
  'unsupported-layout': ['M4A 메타데이터 또는 트랙·시간 배치는 현재 지원하지 않아요. 원본 앱에서 단일 음성 트랙의 AAC-LC M4A, MP3 또는 PCM16 WAV로 다시 내보내세요.', 'This M4A metadata, track or timing layout is unsupported. Re-export a single audio track as AAC-LC M4A, MP3 or PCM16 WAV from the original app.'],
  'unsupported-browser': ['이 브라우저에서 AAC 로컬 디코딩을 사용할 수 없어요. AAC를 지원하는 최신 브라우저를 사용하거나 MP3 또는 PCM16 WAV로 다시 내보내세요.', 'Local AAC decoding is unavailable in this browser. Use a current browser with AAC WebCodecs support, or re-export as MP3 or PCM16 WAV.'],
  'damaged-input': ['음성 파일의 헤더·샘플·시간 정보가 손상되었거나 잘렸어요. 원본 앱에서 파일을 다시 내보낸 뒤 선택하세요.', 'The audio headers, samples or timing are damaged or truncated. Re-export the file from the original app and select it again.'],
  'no-audio-track': ['파일에 디코딩할 음성 트랙이 없어요. 음성이 포함된 지원 파일을 선택하세요.', 'The file has no decodable audio track. Select a supported file containing audio.'],
  'unsupported-options': ['5/10/15분 청크, 5/10/15초 겹침과 16 kHz 모노 MP3 24/32/48 kbps를 선택하세요.', 'Use 5/10/15 minute chunks, 5/10/15 second overlap and 16 kHz mono MP3 at 24/32/48 kbps.'],
  'encoded-too-large': ['실제 인코딩 파일이 제공사 용량 한도를 넘어요. 낮은 비트레이트 또는 10분 청크를 선택하세요.', 'The actual encoded audio exceeds the provider safety limit. Choose a lower bitrate or 10 minute chunks.'],
  'media-limit': ['M4A 메타데이터 또는 샘플 수가 로컬 처리 한도를 넘어요. 원본 앱에서 더 짧은 파일로 나누거나 MP3 또는 PCM16 WAV로 다시 내보내세요.', 'M4A metadata or sample count exceeds the local processing limit. Split it into shorter files in the original app, or re-export as MP3 or PCM16 WAV.'],
  'worker-unavailable': ['로컬 음성 작업자를 사용할 수 없어요. 최신 브라우저에서 새로고침한 뒤 다시 시도하세요.', 'The local audio Worker is unavailable. Reload in a current browser and retry.'],
  busy: ['다른 음성 준비 작업이 진행 중이에요. 기다리거나 취소하세요.', 'Another audio preparation job is running. Wait or cancel it first.'],
};
export function mediaFailureMessage(error: MediaError, language: 'ko' | 'en'): string | undefined {
  return Object.prototype.hasOwnProperty.call(guidance, error.code) ? guidance[error.code][language === 'en' ? 1 : 0] : undefined;
}
