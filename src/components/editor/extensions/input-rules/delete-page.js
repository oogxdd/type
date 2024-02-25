import { Extension, InputRule } from '@tiptap/core'
import { CONTENT_PRE_KEY } from '@/constants'

const DeletePageInputRule = Extension.create({
  name: 'new-page-input-rule',

  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(`/rm`),
        type: this.type,
        handler: ({ state, range }) => {
          // const { tr } = state
          // console.log(`window.localStorage.removeItem(${currentContentKey})`)
          // console.log(`${currentContentKey}`)
          this.options.deletePage()
          // window.localStorage.removeItem(currentContentKey)
        },
      }),
    ]
  },
})

export default DeletePageInputRule
