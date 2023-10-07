import { Mark } from "@tiptap/core";

const ChatReplyMark = Mark.create({
  name: "chat-reply-mark",
  attrs: { class: "chat-reply" },
  parseDOM: [{ tag: "span.chat-reply" }],
  toDOM: (node) => ["span", { class: "chat-reply" }, 0],
});

export default ChatReplyMark;
