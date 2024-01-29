import React from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Extension } from '@tiptap/core'

const DisableEnter = Extension.create({
  addKeyboardShortcuts() {
    return {
      Enter: () => true,
    }
  },
})
import { TextSelection } from 'prosemirror-state'

const MyEditor = () => {
  const editor = useEditor({
    extensions: [StarterKit, DisableEnter],
    content: '<p>Your initial content goes here...</p>',

    onUpdate: ({ editor }) => {
      console.log(editor.getJSON())
      console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
  })

  const handleKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (editor) {
        // 1) Find the position at the start of the current line
        const { state } = editor
        let { from } = state.selection

        const startPos = state.doc.resolve(from - 1).nodeBefore
          ? from - state.doc.resolve(from - 1).nodeBefore.nodeSize - 1
          : 0

        // 2) Select this position
        editor.commands.focus(startPos)

        // 3) Enter a line break
        editor.commands.enter()
        editor.commands.insertContent('<br />')
        // editor.commands.insertContent('<p></p>')
        // editor.commands.insertContent('<p></p>')

        // 4) Focus on previous position again
        editor.commands.focus(startPos)
      }
    }
  }

  return (
    <div className="text-editor-nice">
      <EditorContent editor={editor} onKeyDown={handleKeyDown} />
    </div>
  )
}

export default MyEditor
// if (editor) {
//        const { state, commands } = editor;
//        const { selection } = state;
//        const position = selection.$anchor.pos;

//        // Execute a series of commands to adjust the content and cursor position
//        commands.splitBlock(); // Split the current block at the cursor's position
//        commands.insertContent(' ', position); // Insert a space at the new line
//        commands.setTextSelection(position); // Move the cursor to the start of the new line
//      }
