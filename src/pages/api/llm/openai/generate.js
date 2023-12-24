import OpenAI from 'openai'
import { OpenAIStream, StreamingTextResponse } from 'ai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export const runtime = 'edge'

async function handler(req) {
  const {
    messages = [],
    // model = 'gpt-3.5-turbo-16k',
    model = 'gpt-4',
    //
  } = await req.json()

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `
Analyze the provided chunks of a political speech to determine which specific parts of each chunk (or the whole chunk) appeal to different identified interest groups and subgroups. Identify the actual value proposition these parts provide to the various groups and subgroups. Additionally, if any new groups or subgroups emerge based on the content of the speech chunks, add them to the analysis with clear references to the relevant chunks and substrings. Structure the output to provide a comprehensive and granular understanding of the speech's appeals.

Output data format:
\`\`\`
{
  "analyzedSpeechChunks": [
    {
      "originalChunk": "Good evening, my fellow Americans. We're facing an inflection point in history.",
      "appealsTo": [
        {
          "group": "National Security Advocates",
          "subgroup": "Advocates for American Leadership",
          "substring": "We're facing an inflection point in history.",
          "valueProposition": "Emphasizing the urgency and significance of the current moment to rally support for strong national security policies."
        }
      ]
    },
    {
      "originalChunk": "Early this morning, I returned from Israel, a key ally in a turbulent region.",
      "appealsTo": [
        {
          "group": "National Security Advocates",
          "subgroup": "Supporters of Middle Eastern Alliances",
          "substring": "I returned from Israel, a key ally in a turbulent region.",
          "valueProposition": "Highlighting strong relations with critical allies in strategic regions to underscore the importance of international partnerships for national security."
        }
      ]
    }
    // ... more analyzed chunks
  ],
  "additionalGroups": [
    {
      "name": "Pro-Israel Advocacy",
      "subgroups": [
        {
          "name": "Citizens with Israeli Ties",
          "sourceChunk": "Early this morning, I returned from Israel, a key ally in a turbulent region.",
          "substring": "I returned from Israel, a key ally in a turbulent region.",
          "valueProposition": "The mention of Israel as a key ally validates the significance of supporting Israel, resonating with those who have personal or familial ties to the country."
        }
        // ... more additional subgroups
      ]
    }
    // ... more additional groups
  ]
}
\`\`\`

Complete it to all provided chunks.
        `,
      },
      ...messages,
    ],
    stream: true,
  })

  // Convert the response into a friendly text-stream
  const stream = OpenAIStream(response)

  // Respond with the stream
  return new StreamingTextResponse(stream)
}

export default handler
