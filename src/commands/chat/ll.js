import { Extension } from "@tiptap/core";

const ChatPlugin = Extension.create({
  name: "chat",
  addKeyboardShortcuts() {
    return {
      "Mod-Enter": async ({ editor }) => {
        event.preventDefault();

        this.options.setLoading(true);

        // Assuming your editor content is stored as HTML
        const editorHTML = editor.getHTML();
        // Extracting messages from HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(editorHTML, "text/html");
        const messages = [];
        const paragraphs = doc.body.querySelectorAll("p");
        console.log(paragraphs);

        paragraphs.forEach((p) => {
          // Split user and assistant messages using <br><br>
          const rawMessages = p.innerHTML.split("<br><br>");
          rawMessages.forEach((msg) => {
            if (msg.startsWith('<span style="color: #20b0b9">')) {
              // Assistant message
              const assistantMessage = msg
                .replace('<span style="color: #20b0b9">', "")
                .replace("</span>", "");
              messages.push({
                role: "assistant",
                content: assistantMessage.trim(),
              });
            } else {
              // User message
              const userMessage = msg.replace("<br>", "");
              if (userMessage.trim() !== "") {
                messages.push({ role: "user", content: userMessage.trim() });
              }
            }
          });
        });

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

        if (!response.ok) {
          alert("error");
        } else {
          const data = await response.json();
          let decodedString = "";

          data.stream.forEach((element) => {
            decodedString += `<p><span style="color: #20b0b9">${element.message.text}</span><br><br></p>`;
          });

          editor.commands.insertContent(decodedString);
        }
      },
    };
  },
});

export default ChatPlugin;
