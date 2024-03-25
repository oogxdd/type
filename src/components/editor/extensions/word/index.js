import { ReactNodeViewRenderer } from '@tiptap/react'
import { mergeAttributes, Node } from '@tiptap/core'
import Text from '@tiptap/extension-text'
// import Component from './component'

// export const WordExtension = Text.extend({
export const WordExtension = Node.create({
  name: 'word',
  content: 'text*',
  group: 'inline*',
  defining: true,
  // group: 'inline',
  // parseHTML() {
  //   return [
  //     {
  //       tag: 'span',
  //     },
  //   ]
  // },
  //
  addAttributes() {
    return {
      word: {
        default: 'word',
        // // Take the attribute values
        // renderHTML: attributes => {
        //   // … and return an object with HTML attributes.
        //   return {
        //     style: `color: ${attributes.color}`,
        //   }
        // },
      },
    }
  },
  parseHTML() {
    return [{ tag: 'word' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'word',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ]
  },

  // renderText({ node }) {
  //   return `word`
  //   // return `@${node.attrs.id}`
  // },

  // renderHTML({ HTMLAttributes }) {
  //   const attributes = mergeAttributes(
  //     this.options.HTMLAttributes,
  //     HTMLAttributes
  //   )
  //   // attributes.onmouseover = (event) => {
  //   //   event.target.style.backgroundColor = 'lightgray'
  //   //   // Handle mouseover event here, e.g., change background color and show tooltip
  //   // }
  //   // attributes.onclick = (event) => {
  //   //   alert('click')
  //   //   // Handle click event here, e.g., execute custom function
  //   // }
  //   // console.log('attributes -------------------')
  //   // console.log(attributes)
  //   return ['span', attributes, 0]
  // },
  // addNodeView() {
  //   return ReactNodeViewRenderer(Component)
  // },
})
