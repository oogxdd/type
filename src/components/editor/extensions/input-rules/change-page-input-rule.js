import { Extension, InputRule } from '@tiptap/core'

const contentRegex = /\/page ([^\n]+)\n/

const ChangePageInputRule = Extension.create({
  name: 'change-page-input-rule',

  addInputRules() {
    return [
      new InputRule({
        find: contentRegex,
        type: this.type,
        handler: ({ state, range, match }) => {
          const title = match[1]
          this.options.setContentKey(title)

          const { tr } = state
          const start = range.from
          const end = range.to

          console.log(title)

          return tr.delete(start, end).setMeta('page_title', title)
        },
      }),
    ]
  },
})

export default ChangePageInputRule
