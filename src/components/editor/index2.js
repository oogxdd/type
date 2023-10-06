import React, { useState, useCallback, useEffect } from "react";
// import { PluginKey } from "prosemirror-state";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Mention from "@tiptap/extension-mention";
import Suggestion from "@tiptap/suggestion";

import suggestion from "./suggestion";

// import CmdKPlugin from "@/commands/cmdk";
import SlashPlugin from "@/commands/slash";
import ChatDialoguePlugin from "@/commands/chat";
import TabGeneratePlugin from "@/commands/generate";
// import CommandModal from "./CommandModal";

export const EditorComponent = () => {
  const [showCommandModal, setShowCommandModal] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  const [suggestionLevel, setSuggestionLevel] = useState(1);

  const editor = useEditor({
    extensions: [
      StarterKit,
      // CmdKPlugin({
      //   openCommandModal: (view) => {
      //     // setIsCommandModalOpen(true);
      //     setCurrentView(view);
      //   },
      // }),
      // SlashPlugin({
      //   /* ... options as needed ... */
      // }),
      // ChatDialoguePlugin({
      //   /* ... options as needed ... */
      // }),
      // TabGeneratePlugin({
      //   /* ... options as needed ... */
      // }),
      // Suggestion({
      //   command: ({ editor, range, props }) => {
      //     console.log("trigger");
      //     // Call API to get suggestions
      //     const textBefore = editor.getRange(range.from, range.to);
      //     fetch("/api/generate", {
      //       method: "POST",
      //       body: JSON.stringify({
      //         text: textBefore,
      //         level: suggestionLevel,
      //       }),
      //     })
      //       .then((res) => res.json())
      //       .then((data) => {
      //         // Show suggestions
      //         props.suggestion({
      //           items: data.suggestions.map((suggestion) => ({
      //             label: suggestion,
      //           })),
      //         });
      //       });
      //   },
      //   pluginKey: "suggestion",
      // }),
      Mention.configure({
        HTMLAttributes: {
          class: "mention",
        },
        suggestion,
      }),
    ],
    content: "<p>Hello World! 🌍️</p>",
    // onUpdate: ({ editor }) => {
    //   const commandState = editor.getPluginState(CommandPluginKey)
    //   setSuggestions(commandState.suggestions)
    // }
  });

  const handleKeyDown = useCallback((event) => {
    if (event.key === "ArrowRight") {
      setSuggestionLevel((level) => Math.min(level + 1, 5));
    }
    if (event.key === "ArrowLeft") {
      setSuggestionLevel((level) => Math.max(level - 1, 0));
    }
  }, []);

  // const handleKeyDown = useCallback(
  //   (event) => {
  //     if (event.key === "/") {
  //       console.log(editor);
  //       editor.commands.command({
  //         name: "suggestion",
  //         params: {},
  //       });
  //     }
  //   },
  //   [editor]
  // );

  console.log(suggestionLevel);

  return (
    <div>
      <EditorContent editor={editor} onKeyDown={handleKeyDown} />
    </div>
  );
};

// <CommandModal
//   show={showCommandModal}
//   onClose={() => setShowCommandModal(false)}
// />
// <SuggestionDropdown suggestions={suggestions} />

export default EditorComponent;
