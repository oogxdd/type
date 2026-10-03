// Web/test fallback; Metro resolves note-worker.native.ts on iOS/Android.
import { processNoteJob, type NoteJob, type FeedJob } from "./note-processing";
export const runNoteJob = async (job: NoteJob | FeedJob) => processNoteJob(job);
