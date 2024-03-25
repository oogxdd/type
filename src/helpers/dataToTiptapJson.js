export function dataToTiptapJson(data) {
  const result = []

  data.forEach((block) => {
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
        text: `${word.text} `,
        attrs: {
          start: word.start,
          end: word.end,
          word: `${word.text} `,
        },

        type: 'text',
        marks: [
          {
            type: 'italic',
            attrs: {
              start: word.start,
              end: word.end,
              id: `word-${word.start}-${word.end}`,
            },
          },
        ],

        // type: 'word',
        // content: [
        //   {
        //     type: 'text',
        //     text: `${word.text} `,
        //   },
        // ],
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

// export function dataToTiptapJson(data) {
//   const result = []

//   data.forEach((block) => {
//     const speakerBlock = {
//       // type: 'speaker_block',
//       type: 'paragraph',
//       speaker: block.speaker,
//       content: [],
//     }

//     block.words.forEach((word) => {
//       const wordMark = {
//         // type: 'word',
//         type: 'text',
//         // text: word.text,
//         text: `${word.text} `,
//         time_start: word.start,
//         time_end: word.end,
//         attrs: {
//           start: word.start,
//           end: word.end,
//           // Additional attributes or styling can be added here
//         },
//         marks: [
//           {
//             type: 'italic', // Apply hover background color
//             attrs: {
//               // Additional attributes for hover background color
//             },
//           },
//           // {
//           //   type: 'hover_background_color', // Apply hover background color
//           //   attrs: {
//           //     // Additional attributes for hover background color
//           //   },
//           // },
//           // {
//           //   type: 'click_handler', // Apply click handler
//           //   attrs: {
//           //     // Additional attributes for click handler
//           //   },
//           // },
//         ],
//       }

//       speakerBlock.content.push(wordMark)
//     })

//     result.push(speakerBlock)
//   })

//   return result
// }
