import type { MeetingProject } from '../domain/types';
import { aggregateProjectUsage, type UsageHistoryItem } from './statement';

export const PAGE_SIZE = 15;
export function currentPage(page: number, total: number) { return Math.min(page, Math.max(1, Math.ceil(total / PAGE_SIZE))); }

/** Missing timestamps retain their saved order and never borrow memo edit times. */
export function newestFirst<T>(items: readonly T[], date: (item: T) => string | null): T[] {
  const timestamp = (item: T) => { const value = date(item); const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : -Infinity; };
  return [...items].sort((a, b) => { const left = timestamp(a); const right = timestamp(b); return left === right ? 0 : left > right ? -1 : 1; });
}
export function projectHistory(project: MeetingProject): UsageHistoryItem[] {
  return newestFirst([
    ...aggregateProjectUsage(project).items,
    ...(project.processingArchives ?? []).flatMap(archive => archive.items.map(item => ({ ...item, archivedAt: archive.resetAt }))),
  ], item => item.date);
}
