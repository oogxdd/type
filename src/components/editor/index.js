import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";

import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import ChatDialoguePlugin from "@/commands/chat";
import { Mark } from "@tiptap/core";

const ChatReplyMark = Mark.create({
  name: "chat-reply-mark",
  attrs: { class: "chat-reply" },
  parseDOM: [{ tag: "span.chat-reply" }],
  toDOM: (node) => ["span", { class: "chat-reply" }, 0],

  // Your code goes here.
});

export const EditorComponent = () => {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ChatDialoguePlugin,
      TextStyle,
      Color,
      ChatReplyMark,
    ],
    content: "<p>Hello World! 🌍️</p>",
  });

  console.log(editor?.getHTML());

  return (
    <EditorContent
      editor={editor}
      // onKeyDown={handleKeyDown}
    />
  );
};

export default EditorComponent;
