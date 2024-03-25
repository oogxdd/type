import { ReactNodeViewRenderer } from '@tiptap/react'
import { mergeAttributes, Node } from '@tiptap/core'
import Paragraph from '@tiptap/extension-paragraph'
import Component from './component'

// import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export const UtteranceExtension = Node.create({
  name: 'utterance',
  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block',

  // content: 'inline*',
  content: 'block*',

  // marks: '',

  // group: 'block',

  // code: true,

  // defining: false,

  parseHTML() {
    return [{ tag: 'p' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'p',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ]
  },
})

// export const UtteranceExtension = Paragraph.extend({
//   // content: '(paragraph|list?)+',
//   // content: '(block|paragraph)+',
//   // content: '(paragraph|block)+',
//   // content: 'inline*',
//   content: 'block*',
//   // onTransaction({ editor, transaction }) {
//   //   console.log('transaction')
//   //   console.log(transaction)
//   // },
//   // group: 'block',
//   // addAttributes() {
//   //   return {
//   //     count: {
//   //       default: 0,
//   //     },
//   //   }
//   // },
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
//   // addNodeView() {
//   //   return ({ node, HTMLAttributes, getPos, editor }) => {
//   //     const element = document.createElement('div')
//   //     const content = document.createElement('div')
//   //     const avatar = document.createElement('div')
//   //     const author = document.createElement('h3')
//   //     avatar.className =
//   //       'bg-gray-300 rounded-full mr-2  text-gray-500 text-sm font-medium'
//   //     avatar.innerHTML = 'Jhhhh'
//   //     author.contentEditable = 'true'
//   //     avatar.contentEditable = 'true'
//   //     element.append(avatar, author, content)
//   //     // const listItem = document.createElement('li')
//   //     // const checkboxWrapper = document.createElement('label')
//   //     // const checkboxStyler = document.createElement('span')
//   //     // const content = document.createElement('div')
//   //     // Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
//   //     //   listItem.setAttribute(key, value)
//   //     // })
//   //     // listItem.dataset.checked = node.attrs.checked
//   //     // if (node.attrs.checked) {
//   //     //   // checkbox.setAttribute('checked', 'checked')
//   //     // }
//   //     // checkboxWrapper.append(checkbox, checkboxStyler)
//   //     // listItem.append(checkboxWrapper, content)
//   //     // Object.entries(HTMLAttributes).forEach(([key, value]) => {
//   //     //   listItem.setAttribute(key, value)
//   //     // })
//   //     return {
//   //       dom: element,
//   //       // contentDOM: content,
//   //       // update: (updatedNode) => {
//   //       //   if (updatedNode.type !== this.type) {
//   //       //     return false
//   //       //   }
//   //       //   listItem.dataset.checked = updatedNode.attrs.checked
//   //       //   if (updatedNode.attrs.checked) {
//   //       //     // checkbox.setAttribute('checked', 'checked')
//   //       //   } else {
//   //       //     // checkbox.removeAttribute('checked')
//   //       //   }
//   //       //   return true
//   //       // },
//   //     }
//   //   }
//   // },
// })
