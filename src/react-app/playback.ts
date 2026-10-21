export type PlaybackState = Readonly<{
  projectId: string; chunkId: string; kind: 'chunk' | 'segment';
  state: 'loading' | 'playing' | 'paused' | 'error';
}>;
export type PlaybackTarget = Omit<PlaybackState, 'state'> & Readonly<{ startSeconds: number; endSeconds?: number }>;
type Entry = {
  generation: number; target: PlaybackTarget; abort: AbortController; desired: boolean;
  audio: HTMLAudioElement | null; url: string | null; playAttempt: number;
  cleanup: (() => void)[];
};

// One transient player, separate from provider job cancellation and busy state.
export function createPlayback(options: {
  urls: { create(blob: Blob): string; revoke(url: string): void };
  onChange(state: PlaybackState | null): void;
  pauseSource(): void;
}) {
  let generation = 0, active: Entry | null = null;
  const current = (entry: Entry) => active === entry && generation === entry.generation && !entry.abort.signal.aborted;
  const publish = (entry: Entry, state: PlaybackState['state']) => {
    if (current(entry)) options.onChange({ projectId: entry.target.projectId, chunkId: entry.target.chunkId, kind: entry.target.kind, state });
  };
  const releaseAudio = (entry: Entry) => {
    for (const cleanup of entry.cleanup.splice(0)) cleanup();
    if (entry.audio) {
      entry.audio.pause();
      try { entry.audio.currentTime = entry.target.startSeconds; } catch { /* No seekable metadata yet. */ }
      entry.audio.removeAttribute('src'); entry.audio.load();
    }
    if (entry.url) options.urls.revoke(entry.url);
    entry.url = null; entry.audio = null;
  };
  const stop = () => {
    generation++;
    const previous = active; active = null;
    if (previous) { previous.abort.abort(); releaseAudio(previous); }
    options.onChange(null);
  };
  const fail = (entry: Entry) => {
    if (!current(entry)) return;
    entry.desired = false;
    releaseAudio(entry); publish(entry, 'error');
  };
  const requestPlay = async (entry: Entry) => {
    if (!current(entry) || !entry.audio || !entry.desired) return;
    const audio = entry.audio;
    const attempt = ++entry.playAttempt;
    try {
      await audio.play();
      // A stopped/superseded play promise can settle after the player was removed.
      if (!current(entry) || !entry.desired) audio.pause();
    } catch {
      if (current(entry) && entry.desired && attempt === entry.playAttempt) fail(entry);
    }
  };
  const play = async (target: PlaybackTarget, read: (signal: AbortSignal, assertActive: () => void) => Promise<Blob>) => {
    if (active?.desired && active.target.projectId === target.projectId && active.target.chunkId === target.chunkId && active.target.kind === 'chunk' && target.kind === 'chunk') return;
    stop(); options.pauseSource();
    const entry: Entry = { generation, target, abort: new AbortController(), desired: true, audio: null, url: null, playAttempt: 0, cleanup: [] };
    active = entry; publish(entry, 'loading');
    const assertActive = () => { if (!current(entry)) throw new DOMException('Playback no longer active', 'AbortError'); };
    try {
      const blob = await read(entry.abort.signal, assertActive); assertActive();
      entry.url = options.urls.create(blob);
      const audio = new Audio(entry.url); entry.audio = audio;
      const listen = (event: string, listener: () => void) => {
        audio.addEventListener(event, listener); entry.cleanup.push(() => audio.removeEventListener(event, listener));
      };
      listen('playing', () => {
        if (!current(entry) || !entry.desired) { audio.pause(); return; }
        options.pauseSource(); publish(entry, 'playing');
      });
      listen('pause', () => {
        // Native events are queued: an older Pause may arrive after Resume has
        // already unpaused this element. Preserve that newer playback intent.
        if (current(entry) && audio.paused) { entry.desired = false; publish(entry, 'paused'); }
      });
      listen('ended', () => { if (current(entry)) stop(); });
      listen('error', () => fail(entry));
      if (target.endSeconds !== undefined) listen('timeupdate', () => { if (current(entry) && audio.currentTime >= target.endSeconds!) stop(); });
      await new Promise<void>((resolve, reject) => {
        const finish = (error?: unknown) => { clearTimeout(timeout); audio.removeEventListener('loadedmetadata', loaded); audio.removeEventListener('error', failed); entry.abort.signal.removeEventListener('abort', aborted); if (error) reject(error); else resolve(); };
        const loaded = () => finish();
        const failed = () => finish(new Error('Playback failed'));
        const aborted = () => finish(new DOMException('Playback no longer active', 'AbortError'));
        const timeout = setTimeout(() => finish(new Error('Playback metadata unavailable')), 10000);
        audio.addEventListener('loadedmetadata', loaded); audio.addEventListener('error', failed); entry.abort.signal.addEventListener('abort', aborted, { once: true });
        entry.cleanup.push(() => finish(new DOMException('Playback no longer active', 'AbortError')));
        if (audio.readyState >= 1) loaded();
      });
      assertActive(); audio.currentTime = target.startSeconds;
      await requestPlay(entry);
    } catch { if (current(entry)) fail(entry); }
  };
  const matches = (projectId: string, chunkId: string) => active?.target.kind === 'chunk' && active.target.projectId === projectId && active.target.chunkId === chunkId;
  return {
    play, stop,
    pause(projectId: string, chunkId: string) {
      if (!active || !matches(projectId, chunkId) || !active.audio) return;
      active.desired = false; active.playAttempt++; active.audio.pause();
    },
    resume(projectId: string, chunkId: string) {
      if (!active || !matches(projectId, chunkId) || !active.audio || active.desired) return;
      active.desired = true; options.pauseSource(); publish(active, 'loading'); void requestPlay(active);
    },
  };
}
