import { mergeAttributes, Node, textblockTypeInputRule } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'

export const SpeakerParagraph = Node.create({
  name: 'speakerParagraph',

  // content: 'inline*',
  content: 'inline*',
  group: 'block',

  // marks: '',

  // group: 'block',

  // code: true,

  // defining: false,

  parseHTML() {
    return [{ tag: 'pre' }]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { tr } = state
        const { selection } = state
        const { $from } = selection

        // Find the position of the current utterance node
        // const utterancePos = $from.before($from.depth - 1)
        // const utteranceNode = tr.doc.nodeAt(utterancePos)

        // let utterancePos = 0
        // tr.doc.nodesBetween(0, $from.pos, (node, pos) => {
        //   if (node.type.name === 'utterance') {
        //     utterancePos = pos
        //   }
        // })

        // const utteranceNode = tr.doc.nodeAt(utterancePos)
        // Find the current utterance node based on the cursor position
        let utteranceNode
        let utterancePos = 0
        state.doc.nodesBetween(0, $from.pos, (node, pos) => {
          if (node.type.name === 'utterance') {
            utteranceNode = node
            utterancePos = pos
          }
        })

        if (utteranceNode) {
          console.log(utterancePos)
          console.log(utteranceNode)
          console.log(utteranceNode.size)

          // Find the current speaker paragraph
          const currentSpeakerParagraph = utteranceNode.content.content.find(
            (node) => node.type.name === 'speakerParagraph'
          )

          console.log(currentSpeakerParagraph)
          console.log(currentSpeakerParagraph.content.size)
          console.log($from.pos)

          const contentAfterCursor = currentSpeakerParagraph.content.cut(
            // $from.pos - 5 // I don't know why
            $from.pos
          )

          console.log('currentSpeakerParagraph')
          console.log(currentSpeakerParagraph)
          console.log('contentAfterCursor')
          console.log(contentAfterCursor)
          // console.log(contentAfterCursor.content)

          const newContent = contentAfterCursor.content.map((i) => {
            const mark = i.marks[0]
            const obj = {
              type: 'text',
              text: i.text,
              marks: [
                {
                  type: 'italic',
                  attrs: {
                    id: mark.id,
                    start: mark.start,
                    end: mark.end,
                  },
                },
              ],
            }
            return obj
          })

          const newNode = {
            type: 'utterance',
            content: [
              {
                type: 'speaker',
                attrs: {
                  speaker: 'New speaker',
                  start: 170,
                  end: 263258,
                },
                content: [
                  {
                    type: 'text',
                    text: 'New speaker',
                  },
                ],
              },
              {
                type: 'speakerParagraph',
                content: newContent,
              },
            ],
          }

          const rangeToDelete = {
            from: $from.pos,
            to: currentSpeakerParagraph.content.size,
            // to:
            //   utterancePos +
            //   utteranceNode.nodeSize +
            //   currentSpeakerParagraph.content.size,
            // currentSpeakerParagraph.content.size +
            // utterancePos +
            // utteranceNode.nodeSize,
          }

          editor
            .chain()
            .insertContentAt(
              utterancePos + utteranceNode.nodeSize,
              // tr.selection.to,
              newNode,
              {
                updateSelection: false,
              }
            )
            // .deleteRange(rangeToDelete)
            .run()
        }

        return true
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ]
  },
})

// content: [
//   {
//     type: 'text',
//     marks: [
//       {
//         type: 'italic',
//         attrs: {
//           id: 'word-170-286',
//           start: 170,
//           end: 286,
//         },
//       },
//     ],
//     text: 'Speaker',
//   },
//   {
//     type: 'text',
//     marks: [
//       {
//         type: 'italic',
//         attrs: {
//           id: 'word-308-714',
//           start: 308,
//           end: 714,
//         },
//       },
//     ],
//     text: 'paragraph (copied from the last utterance after cursor)',
//   },
// ],
