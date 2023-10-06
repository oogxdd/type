import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": async ({ editor }) => {
        event.preventDefault();
        console.log("go");
        console.log(editor);
        this.options.setLoading(true);

        // Assuming your editor content is stored as HTML
        const editorHTML = editor.getHTML();

        // Extracting messages from HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(editorHTML, "text/html");

        const messages = [];
        let currentRole = "user";
        let currentContent = "";

        doc.body.querySelectorAll("p").forEach((element) => {
          element.childNodes.forEach((childNode) => {
            // Check if it's a Text node or a colored span
            if (childNode.nodeType === 3) {
              const content = childNode.textContent.trim();
              if (content) {
                currentRole = "user";
                messages.push({ role: currentRole, content });
              }
            } else if (
              childNode.nodeType === 1 &&
              childNode.tagName.toLowerCase() === "span" &&
              childNode.style.color === "rgb(149, 141, 241)"
            ) {
              const content = childNode.textContent.trim();
              if (content) {
                currentRole = "assistant";
                messages.push({ role: currentRole, content });
              }
            }
          });
        });

        // Add the last message
        if (currentContent !== "") {
          messages.push({ role: currentRole, content: currentContent });
        }

        const response = await fetch("/api/vercel-ai", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages,
          }),
        });

        this.options.setLoading(false);
        console.log("here");
        console.log(response);
        if (!response.ok) {
          alert("error");
        } else {
          const data = response.body;
          console.log(response);
          console.log(data);

          if (!data) {
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let done = false;
          // let responseText = "";

          editor.commands.insertContent(`<br />`);
          editor.commands.insertContent(`<br />`);
          // editor.commands.setColor("#22f2ff");
          editor.commands.setColor("#20b0b9");

          while (!done) {
            console.log("yeap?");
            const { value, done: doneReading } = await reader.read();
            console.log(value);
            done = doneReading;
            const chunkValue = decoder.decode(value);
            console.log(chunkValue);
            editor.commands.insertContent(chunkValue);
            // responseText += chunkValue;
          }

          editor.commands.unsetColor();
          editor.commands.insertContent(`<br /><br />`);
        }
      },
    };
  },
});

export default ChatPlugin;
