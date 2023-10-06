import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": async ({ editor }) => {
        event.preventDefault();
        editor.commands.enter();
        this.options.setLoading(true);

        const editorHTML = editor.getHTML();
        const parser = new DOMParser();
        const doc = parser.parseFromString(editorHTML, "text/html");
        const messages = [];
        let currentRole = "user";
        let currentContent = "";

        doc.body.querySelectorAll("p").forEach((element) => {
          console.log("------");
          console.log(element);

          element.childNodes.forEach((childNode) => {
            console.log("childNode");
            console.log(childNode);
            console.log(childNode.nodeType);

            const content = childNode.textContent.trim();

            if (content) {
              currentRole = "user";
              messages.push({ role: currentRole, content });
            }
          });
        });

        if (currentContent !== "") {
          messages.push({ role: currentRole, content: currentContent.trim() });
        }

        // const response = await fetch("/api/vercel-ai", {
        //   method: "POST",
        //   headers: {
        //     "Content-Type": "application/json",
        //   },
        //   body: JSON.stringify({
        //     messages,
        //   }),
        // });

        // this.options.setLoading(false);
        // console.log("here");
        // console.log(response);
        // if (!response.ok) {
        //   alert("error");
        // } else {
        //   const data = response.body;
        //   console.log(response);
        //   console.log(data);

        //   if (!data) {
        //     return;
        //   }

        //   const reader = response.body.getReader();
        //   const decoder = new TextDecoder();
        //   let done = false;
        //   // let responseText = "";

        //   editor.commands.insertContent(`<br />`);
        //   // editor.commands.setColor("#22f2ff");
        //   editor.commands.setColor("#20b0b9");

        //   while (!done) {
        //     console.log("yeap?");
        //     const { value, done: doneReading } = await reader.read();
        //     console.log(value);
        //     done = doneReading;
        //     const chunkValue = decoder.decode(value);
        //     console.log(chunkValue);
        //     editor.commands.insertContent(chunkValue);
        //     // responseText += chunkValue;
        //   }

        //   editor.commands.unsetColor();
        //   editor.commands.insertContent(`<br />`);
        //   editor.commands.enter();
        // }
      },
    };
  },
});

export default ChatPlugin;
