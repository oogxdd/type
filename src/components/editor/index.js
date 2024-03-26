import { useEditor, EditorContent } from '@tiptap/react'
import { usePlayer } from '@/context'
import { useState, useEffect } from 'react'

import { data } from '@/data'
import { dataToTiptapJson } from '@/helpers'

// import StarterKit from '@tiptap/starter-kit'
import * as Extensions from './extensions'

import Document from '@tiptap/extension-document'
import History from '@tiptap/extension-history'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import Gapcursor from '@tiptap/extension-gapcursor'
import TextStyle from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'

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
  const { playerRef, setPlaying, secondsPlayed } = usePlayer()
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
      Extensions.WordMark.configure({
        seekTo: seekTo,
      }),

      TextStyle,
      Color,
      // Extensions.WordExtension.configure({
      //   seekTo: seekTo,
      // }),

      //Focus.configure({
      //  className: 'has-focus',
      //  mode: 'deepest',
      //  //shallowest
      //}),
    ],
    // autofocus: 'end',
    content: defaultContent,
    onBeforeCreate: ({ editor }) => {
      // console.log('--r--')
      // console.log(editor)
      // console.log(editor.getHTML())
      // window.localStorage.setItem(contentKey, editor.getHTML())
    },
    onSelectionUpdate: ({ editor, ...b }, d, e) => {
      // console.log('--r--')
      // console.log(editor)
      // console.log(b)
      // console.log(d)
      // console.log(e)
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
      // console.log('--tr--')
      // console.log(tr)
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

  function findNodeWithMark(doc, markType, attributes) {
    let foundNode = null

    doc.descendants((node) => {
      // Check if the node has the specified mark
      const mark = node.marks.find((mark) => mark.type.name === markType)

      // Check if the mark has the desired attributes
      if (mark && mark.attrs && mark.attrs.start === attributes.start) {
        foundNode = node
        return false // Stop traversal after finding the first matching node
      }

      return true // Continue traversal
    })

    return foundNode
  }

  // Example usage

  useEffect(() => {
    // HERE:
    //
    // store current word el
    // and prev word ele
    //
    // execute editor.commands.setColor(), editor.commands.unsetColor()
    // when word el changes
    //
    // HOW TO DEFINE WHICH EL?
    // by id / attributes

    // console.log('editor')
    // console.log(editor)

    if (editor) {
      const msPlayed = secondsPlayed * 1000
      const currentUtterance = data.find(
        (utterance) => msPlayed >= utterance.start && msPlayed < utterance.end
      )
      const currentWord =
        !!currentUtterance &&
        currentUtterance.words.find(
          (word) => msPlayed >= word.start && msPlayed < word.end
        )

      // console.log(currentWord)

      // if (currentWord) {
      //   const node = findNodeWithMark(editor.state.doc, 'italic', {
      //     start: currentWord.start,
      //   })

      //   if (node) {
      //     // Get the start and end positions of the text node
      //     const { tr } = editor.view.state
      //     console.log(tr)
      //     // const from = tr.doc.resolve(node.pos)
      //     // const to = tr.doc.resolve(node.pos + textNode.nodeSize)
      //     // // Apply the background color mark to the text node
      //     // tr.addMark(
      //     //   from.pos,
      //     //   to.pos,
      //     //   editor.schema.marks.textColor.create({ color: 'yellow' })
      //     // ) // Change 'yellow' to the desired color
      //     // editor.view.dispatch(tr)
      //     // const { tr } = editor.view.state
      //     // const nodePos = editor.view.state.doc.resolve(node.pos)
      //     // const from = nodePos.start()
      //     // const to = nodePos.end()
      //     // // Apply the background color mark to the text node
      //     // tr.addMark(
      //     //   from,
      //     //   to,
      //     //   editor.schema.marks.textColor.create({ color: 'yellow' })
      //     // ) // Change 'yellow' to the desired color
      //     // editor.view.dispatch(tr)
      //   } else {
      //     console.log('Node not found.')
      //   }
      // }

      const currentWordEl =
        currentWord &&
        document.getElementById(`word-${currentWord.start}-${currentWord.end}`)
      let prevbg
      if (currentWordEl) {
        prevbg = currentWordEl.style.background
        currentWordEl.style.background = 'rgb(217 200 255)'
      }
      return () => {
        if (currentWordEl) {
          currentWordEl.style.background = prevbg || 'unset'
          currentWordEl.style.color = 'unset'
        }
      }
    }
  }, [secondsPlayed, editor])

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
