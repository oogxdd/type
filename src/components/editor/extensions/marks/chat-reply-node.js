import { mergeAttributes, Node } from "@tiptap/core";
// import { ReactNodeViewRenderer } from "@tiptap/react";
// import TagCreationComponent from "@editor/components/TagCreation";

export const ChatReplyNode = Node.create({
  name: "chat-reply",

  atom: true,
  inline: true,
  selectable: true,
  group: "inline",

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  // renderText({ node }) {
  //   return this.options.renderLabel({
  //     options: this.options,
  //     node,
  //   });
  // },

  parseHTML() {
    return [
      {
        tag: "chat-reply",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["chat-reply", mergeAttributes(HTMLAttributes)];
  },

  // addNodeView() {
  //   return ReactNodeViewRenderer(TagCreationComponent);
  // },
});

export default ChatReplyNode;
