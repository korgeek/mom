import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import type { MinutesRevision } from "../domain/types";

const parser = new MarkdownIt({ html: false, linkify: false, typographer: false });
parser.renderer.rules.image = (tokens, index) => parser.utils.escapeHtml(tokens[index].content);
// Meeting-derived URLs are visible text only; preview cannot navigate or fetch them.
parser.renderer.rules.link_open = () => "<span>";
parser.renderer.rules.link_close = () => "</span>";

export function safeMarkdownPreview(markdown: string): string {
 if (typeof window === "undefined") throw new Error("Markdown preview requires a browser document");
 const purifier = DOMPurify(window);
 if (!purifier.isSupported) throw new Error("Safe Markdown preview is unavailable in this browser");
 return purifier.sanitize(parser.render(markdown), {
  ALLOWED_TAGS: ["p", "br", "em", "strong", "s", "blockquote", "ul", "ol", "li", "pre", "code", "h1", "h2", "h3", "h4", "h5", "h6", "table", "thead", "tbody", "tr", "th", "td", "hr", "span"],
  ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
 });
}
function requireOutput(revision: MinutesRevision): void {
 if (!revision.markdown.trim()) throw new Error("Cannot export empty Markdown");
}
function filename(title: string): string {
 const cleaned = [...title.replace(/[\\/:*?"<>|]|\p{Cc}/gu, "_").trim().replace(/[. ]+$/u, "")].slice(0, 120).join("") || "meeting";
 const portable = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(cleaned) ? `_${cleaned}` : cleaned;
 return `${portable}.md`;
}

/** Plaintext outside the vault; the UI must invoke this only on an explicit click. */
export function downloadMarkdown(revision: MinutesRevision, title: string): void {
 requireOutput(revision);
 if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") throw new Error("Markdown download is unavailable in this browser");
 const blob = new Blob([revision.markdown], { type: "text/markdown;charset=utf-8" });
 let url: string | null = null; const anchor = document.createElement("a");
 try {
  url = URL.createObjectURL(blob); anchor.href = url; anchor.download = filename(title);
  document.body.append(anchor); anchor.click();
 } catch { throw new Error("Could not initiate Markdown download"); }
 finally {
  anchor.remove();
  if (url !== null) { const releasedUrl = url; setTimeout(() => URL.revokeObjectURL(releasedUrl), 0); }
 }
}

/** Resolves only after Clipboard API success; no DOM/execCommand fallback. */
export async function copyMarkdown(revision: MinutesRevision): Promise<void> {
 requireOutput(revision);
 if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable in this browser");
 try { await navigator.clipboard.writeText(revision.markdown); }
 catch { throw new Error("Could not copy Markdown to the clipboard"); }
}
