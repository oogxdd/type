import { useEditor, EditorContent } from '@tiptap/react'
import { usePlayer } from '@/context'
import { useState } from 'react'

import { data } from '@/data'
import { dataToTiptapJson } from '@/helpers'

// import StarterKit from '@tiptap/starter-kit'
import * as Extensions from './extensions'

import Document from '@tiptap/extension-document'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Gapcursor from '@tiptap/extension-gapcursor'

// import {
//   UtteranceExtension,
//   SpeakerExtension,
//   SpeakerParagraph,
//   WordExtension,
//   WordMark,
// } as Extensions from './extensions'
import Focus from '@tiptap/extension-focus'

const defaultContent = {
  type: 'doc',
  content: dataToTiptapJson(data),
}

export const EditorComponent = () => {
  const { playerRef, setPlaying } = usePlayer()
  // const [contentKey, setContentKey] = useState(
  //   window.localStorage.getItem('contentKey') || 'content1'
  // )

  const seekTo = (sec) => {
    playerRef.current.seekTo(sec, 'seconds')
    setPlaying(true)
  }

  const editor = useEditor({
    extensions: [
      Document,
      Paragraph,
      Text,
      History,
      Gapcursor,
      // StarterKit,
      Extensions.UtteranceExtension,
      Extensions.SpeakerExtension.configure({
        seekTo: seekTo,
      }),
      Extensions.SpeakerParagraph,
      Extensions.WordExtension,
      // Extensions.WordMark.configure({
      //   seekTo: seekTo,
      // }),
      Extensions.WordExtension.configure({
        seekTo: seekTo,
      }),

      //Focus.configure({
      //  className: 'has-focus',
      //  mode: 'deepest',
      //  //shallowest
      //}),
    ],
    // autofocus: 'end',
    content: defaultContent,
    onBeforeCreate: ({ editor }) => {
      console.log('--r--')
      console.log(editor)
      // console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
    onSelectionUpdate: ({ editor, ...b }, d, e) => {
      console.log('--r--')
      console.log(editor)
      console.log(b)
      console.log(d)
      console.log(e)
      // console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
    onUpdate: ({ editor }) => {
      console.log('--upd--')
      console.log(editor.getJSON())
      // console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
    onTransaction: ({ transaction: tr, editor }) => {
      // Prevent the update event from being triggered
      // onTransaction: ({ transaction: tr }) => {
      // editor.commands.setMeta('preventUpdate', true)
      // if (!tr.meta.focus && !tr.meta.pointer) {
      //   console.log(' ========== TRANSACTION ==========')
      //   console.log(tr)
      //   if (tr.steps[0]) {
      //     console.log(typeof tr.steps[0])
      //     console.log(tr.steps[0])
      //   }
      //   // editor.commands.setMeta('preventUpdate', true)
      // }
      // console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
  })

  return (
    <div>
      <EditorContent
        editor={editor}
        // onKeyDown={handleKeyDown}
      />
    </div>
  )
}

export default EditorComponent
