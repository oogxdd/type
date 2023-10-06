import { Plugin } from 'prosemirror-state';
import { Modal } from 'react-bootstrap'; // Assuming you are using react-bootstrap for modals

// Define commands
const commands = {
  'save': {
    execute: async () => await saveNote(),
    description: 'Save the note'
  },
  'share': {
    execute: async () => await shareNote(),
    description: 'Share the note'
  }
};

// Async function to simulate saving note
async function saveNote() {
  // replace this with your actual implementation
  return Promise.resolve("Note saved!");
}

// Async function to simulate sharing note
async function shareNote() {
  // replace this with your actual implementation
  return Promise.resolve("Note shared!");
}

export default function CmdKPlugin() {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        // Trigger on cmd+k
        if (event.key === 'k' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();

          // Open a command prompt
          const commandKey = prompt('Enter a command:');
          
          if (!commandKey) {
            // User cancelled the command prompt
            return;
          }
          
          // Check if the command exists
          if (commands[commandKey]) {
            // Get the selected text or empty string if nothing is selected
            const selection = view.state.selection;
            const selectedText = selection.empty ? '' : view.state.doc.textBetween(selection.from, selection.to);
            
            // Execute the command
            commands[commandKey].execute(selectedText).then(result => {
              // Prepare a transaction to replace the selected text (or insert at cursor if nothing selected) with the result
              const transaction = selection.empty
                ? view.state.tr.insertText(result, selection.from)
                : view.state.tr.replaceWith(selection.from, selection.to, schema.text(result));
              view.dispatch(transaction);
            });
          } else {
            alert('Unknown command!');
          }
        }
      }
    }
  });
}
