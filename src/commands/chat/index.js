import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",

  addKeyboardShortcuts() {
    return {
      "Shift-Enter": async ({ editor }) => {
        event.preventDefault();
        console.log("go");
        console.log(editor);

        // editor.commands.insertContent(
        //   `<span style="color: #958DF1">Oh, for some reason that’s purple.</span>`
        // );
        // editor.commands.insertContent(`<br />`);

        const responseText = "gpt response here";

        editor
          .chain()
          .insertContent("<br /><br />")
          .insertContent(`<span style="color: #958DF1">${responseText}</span>`)
          .insertContent("<br /><br />")
          .run();

        // editor.commands.insertContent(`<br /><br />`);
        // editor.commands.setColor("#22f2ff");
        // editor.commands.insertContent(`Example Text`);
        // editor.commands.unsetColor();
        // editor.commands.insertContent(`<br />`);
        // editor.commands.insertContent(`<br />`);
      },
    };
  },
});

export default ChatPlugin;
