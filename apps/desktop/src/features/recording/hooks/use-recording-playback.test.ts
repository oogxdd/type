// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useRecordingPlayback } from "./use-recording-playback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const container = document.createElement("div");
const root = createRoot(container);
function Player({ note, audio, resolve }: {
  note: string; audio: string | null; resolve: (path: string) => Promise<string>;
}) {
  const { src, error } = useRecordingPlayback(note, audio, resolve);
  return createElement("div", null, src ? createElement("audio", { src }) : null, error);
}
afterEach(async () => { await act(async () => root.render(null)); });

it("removes the old player when the next note's audio is missing or fails to load", async () => {
  const resolve = vi.fn().mockResolvedValueOnce("asset://first.m4a").mockRejectedValueOnce(new Error("missing"));
  await act(async () => root.render(createElement(Player, { note: "one", audio: "first.m4a", resolve })));
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("asset://first.m4a");
  await act(async () => root.render(createElement(Player, { note: "two", audio: "missing.m4a", resolve })));
  expect(container.querySelector("audio")).toBeNull();
  expect(container.textContent).toContain("not available");
  await act(async () => root.render(createElement(Player, { note: "three", audio: null, resolve })));
  expect(container.querySelector("audio")).toBeNull();
});

it("ignores an old note's resolution after switching to another recording", async () => {
  let finish!: (src: string) => void;
  const resolve = vi.fn().mockReturnValueOnce(new Promise<string>((done) => { finish = done; }))
    .mockResolvedValueOnce("asset://second.m4a");
  await act(async () => root.render(createElement(Player, { note: "one", audio: "first.m4a", resolve })));
  await act(async () => root.render(createElement(Player, { note: "two", audio: "second.m4a", resolve })));
  await act(async () => finish("asset://first.m4a"));
  expect(container.querySelector("audio")?.getAttribute("src")).toBe("asset://second.m4a");
});
