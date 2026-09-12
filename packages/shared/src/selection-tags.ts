import { validTagName, validTagColor } from "./tags";
export { tagKey, DEFAULT_TAG_COLOR } from "./tags";
import { tagKey } from "./tags";
export type SelectionTag = { name: string; color: string };
export const validTag = (value: unknown): value is SelectionTag => {
  if (!value || typeof value !== "object") return false;
  const tag = value as SelectionTag;
  return validTagName(tag.name) && validTagColor(tag.color);
};

export function mergeTag(tags: SelectionTag[], tag: SelectionTag): SelectionTag[] {
  return [...tags.filter((entry) => tagKey(entry.name) !== tagKey(tag.name)), tag];
}
