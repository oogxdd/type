import { useEditor, EditorContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { CONTENT_PRE_KEY } from '@/constants'

import NavigationPage from '@/components/navigation'

import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'

import ChatDialoguePlugin from './extensions/chat-extension'
import NewPageInputRule from './extensions/input-rules/new-page-input-rule'
import ChangePageInputRule from './extensions/input-rules/change-page-input-rule'
import CodeBlock from './extensions/nodes/code-block'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'

// load all highlight.js languages
import { common, createLowlight } from 'lowlight'
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import html from 'highlight.js/lib/languages/xml'

import Loader from '@/components/ui/loader'

import { generateId } from '@/helpers'

const lowlight = createLowlight(common)

lowlight.register({ html, js, css, ts })

const defaultContent = '<p>Hello World! 🌍️</p>'
// const defaultContent = "<p>Hello World! 🌍️</p><chat-reply>test</chat-reply>";

export const EditorComponent = () => {
  const [isLoading, setLoading] = useState(false)
  const [contentKey, setContentKey] = useState(
    window.localStorage.getItem('contentKey') || 'content1'
  )

  const [showNavigation, setShowNavigation] = useState(false)

  const newPage = () => {
    const newId = generateId()
    setContentKey(`${CONTENT_PRE_KEY}${newId}`)
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
      CodeBlockLowlight.configure({
        lowlight,
      }),
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
    <div>
      {isLoading && <Loader />}
      <EditorContent
        editor={editor}
        // onKeyDown={handleKeyDown}
      />
      <button onClick={() => setShowNavigation(!showNavigation)}>
        navigation
      </button>
      {showNavigation && (
        <div className="flex top-0 left-0 w-full bg-white">
          <NavigationPage setContentKey={setContentKey} />
        </div>
      )}
    </div>
  )
}

export default EditorComponent
