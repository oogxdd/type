// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagsProvider, useTags } from "./tags-context";
import { readTagRegistry, writeTagRegistry } from "../api/tags-api";

const profile = vi.hoisted(() => ({ root: "/a" }));
vi.mock("@/features/profiles/hooks/profiles-context", () => ({ useProfiles: () => ({ activeProfileNotesRoot: profile.root }) }));
vi.mock("../api/tags-api", () => ({ readTagRegistry: vi.fn(), writeTagRegistry: vi.fn() }));
let value: ReturnType<typeof useTags>;
let mount: HTMLElement;
let root: Root;
const tag = { name: "work", color: "#123456" };
function Probe() { value = useTags(); return createElement("p", null, value.tags.map(tag => tag.name).join(",")); }
async function render() { await act(async () => root.render(createElement(TagsProvider, null, createElement(Probe)))); }
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  profile.root = "/a";
  vi.resetAllMocks();
  vi.mocked(readTagRegistry).mockResolvedValue({ version: 1, tags: [] });
  vi.mocked(writeTagRegistry).mockResolvedValue(undefined);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); });
it("does not apply a late registry load from the previous working folder", async () => {
  let finish!: (value: { version: 1; tags: typeof tag[] }) => void;
  vi.mocked(readTagRegistry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  profile.root = "/b"; await render();
  await act(async () => finish({ version: 1, tags: [tag] }));
  expect(value.tags).toEqual([]);
  expect(value.loading).toBe(false);
});
it("writes to the expected root and replaces colors globally in the registry", async () => {
  await render();
  await act(async () => value.save([tag]));
  expect(writeTagRegistry).toHaveBeenCalledWith("/a", { version: 1, tags: [tag] });
  expect(value.tags).toEqual([tag]);
  await act(async () => value.save([]));
  expect(value.tags).toEqual([]);
});
it("loads the new root even while an old-root save is pending", async () => {
  await render();
  let finish!: () => void;
  vi.mocked(writeTagRegistry).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let saved!: Promise<void>;
  await act(async () => { saved = value.save([tag]); });
  profile.root = "/b"; await render();
  await act(async () => { finish(); await saved; });
  expect(value.tags).toEqual([]);
  expect(value.loading).toBe(false);
});
it("reloads after sync and reports invalid registry reads without overwriting them", async () => {
  await render();
  vi.mocked(readTagRegistry).mockResolvedValueOnce({ version: 1, tags: [tag] });
  await act(async () => window.dispatchEvent(new Event("tag-registry-invalidated")));
  expect(value.tags).toEqual([tag]);
  vi.mocked(readTagRegistry).mockRejectedValueOnce(new Error("Invalid registry"));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(value.error).toContain("Invalid registry");
  await expect(value.save([])).rejects.toThrow("not ready");
  expect(writeTagRegistry).not.toHaveBeenCalled();
});
