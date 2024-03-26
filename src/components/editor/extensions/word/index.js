import { ReactNodeViewRenderer } from '@tiptap/react'
import { mergeAttributes, Node } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import Text from '@tiptap/extension-text'
import Component from './component'

// export const WordExtension = Text.extend({

export const WordExtension = Node.create({
  name: 'word',
  group: 'inline',
  inline: true,
  // atom: false,
  // editable: true,
  // selectable: true,
  // isolating: false,
  // allowGapCursor: true,
  // content: 'text*',
  content: 'inline*',
  // parseDOM: [{ tag: 'span', preserveWhitespace: 'full' }],
  // toDOM: () => ['span', 0],

  // content: 'text*',

  // renderText({ node }) {
  //   return `@${node.attrs.id}`
  // },

  addAttributes() {
    return {
      id: {
        default: null,
      },
      word: {
        default: null,
      },
      text: {
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

  parseHTML() {
    return [{ tag: 'word' }]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('eventHandler'),
        props: {
          handleClick(view, pos, event) {
            // alert('click')
          },
          handleDoubleClick(view, pos, event) {
            /* … */
          },
          handlePaste(view, event, slice) {
            /* … */
          },
          // … and many, many more.
          // Here is the full list: https://prosemirror.net/docs/ref/#view.EditorProps
        },
      }),
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'word',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes
        // {
        // onclick: () => console.log('bbbbbbbbbbbb'),
        // onClick: () => console.log('cccccccc'),
        // }
      ),
      // HTMLAttributes.word,
      0,
      // 'yankee',
    ]
    const elem = document.createElement('word')

    Object.entries(
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    ).forEach(([attr, val]) => {
      console.log('attrs')
      console.log(attr)
      console.log(val)
      elem.setAttribute(attr, val)
    })

    // elem.tabindex = '0'
    // elem.setAttribute('tabindex', '0')
    // console.log('elem')
    // console.log(elem)
    // console.log(HTMLAttributes)
    // console.log(this.options.HTMLAttributes)
    // elem.textContent = HTMLAttributes.word
    // elem.contentEditable = 'inherit'

    // elem.addEventListener('click', (e) => {
    //   // console.log(this)
    //   // this.options.seekTo(HTMLAttributes.start / 1000)
    //   // e.preventDefault()
    //   // HERE
    //   console.log('click')
    // })

    // elem.addEventListener('dblclick', (e) => {
    //   e.preventDefault()
    //   this.options.seekTo(HTMLAttributes.start / 1000)
    //   // console.log('dbclick')
    // })

    // elem.addEventListener('focus', (e) => {
    //   // elem.style.background = 'purple'
    //   // e.preventDefault()
    //   // alert('yo')
    // })

    // elem.addEventListener('blur', (e) => {
    //   // elem.style.background = 'unset'
    //   // e.preventDefault()
    //   // alert('yo')
    // })

    return elem
  },
  // addNodeView() {
  //   return () => {
  //     const container = document.createElement('span')

  //     // container.addEventListener('click', (event) => {
  //     //   // alert('clicked on the container')
  //     // })

  //     const content = document.createElement('span')
  //     container.append(content)

  //     return {
  //       dom: container,
  //       contentDOM: container,
  //     }
  //   }
  // },

  // addNodeView() {
  //   return ReactNodeViewRenderer(Component)
  // },

  // toDOM(node) {
  //   return ['word', 0, node.textContent]
  // },
})
//export const WordExtension = Node.create({
//  name: 'word',
//  content: 'text*',
//  group: 'inline*',
//  defining: true,
//  // group: 'inline',
//  // parseHTML() {
//  //   return [
//  //     {
//  //       tag: 'span',
//  //     },
//  //   ]
//  // },
//  //
//  addAttributes() {
//    return {
//      word: {
//        default: 'word',
//        // // Take the attribute values
//        // renderHTML: attributes => {
//        //   // … and return an object with HTML attributes.
//        //   return {
//        //     style: `color: ${attributes.color}`,
//        //   }
//        // },
//      },
//    }
//  },
//  parseHTML() {
//    return [{ tag: 'word' }]
//  },

//  renderHTML({ HTMLAttributes }) {
//    return [
//      'word',
//      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
//      0,
//    ]
//  },

//  // renderText({ node }) {
//  //   return `word`
//  //   // return `@${node.attrs.id}`
//  // },

//  // renderHTML({ HTMLAttributes }) {
//  //   const attributes = mergeAttributes(
//  //     this.options.HTMLAttributes,
//  //     HTMLAttributes
//  //   )
//  //   // attributes.onmouseover = (event) => {
//  //   //   event.target.style.backgroundColor = 'lightgray'
//  //   //   // Handle mouseover event here, e.g., change background color and show tooltip
//  //   // }
//  //   // attributes.onclick = (event) => {
//  //   //   alert('click')
//  //   //   // Handle click event here, e.g., execute custom function
//  //   // }
//  //   // console.log('attributes -------------------')
//  //   // console.log(attributes)
//  //   return ['span', attributes, 0]
//  // },
//  // addNodeView() {
//  //   return ReactNodeViewRenderer(Component)
//  // },
//})
