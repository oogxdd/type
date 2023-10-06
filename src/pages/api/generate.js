const { Configuration, OpenAIApi } = require("openai");

// const UNKNWON_KEY = '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'
const CHROME_BOOKMARKS_OPENAI_KEY =
  "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";

const configuration = new Configuration({
  apiKey: CHROME_BOOKMARKS_OPENAI_KEY,
});

const openai = new OpenAIApi(configuration);

export default async function handler(req, res) {
  try {
    const maxTokens = req.query.max_tokens
      ? parseInt(req.query.max_tokens)
      : null;
    const completion = await openai.createCompletion({
      model: "gpt-4-0613",
      // model: "text-davinci-003",
      prompt: req.query.prompt,
      max_tokens: maxTokens,
      // n: 1,
      // frequency_penalty: 2.0,
      n: 1, // Number of completions to actually return
      // logprobs: 5,
      // best_of: 20, // Generate 20 and pick the best 5
      temperature: 0.9,
      top_p: 0.85,
      // best_of: 10,
      presence_penalty: 1.0, // Encourage talking about new topics
      frequency_penalty: -0.5, // Reduce likelihood to repeat the same line
      // stream: true,
    });

    const allChoices = completion.data.choices.map((choice) => choice.text);

    res.status(200).json({ res: allChoices });
  } catch (error) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
    } else {
      console.log(error.message);
    }
  }
}
