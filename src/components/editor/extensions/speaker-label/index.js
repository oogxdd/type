import { ReactNodeViewRenderer } from '@tiptap/react'
import { mergeAttributes, Node } from '@tiptap/core'
import Component from './component'

export const SpeakerExtension = Node.create({
  name: 'speaker',

  content: 'inline*',

  group: 'block',

  addAttributes() {
    return {
      speaker: {
        default: null,
      },
      start: {
        default: null,
      },
      end: {
        default: null,
      },
    }
  },

  // defining: true,

  parseHTML() {
    return [
      {
        tag: 'strong',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    const attributes = mergeAttributes(
      this.options.HTMLAttributes,
      HTMLAttributes
    )
    return ['strong', attributes, 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(Component)
  },
})

// ===========================

// import { ReactNodeViewRenderer } from '@tiptap/react'
// import { mergeAttributes, Node } from '@tiptap/core'
// import Heading from '@tiptap/extension-heading'
// import Component from './component'

// export const SpeakerExtension = Heading.extend({
//   // name: 'speaker',

//   // onTransaction({ editor, transaction }) {
//   //   console.log('transaction')
//   //   console.log(transaction)
//   //   // The editor state has changed.
//   // },

//   // group: 'block',

//   // atom: true,

//   addAttributes() {
//     return {
//       count: {
//         default: 0,
//       },
//     }
//   },

//   // parseHTML() {
//   //   return [
//   //     {
//   //       tag: 'react-component',
//   //     },
//   //   ]
//   // },

//   // renderHTML({ HTMLAttributes }) {
//   //   return ['react-component', mergeAttributes(HTMLAttributes)]
//   // },

//   // addNodeView() {
//   //   return ReactNodeViewRenderer(Component)
//   // },
// })
