import { createWorkletRuntime, runOnRuntimeAsync } from "react-native-worklets";
import { processNoteJob, type NoteJob, type FeedJob } from "./note-processing";

let runtime: ReturnType<typeof createWorkletRuntime> | undefined;
export const runNoteJob = (job: NoteJob | FeedJob) => {
  runtime ??= createWorkletRuntime({ name: "type-note-processing" });
  return runOnRuntimeAsync(runtime, processNoteJob, job);
};
