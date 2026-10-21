import type { TranscriptionHints } from './types';

export function validateTranscriptionHints(value: TranscriptionHints | undefined): void {
  if (value === undefined) return;
  if (!value || !Array.isArray(value.terms) || value.terms.length > 50 || value.terms.some(term => typeof term !== 'string' || !term.trim() || term.length > 100 || Array.from(term).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) || typeof value.context !== 'string' || value.context.length > 2000 || Array.from(value.context).some(char => char.charCodeAt(0) < 32 && ![9,10,13].includes(char.charCodeAt(0)) || char.charCodeAt(0) === 127)) throw new Error('Invalid transcription hints');
}
