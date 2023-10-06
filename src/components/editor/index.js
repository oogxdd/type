import React, { useState, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import suggestion from "./suggestion";

export const EditorComponent = () => {
  const [suggestionLevel, setSuggestionLevel] = useState(1);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion,
      }),
    ],
    content: "<p>Hello World! 🌍️</p>",
  });

  const handleKeyDown = useCallback((event) => {
    if (event.key === "Tab") {
      // console.l
      event.preventDefault();
    }
    if (event.key === "ArrowRight") {
      setSuggestionLevel((level) => Math.min(level + 1, 5));
    }
    if (event.key === "ArrowLeft") {
      setSuggestionLevel((level) => Math.max(level - 1, 0));
    }
  }, []);

  console.log(suggestionLevel);

  return (
    <div>
      <EditorContent editor={editor} onKeyDown={handleKeyDown} />
    </div>
  );
};

export default EditorComponent;
