import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",

  addKeyboardShortcuts() {
    return {
      // "Shift-Enter": async ({ editor }) => {
      "Mod-Enter": async ({ editor }) => {
        event.preventDefault();
        console.log("go");
        console.log(editor);

        // Assuming your editor content is stored as HTML
        // const editorHTML = editor.getHTML();

        // // Extracting messages from HTML
        // const parser = new DOMParser();
        // const doc = parser.parseFromString(editorHTML, "text/html");

        // const messages = [];
        // let currentRole = "user";
        // let currentContent = "";

        // doc.body.querySelectorAll("p").forEach((element) => {
        //   element.childNodes.forEach((childNode) => {
        //     // Check if it's a Text node or a colored span
        //     if (childNode.nodeType === 3) {
        //       const content = childNode.textContent.trim();
        //       if (content) {
        //         currentRole = "user";
        //         messages.push({ role: currentRole, content });
        //       }
        //     } else if (
        //       childNode.nodeType === 1 &&
        //       childNode.tagName.toLowerCase() === "span" &&
        //       childNode.style.color === "rgb(149, 141, 241)"
        //     ) {
        //       const content = childNode.textContent.trim();
        //       if (content) {
        //         currentRole = "assistant";
        //         messages.push({ role: currentRole, content });
        //       }
        //     }
        //   });
        // });

        // // Add the last message
        // if (currentContent !== "") {
        //   messages.push({ role: currentRole, content: currentContent });
        // }

        // Making the API call with conversation history
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            // messages
            messages: [{ role: "user", content: editor.getText() }],
          }),
        });

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
