import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useState } from "react";

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
});

export const EditorComponent = () => {
  const [isLoading, setLoading] = useState(false);
  const editor = useEditor({
    extensions: [
      StarterKit,
      ChatDialoguePlugin.configure({
        setLoading,
      }),
      TextStyle,
      Color,
      // ChatReplyMark,
    ],
    autofocus: true,
    content:
      window.localStorage.getItem("content") || "<p>Hello World! 🌍️</p>",
    onUpdate: ({ editor }) => {
      window.localStorage.setItem("content", editor.getHTML());
    },
  });

  useEffect(() => {
    //
  }, []);

  return (
    <>
      {isLoading && <Loader />}
      <EditorContent
        editor={editor}
        // onKeyDown={handleKeyDown}
      />
    </>
  );
};

const Loader = () => (
  <div className="top-4 right-4 bg-cyan-300">
    loading...
    <span />
  </div>
);

export default EditorComponent;
