import { useEditor, EditorContent } from "@tiptap/react";
import { useEffect, useState } from "react";

import StarterKit from "@tiptap/starter-kit";
import Color from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import ChatDialoguePlugin from "@/commands/chat";
// import ChatReplyNode from "./extensions/chat-reply-node";
import NewPageInputRule from "./extensions/new-page-input-rule";
import ChangePageInputRule from "./extensions/change-page-input-rule";

import Loader from "@/components/ui/loader";

const defaultContent = "<p>Hello World! 🌍️</p>";
// const defaultContent = "<p>Hello World! 🌍️</p><chat-reply>test</chat-reply>";

export const EditorComponent = () => {
  const [isLoading, setLoading] = useState(false);

  const contentKey = "content";

  const editor = useEditor({
    extensions: [
      StarterKit,
      ChatDialoguePlugin.configure({
        setLoading,
      }),
      TextStyle,
      Color,
      NewPageInputRule,
      ChangePageInputRule,
      // ChatReplyNode,
      // ChatReplyMark,
    ],
    autofocus: "end",
    content: window.localStorage.getItem(contentKey) || defaultContent,
    onUpdate: ({ editor }) => {
      console.log(editor.getJSON());
      window.localStorage.setItem(contentKey, editor.getHTML());
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

export default EditorComponent;
