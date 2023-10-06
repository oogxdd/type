const { Configuration, OpenAIApi } = require("openai");

const CHROME_BOOKMARKS_OPENAI_KEY =
  "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";

const configuration = new Configuration({
  apiKey: CHROME_BOOKMARKS_OPENAI_KEY,
});
const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  try {
    const completion = await openai.createChatCompletion({
      // model: "gpt-4-0314",
      // model: "gpt-4",
      model: "gpt-3.5-turbo-0613",
      messages: [{ role: "user", content: req.query.prompt }],
      // prompt: req.query.prompt,
    });
    console.log(completion);
    res.status(200).json({ res: completion.data.choices[0].message.content });
  } catch (error) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}
