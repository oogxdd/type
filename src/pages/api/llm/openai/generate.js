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
  console.log('go')
  console.log('go')
  console.log('go')
  console.log('go')

  try {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        // {
        //   role: 'system',
        //   content: `
        //     AI Assistant, I need your support to generate a layout for an application by following these steps:

        //     Step 1: Identify the user's goal and the required flow for the application. This provides a direction for the user journey.

        //     Step 2: Establish the necessary pages to meet the user's goal. Each page needs a specific objective that complements the user's journey.

        //     Step 3: Determine the 'organisms', or main components, required on each page to meet user objectives. Break down these 'organisms' into smaller elements, 'molecules' and 'atoms', in accordance with the principles of atomic design. This process helps to conceptualize the structure and the information hierarchy of the layout.

        //     Step 4: Proceed with layout construction based on the outcomes of the previous steps. Avoid dwelling on the content at this stage as its generation will be addressed separately later.

        //     The primary objective is to deliver an effective and fluid UX by architecting an intuitive interface from atomic level to the holistic UI.
        //   `,
        // },
        ...messages,
      ],
      stream: true,
    })
    console.log('response')
    console.log(response)

    // Convert the response into a friendly text-stream
    const stream = OpenAIStream(response)

    // Respond with the stream
    return new StreamingTextResponse(stream)
  } catch (error) {
    console.log('error')
    console.log(error)
  }
}

export default handler
