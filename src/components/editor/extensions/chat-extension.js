import { Extension } from '@tiptap/core'

const ChatPlugin = Extension.create({
  name: 'chat',

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': async ({ editor }) => {
        event.preventDefault()
        editor.commands.enter()
        this.options.setLoading(true)

        // Assuming your editor content is stored as HTML
        const editorHTML = editor.getHTML()

        let parser = new DOMParser()
        let dom = parser.parseFromString(editorHTML, 'text/html')
        let paragraphs = dom.body.getElementsByTagName('p')
        let messages = []
        let currentUserMessage = []
        for (let message of paragraphs) {
          if (message.getElementsByTagName('span').length > 0) {
            // Assistant message, add the user message that has been built up to this point, if it exists
            if (currentUserMessage.length > 0) {
              messages.push({
                role: 'user',
                content: currentUserMessage.join('\n'),
              })
              currentUserMessage = []
            }
            messages.push({ role: 'assistant', content: message.textContent })
          } else if (message.textContent.trim() !== '') {
            // Join user messages together
            currentUserMessage.push(message.textContent.trim())
          }
        } // Check for last user conversation with no assistant response at the end
        if (currentUserMessage.length > 0) {
          messages.push({
            role: 'user',
            content: currentUserMessage.join('\n'),
          })
        }

        const response = await fetch('/api/llm/openai/generate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messages,
            model: 'gpt-4',
          }),
        })

        this.options.setLoading(false)
        if (!response.ok) {
          alert('error')
        } else {
          const data = response.body

          if (!data) {
            return
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let done = false
          // let responseText = "";

          editor.commands.insertContent(`<br />`)
          // editor.commands.setColor("#22f2ff");
          editor.commands.setColor('#20b0b9')

          while (!done) {
            const { value, done: doneReading } = await reader.read()
            done = doneReading
            const chunkValue = decoder.decode(value)
            editor.commands.insertContent(chunkValue)
          }

          editor.commands.unsetColor()
          editor.commands.insertContent(`<br />`)
          editor.commands.enter()
        }
      },
    }
  },
})

export default ChatPlugin
