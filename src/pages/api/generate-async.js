import {
  createParser,
  ParsedEvent,
  ReconnectInterval,
} from "eventsource-parser";
import { Configuration, OpenAIApi } from "openai";
export const config = {
  runtime: "edge",
};

const CHROME_BOOKMARKS_OPENAI_KEY =
  "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";
const configuration = new Configuration({
  apiKey: CHROME_BOOKMARKS_OPENAI_KEY,
});
const openai = new OpenAIApi(configuration);

async function handler(req, res) {
  // Your current non-streaming API logic can be removed
  // ...

  // console.log("here");
  try {
    // const { messages } = req.body;
    console.log("wtf");

    if (request.body === null) {
      console.log("shit");
      return new Response("No body", { status: 400 });
    }
    console.log(9);

    let text = "";
    console.log(1);
    const reader = request.body.getReader();
    console.log(2);
    const decoder = new TextDecoder();
    console.log(3);
    let result;

    console.log(reader);
    console.log(reader.read());

    while (!(result = await reader.read()).done) {
      text += decoder.decode(result.value || new Uint8Array(), {
        stream: true,
      });
    }
    text += decoder.decode(); // final decode to capture any remaining encoded bytes

    const body = JSON.parse(text);
    console.log(body);

    console.log("ttthere?");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CHROME_BOOKMARKS_OPENAI_KEY}`,
      },
      body: JSON.stringify({
        // model: "gpt-4-0314",
        // model: "gpt-4",
        model: "gpt-3.5-turbo-16k",
        messages: body.messages,
        stream: true,
      }),
    });
    console.log(res);

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        function onParse(event) {
          console.log(event);
          if (event.type === "event") {
            const data = event.data;
            if (data === "[DONE]") {
              controller.close();
              console.log("done");
              return;
            }
            try {
              const json = JSON.parse(data);
              const text = json.choices[0].delta.content;
              console.log(text);
              // console.log("text: ", text);
              const queue = encoder.encode(text);
              controller.enqueue(queue);
            } catch (e) {
              controller.error(e);
            }
          }
        }

        // stream response (SSE) from OpenAI may be fragmented into multiple chunks
        // this ensures we properly read chunks & invoke an event for each SSE event stream
        const parser = createParser(onParse);

        // https://web.dev/streams/#asynchronous-iteration
        for await (const chunk of res.body) {
          console.log(chunk);
          parser.feed(decoder.decode(chunk));
        }
      },
    });

    // console.log("stream: ", stream);
    return new Response(stream);

    // ... Streaming code goes here
  } catch (error) {
    // Handle error
  }
}

export default handler;
