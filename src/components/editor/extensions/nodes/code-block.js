import { Extension } from '@tiptap/core'

const CodeBlockHighlight = Extension.create({
  name: 'codeBlockHighlight',

  addNode() {
    return {
      name: 'codeBlockHighlight',

      // Define the code block Node Schema
      schema: {
        content: 'text*',
        marks: '',
        group: 'block',
        code: true,
        defining: true,
        isolating: true,
        parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
        toDOM() {
          return ['pre', ['code', 0]]
        },
      },

      // Add a parser to the code block to match markdown content
      addParser() {
        return {
          match: (content) => /`{3}(.*?)`{3}/.test(content),
          matchElement: (node) =>
            node.tagName === 'PRE' && node.querySelector('code'),
          parse: (match) => {
            const code = match[0].replace(/`{3}/g, '')
            return [{ type: this.name, content: code }]
          },
          element: (node) => {
            const code = node.textContent.replace(/`{3}/g, '').trim()
            return {
              type: this.name,
              content: code,
            }
          },
        }
      },

      // Add commands to change the type and wrap the content
      addCommands() {
        return {
          toggleCodeBlock:
            () =>
            ({ commands }) => {
              return commands.toggleNode('codeBlockHighlight')
            },
        }
      },
    }
  },
})

export default CodeBlockHighlight
