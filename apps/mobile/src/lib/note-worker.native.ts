import { createWorkletRuntime, runOnRuntimeAsync } from "react-native-worklets";
import { processNoteJob, type NoteJob, type FeedJob } from "./note-processing";
import { NoteJobScheduler } from "./note-job-scheduler";

let runtime: ReturnType<typeof createWorkletRuntime> | undefined;
const scheduler = new NoteJobScheduler(async (job) => {
  runtime ??= createWorkletRuntime({ name: "type-note-processing" });
  return runOnRuntimeAsync(runtime, processNoteJob, job);
});
export const runNoteJob = (job: NoteJob | FeedJob) => scheduler.run(job);
