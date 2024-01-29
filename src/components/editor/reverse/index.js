import React from 'react'
import { useEditor, EditorContent, Extension } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'

// Custom Extension to handle Enter key
const EnterKeyHandler = Extension.create({
  name: 'enterKeyHandler',

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, commands } = this.editor
        const { selection } = state
        const position = selection.anchor

        // Insert a line break at the current position and keep the cursor on the same line
        return commands.insertContentAt(position, '\n')
      },
    }
  },
})

const MyEditor = () => {
  const editor = useEditor({
    extensions: [StarterKit, EnterKeyHandler],
    content: '<p>Your initial content goes here...</p>',
  })

  return <EditorContent editor={editor} />
}

export default MyEditor
