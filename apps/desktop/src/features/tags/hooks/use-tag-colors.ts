import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { tagKey } from "@typenotes/shared/tags";
import { useTags } from "./tags-context";
import { tagColorsKey } from "../lib/tag-colors";
export function useTagColors(editor: Editor | null) {
  const { tags } = useTags();
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(tagColorsKey, new Map(tags.map(tag => [tagKey(tag.name), tag.color]))).setMeta("addToHistory", false));
  }, [editor, tags]);
}
