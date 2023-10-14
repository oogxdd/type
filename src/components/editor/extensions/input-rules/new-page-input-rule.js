import { Extension, InputRule } from '@tiptap/core'

const NewPageInputRule = Extension.create({
  name: 'new-page-input-rule',

  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(`/n`),
        type: this.type,
        handler: ({ state, range }) => {
          const { tr } = state
          this.options.newPage()
          // const start = range.from;
          let end = range.to

          return tr.insertText('', end - 4, end).setMeta('new_page', true)
        },
      }),
    ]
  },
})

export default NewPageInputRule
