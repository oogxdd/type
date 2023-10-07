import { Plugin } from "prosemirror-state";
// import { suggestedList } from '@tiptap/suggest';

// Define commands
const commands = {
  "/s": {
    execute: async (content) => await fetchParaphrase(content),
    description: "Paraphrase the selected content",
  },
  "/r": {
    execute: async (content) => await fetchRhyme(content),
    description: "Find a rhyme for the selected content",
  },
};

// Async function to simulate fetching paraphrase
async function fetchParaphrase(content) {
  // replace this with your actual implementation
  return Promise.resolve(content + "_paraphrase");
}

// Async function to simulate fetching rhyme
async function fetchRhyme(content) {
  // replace this with your actual implementation
  return Promise.resolve(content + "_rhyme");
}

function getScope(content) {
  const lastNewlineIndex = content.lastIndexOf("\n");
  const lastDotIndex = content.lastIndexOf(".");
  const lastSpaceIndex = content.lastIndexOf(" ");

  if (lastNewlineIndex > lastDotIndex && lastNewlineIndex > lastSpaceIndex) {
    return {
      type: "paragraph",
      index: lastNewlineIndex,
    };
  } else if (lastDotIndex > lastSpaceIndex) {
    return {
      type: "sentence",
      index: lastDotIndex,
    };
  } else {
    return {
      type: "word",
      index: lastSpaceIndex,
    };
  }
}

export default function SlashPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // Trigger on /
        if (event.key === "/") {
          const { state, dispatch } = view;

          const currentContent = state.doc.textContent;
          const { type, index } = getScope(currentContent);
          const scopeContent = currentContent.slice(index + 1).trim();

          const commandKey = scopeContent.split(" ")[0];
          if (commands[commandKey]) {
            const contentToTransform = currentContent
              .slice(0, index + 1)
              .trim();
            commands[commandKey]
              .execute(contentToTransform)
              .then((transformedContent) => {
                const transaction = view.state.tr.replaceWith(
                  index + 1,
                  state.selection.to,
                  state.schema.text(transformedContent)
                );
                view.dispatch(transaction);
              });

            return true;
          }
        }
      },
    },
  });
}
