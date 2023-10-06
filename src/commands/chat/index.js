import { Plugin } from 'prosemirror-state';
import { getChatResponse } from '@/api'; // replace with actual path to your AI chat API

export default function ChatDialoguePlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // Trigger on shift+enter
        if (event.key === 'Enter' && event.shiftKey) {
          event.preventDefault();

          // Get the content after the last chat response and send it to the chat API
          const currentContent = view.state.doc.textContent;
          const lastChatIndex = currentContent.lastIndexOf('----------------------------\nChat:');
          const contentToSend = lastChatIndex >= 0
            ? currentContent.slice(lastChatIndex + '----------------------------\nChat:'.length)
            : currentContent;

          getChatResponse(contentToSend).then(response => {
            // Insert the chat response into the editor
            const transaction = view.state.tr.insertText('\n\n----------------------------\nChat: ' + response + '\n________________________\n');
            view.dispatch(transaction);
          });

          return true;
        }
      }
    }
  });
}
