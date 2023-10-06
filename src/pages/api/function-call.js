const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
  apiKey: "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",
});
const openai = new OpenAIApi(configuration);

const extract_array = (text) => {
  const regex = /\[\s*\{[\s\S]*?\}\s*\]/g;
  const match = text.match(regex);
  return match ? match[0] : null;
};

export default async function handler(req, res) {
  // console.log(req.body)

    // res.status(200).json({ res: result });
  const functions = [
    {
      name: 'extract_array',
      description: 'Extract array from the text',
      parameters: {
        type: 'object',
        properties: {
          text: { type: "string", description: "Text containing array" }
        },
        required: ['text']
      }
    }
  ];

  const function_system_prompt = `If the user wants to extract an array from the text, call extract_array function.`;

  let messages = [
    { role: 'system', content: function_system_prompt },
    { role: 'user', content: req.query.prompt }
  ];

  try {
    const completion = await openai.createChatCompletion({
      // model: "gpt-4-0613",
      model: "gpt-3.5-turbo-0613",
      messages: messages,
      functions: functions,
      function_call: {"name": "extract_array"}
    });

    let result = completion.data.choices[0].message.content;

    if (result === null) {
      console.log("completion")
      console.log(completion.data.choices[0].message.function_call)
      const func_call = completion.data.choices[0].message;
      console.log(func_call.function_call)
      const func_args = JSON.parse(func_call.function_call.arguments);
      let func_result;

      if (func_call.function_call.name === 'extract_array') {
        func_result = extract_array(func_args.text);
      }

      messages.push({ role: 'function', name: func_call.function_call.name, content: JSON.stringify(func_result) });
      result = JSON.stringify({ slides: func_result });
    }

    res.status(200).json(result);
  } catch (error) {
    if (error.response) {
      console.log(error.response.status);
      console.log(error.response.data);
      res.status(error.response.status).json({ error: error.response.data });
    } else {
      console.log(error.message);
      res.status(500).json({ error: error.message });
    }
  }
}
