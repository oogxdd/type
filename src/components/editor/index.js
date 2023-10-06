import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";

import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import ChatDialoguePlugin from "@/commands/chat";

export const EditorComponent = () => {
  const editor = useEditor({
    extensions: [StarterKit, ChatDialoguePlugin, TextStyle, Color],
    content: "<p>Hello World! 🌍️</p>",
  });

  console.log(editor.getHTML());

  return (
    <EditorContent
      editor={editor}
      // onKeyDown={handleKeyDown}
    />
  );
};

export default EditorComponent;
