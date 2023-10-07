import OpenAI from 'openai'
import { OpenAIStream, StreamingTextResponse } from 'ai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export const runtime = 'edge'

async function handler(req) {
  const {
    messages = [],
    model = 'gpt-4',
    //
  } = await req.json()

  const response = await openai.chat.completions.create({
    // model: "gpt-3.5-turbo-16k",
    // model: 'gpt-4',
    model,
    messages,
    stream: true,
  })

  // Convert the response into a friendly text-stream
  const stream = OpenAIStream(response)

  // Respond with the stream
  return new StreamingTextResponse(stream)
}

export default handler
