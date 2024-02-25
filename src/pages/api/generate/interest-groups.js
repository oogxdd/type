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
    // model = 'gpt-4',
    model = 'gpt-4-turbo-preview',
    //
  } = await req.json()

  const response = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: `
Given a political speech represented as an array of sentences, please identify potential interest groups and subgroups that might be present based on common topics, perspectives, motivations, and affiliations. Provide a list of these groups and subgroups.

Output data format:
\`\`\`
{
  "interestGroups": [
    {
      "name": "Group Name 1",
      "description": "A brief description of the interest group.",
      "subgroups": [
        {
          "name": "Subgroup Name 1.1",
          "description": "A brief description of the subgroup, including specific perspectives or motivations."
        },
        {
          "name": "Subgroup Name 1.2",
          "description": "A brief description of the subgroup, including specific perspectives or motivations."
        }
      ]
    },
    {
      "name": "Group Name 2",
      "description": "A brief description of the interest group.",
      "subgroups": [
        {
          "name": "Subgroup Name 2.1",
          "description": "A brief description of the subgroup, including specific perspectives or motivations."
        }
        // ... more subgroups if applicable
      ]
    }
    // ... more groups if applicable
  ]
}
\`\`\`
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
