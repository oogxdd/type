import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",

  addKeyboardShortcuts() {
    return {
      "Shift-Enter": async ({ editor }) => {
        event.preventDefault();
        console.log("go");
        console.log(editor);

        const editorContent = editor.getText(); // Assuming getHTML() gets the text content
        const response = await fetch(
          `/api/generate?prompt=${encodeURIComponent(editorContent)}`
        );
        const responseData = await response.json();
        console.log(responseData);
        const responseText = responseData.res;

        editor
          .chain()
          .insertContent("<br /><br />")
          .insertContent(`<span style="color: #958DF1">${responseText}</span>`)
          .insertContent("<br /><br />")
          .run();
      },
    };
  },
});

export default ChatPlugin;
