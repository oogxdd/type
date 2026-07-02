import { invokeLogged } from "@/shared/api/invoke";
import type {
  HandwritingAttachmentWriteResult,
  HandwritingOcrListResult,
  HandwritingOcrQueueResult,
  NoteFileNameFormat,
} from "@typenotes/shared/types";

export const saveHandwritingAttachment = (
  imageBase64: string,
  mimeType?: string,
  fileName?: string,
  folderPath?: string,
  noteFileNameFormat?: NoteFileNameFormat
): Promise<HandwritingAttachmentWriteResult> =>
  invokeLogged<HandwritingAttachmentWriteResult>("save_handwriting_attachment", {
    args: {
      image_base64: imageBase64,
      mime_type: mimeType,
      file_name: fileName,
      folder_path: folderPath,
      file_name_format: noteFileNameFormat,
    },
  });

export const queueHandwritingOcr = (
  provider: "openai" | "huggingface",
  apiKey: string,
  model: string
): Promise<HandwritingOcrQueueResult> =>
  invokeLogged<HandwritingOcrQueueResult>("queue_handwriting_ocr", {
    args: {
      provider,
      api_key: apiKey,
      model,
    },
  });

export const listHandwritingOcrJobs = (): Promise<HandwritingOcrListResult> =>
  invokeLogged<HandwritingOcrListResult>("list_handwriting_ocr_jobs");
