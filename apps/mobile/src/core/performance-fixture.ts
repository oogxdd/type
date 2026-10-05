import { requireOptionalNativeModule } from "expo-modules-core";

type FixtureModule = {
  performanceFixture?(): { root: string; count: number; delayMs: number } | null;
  preparePerformanceFixture?(root: string, count: number): Promise<void>;
};
const native = requireOptionalNativeModule<FixtureModule>("BackgroundTask");
let delayMs = 0;
export const runWithFixtureDelay = async <T>(method: string, run: () => Promise<T>): Promise<T> => {
  if (delayMs && ["createNote", "writeNoteChecked", "listNoteSummaries"].includes(method)) {
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }
  return run();
};

/** Native checks the bundle ID and UUID; JS cannot redirect the fixture root. */
export const preparePerformanceFixture = async () => {
  const fixture = native?.performanceFixture?.();
  if (!fixture) return null;
  delayMs = fixture.delayMs;
  await native!.preparePerformanceFixture!(fixture.root, fixture.count);
  return { appData: `${fixture.root}/app`, documents: `${fixture.root}/documents`, notes: `${fixture.root}/documents/notes` };
};
