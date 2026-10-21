// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MinutesRevision } from "../src/react-app/domain/types";
import { copyMarkdown, downloadMarkdown, safeMarkdownPreview } from "../src/react-app/minutes/output";

const revision: MinutesRevision = { id: "revision-2", runId: "run-1", parentId: "revision-1", markdown: "  # Edited 회의록\n\n- [ ] No owner assigned\n" };
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("safe Markdown preview", () => {
 it("renders headings/tables while disabling raw HTML, scripts, styles and image fetches", () => {
  const html = safeMarkdownPreview('# Minutes\n\n| Topic | State |\n| --- | --- |\n| Release | cancelled |\n\n<script>alert(1)</script><style>body{display:none}</style><iframe src="https://provider.invalid"></iframe>\n\n![meeting](https://provider.invalid/private.png)');
  const surface = document.createElement("div"); surface.innerHTML = html;
  expect(surface.querySelector("h1")?.textContent).toBe("Minutes");
  expect(surface.querySelector("td")?.textContent).toBe("Release");
  expect(surface.querySelector("script,style,img,iframe,object,input")).toBeNull();
 });

 it("keeps all meeting-derived links inert including unsafe URL schemes", () => {
  const html = safeMarkdownPreview('[unsafe](javascript:alert(1)) [data](data:text/html,evil) [network](https://provider.invalid/private) [relative](/private)');
  const surface = document.createElement("div"); surface.innerHTML = html;
  expect(surface.querySelector("[href],[src],[style],[onclick]")).toBeNull();
  expect(surface.textContent).toContain("network");
 });
});

describe("selected Markdown output", () => {
 it("copies the exact edited revision without normalization or run metadata", async () => {
  const writes: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText(text: string) { writes.push(text); } } });
  await copyMarkdown(revision);
  expect(writes).toEqual(["  # Edited 회의록\n\n- [ ] No owner assigned\n"]);
 });

 it("propagates clipboard denial and unsupported environments without a success result", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { async writeText() { throw new DOMException("Denied", "NotAllowedError"); } } });
  await expect(copyMarkdown(revision)).rejects.toThrow(/copy/i);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  await expect(copyMarkdown(revision)).rejects.toThrow(/clipboard/i);
 });

 it("downloads UTF-8 edited Markdown with a safe filename and revokes the blob URL", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }); let captured!: Blob; let clickedName = "";
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn((blob: Blob) => { captured = blob; return "blob:keyless-test"; }) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clickedName = this.download; });
  downloadMarkdown(revision, "회의/제목\u0000?");
  expect(clickedName).toBe("회의_제목__.md");
  expect(captured.type).toBe("text/markdown;charset=utf-8");
  // jsdom Blob has no text(); inspect its bytes through the actual browser FileReader.
  const text = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(captured, "UTF-8"); });
  expect(text).toBe(revision.markdown);
  vi.runOnlyPendingTimers(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:keyless-test");
  expect(document.querySelector("a[download]")).toBeNull();
 });

 it("releases download resources when initiation fails", () => {
  vi.useFakeTimers();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:keyless-failed") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => { throw new Error("download denied"); });
  expect(() => downloadMarkdown(revision, "CON")).toThrow(/download/i);
  vi.runOnlyPendingTimers(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:keyless-failed");
  expect(document.querySelector("a[download]")).toBeNull();
 });

 it("rejects empty output before clipboard or download work", async () => {
  const empty = { ...revision, markdown: "   " };
  await expect(copyMarkdown(empty)).rejects.toThrow(/empty/i);
  expect(() => downloadMarkdown(empty, "meeting")).toThrow(/empty/i);
 });
});
