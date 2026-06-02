import { invoke } from "@tauri-apps/api/core";

const LOG_PREFIX = "[notes]";
const SENSITIVE_PATTERN = /(password|token|secret|api.?key|authorization)/i;

const MAX_LOGGED_STRING = 200;

const sanitizeForLog = (value: unknown): unknown => {
  if (typeof value === "string" && value.length > MAX_LOGGED_STRING) {
    return `${value.slice(0, MAX_LOGGED_STRING)}… <${value.length} chars>`;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeForLog);
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, nested]) => {
      if (SENSITIVE_PATTERN.test(key)) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = sanitizeForLog(nested);
      }
    });
    return next;
  }
  return value;
};

export const invokeLogged = async <T,>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  console.groupCollapsed(`${LOG_PREFIX} invoke ${command}`);
  if (args) {
    console.log("args", sanitizeForLog(args));
  }
  try {
    const result = await invoke<T>(command, args);
    console.log("result", sanitizeForLog(result));
    console.groupEnd();
    return result;
  } catch (error) {
    console.error("error", error);
    console.groupEnd();
    throw error;
  }
};

export const logGroup = (label: string, data?: Record<string, unknown>) => {
  console.groupCollapsed(`${LOG_PREFIX} ${label}`);
  if (data) {
    console.log(data);
  }
  console.groupEnd();
};
