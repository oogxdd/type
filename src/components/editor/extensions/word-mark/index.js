import { mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core'
import Italic from '@tiptap/extension-italic'

export const WordMark = Italic.extend({
  // draggable: true,

  addAttributes() {
    return {
      id: {
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

  // renderHTML({ HTMLAttributes }) {
  //   return [
  //     'em',
  //     mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
  //       // onClick: () => {
  //       //   console.log('yo')
  //       //   alert('yo')
  //       // },
  //       onclick: console.log('yo'),
  //     }),
  //     0,
  //   ]
  // },
  renderHTML({ HTMLAttributes }) {
    const elem = document.createElement('span')

    Object.entries(
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
    ).forEach(([attr, val]) => elem.setAttribute(attr, val))

    // elem.tabindex = '0'
    // elem.setAttribute('tabindex', '0')

    elem.addEventListener('click', (e) => {
      // console.log(this)
      // this.options.seekTo(HTMLAttributes.start / 1000)
      // e.preventDefault()
      // HERE
      // console.log('click')
    })

    elem.addEventListener('dblclick', (e) => {
      e.preventDefault()
      this.options.seekTo(HTMLAttributes.start / 1000)
      // console.log('dbclick')
    })

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

  addKeyboardShortcuts() {
    return {
      Enter: (a, b, c, d) => {
        console.log(a)
        console.log(b)
        console.log(c)
        console.log(d)
        // this.editor.commands.splitListItem(this.name)
      },
      Tab: () => this.editor.commands.sinkListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    }
  },
})
