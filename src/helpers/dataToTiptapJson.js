export function dataToTiptapJson(data) {
  const result = []

  data
    .filter((i, ind) => ind < 2)
    .forEach((block) => {
      let speaker = block.speaker

      if (speaker === 'A') {
        speaker = 'Lex Fridman'
      }

      if (speaker === 'B') {
        speaker = 'Jared Kushner'
      }

      const speakerBlock = {
        // type: 'paragraph',
        type: 'utterance',
        speaker: speaker,
        content: [],
      }

      const speakerNode = {
        type: 'speaker',
        attrs: {
          speaker: speaker,
          start: block.start,
          end: block.end,
        },
        content: [
          {
            type: 'text',
            text: speaker,
          },
        ],
      }

      let speakerParagraph = {
        type: 'speakerParagraph',
        content: [],
      }

      block.words.forEach((word) => {
        const wordMark = {
          attrs: {
            start: word.start,
            end: word.end,
            word: `${word.text} `,
            id: `word-${word.start}-${word.end}`,
          },

          // type: 'text',
          // text: `${word.text} `,
          // marks: [
          //   {
          //     type: 'italic',
          //     attrs: {
          //       start: word.start,
          //       end: word.end,
          //       id: `word-${word.start}-${word.end}`,
          //     },
          //   },
          // ],

          type: 'word',
          text: 'text',
          content: [
            {
              type: 'text',
              text: `${word.text} `,
            },
          ],
        }

        // speakerBlock.content.push(wordMark)
        speakerParagraph.content.push(wordMark)
      })

      // speakerBlock.content.push(speakerParagraph)
      speakerBlock.content.push(speakerNode, speakerParagraph)

      result.push(speakerBlock)
    })

  return result
}
