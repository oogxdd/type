import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState } from 'react'

import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'

import ChatDialoguePlugin from './extensions/chat-extension'
import NewPageInputRule from './extensions/input-rules/new-page-input-rule'
import ChangePageInputRule from './extensions/input-rules/change-page-input-rule'
import CodeBlock from './extensions/nodes/code-block'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
// import css from 'highlight.js/lib/languages/css'
// import js from 'highlight.js/lib/languages/javascript'
// import ts from 'highlight.js/lib/languages/typescript'
// import html from 'highlight.js/lib/languages/xml'
// load all highlight.js languages
// import { common, createLowlight } from 'lowlight'

import Loader from '@/components/ui/loader'

import { generateId } from '@/helpers'

// const lowlight = createLowlight(common)

// lowlight.register({ html, js, css, ts })
// lowlight.registerLanguage('css', css)
// lowlight.registerLanguage('js', js)
// lowlight.registerLanguage('ts', ts)

const defaultContent = '<p>Hello World! 🌍️</p>'
// const defaultContent = "<p>Hello World! 🌍️</p><chat-reply>test</chat-reply>";

export const EditorComponent = () => {
  const [isLoading, setLoading] = useState(false)
  const [contentKey, setContentKey] = useState(
    window.localStorage.getItem('contentKey') || 'content1'
  )

  const newPage = () => {
    const newId = generateId()
    setContentKey(newId)
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      ChatDialoguePlugin.configure({ setLoading }),
      NewPageInputRule.configure({ newPage }),
      ChangePageInputRule.configure({ setContentKey }),
      // CodeBlock,
      // CodeBlockLowlight.configure({
      //   // lowlight,
      // }),
      // ChatReplyNode,
      // ChatReplyMark,
    ],
    autofocus: 'end',
    content: window.localStorage.getItem(contentKey) || defaultContent,
    onUpdate: ({ editor }) => {
      // console.log(editor.getJSON())
      // console.log(editor.getHTML())
      window.localStorage.setItem(contentKey, editor.getHTML())
    },
  })

  useEffect(() => {
    if (editor && contentKey) {
      console.log('new contentKey')
      console.log(contentKey)

      // 1. update editor
      editor.commands.setContent(window.localStorage.getItem(contentKey))

      // 2. set new content key to localStorage
      window.localStorage.setItem('contentKey', contentKey)
    }
  }, [editor, contentKey])

  return (
    <>
      {isLoading && <Loader />}
      <EditorContent
        editor={editor}
        // onKeyDown={handleKeyDown}
      />
    </>
  )
}

export default EditorComponent
