import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultQuery: { 'api-version': '2024-02-15' },
  defaultHeaders: { 'api-type': 'openai' }
});

// Function schema with userId
const tools = [
  {
    "type": "function",
    "function": {
      "name": "get_user_transactions",
      "description": "Fetch a user's transactions from the Bountisphere Bubble API",
      "parameters": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "description": "The user ID whose transactions we need to fetch"
          }
        },
        "required": ["userId"],
        "additionalProperties": false
      },
      "strict": true
    }
  }
];

app.post('/assistant', async (req, res) => {
  try {
    const { input, userId } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Must provide "input" and "userId".' });
    }

    // Step A: Provide userId in the system message so the model knows it has that info
    const initialMessages = [
      {
        role: 'system',
        content: `You are the Bountisphere Money Coach. 
        The userId is ${userId}. 
        If the user asks about their transactions, call get_user_transactions with userId = "${userId}".`
      },
      { role: 'user', content: input }
    ];

    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: initialMessages,
      tools,
      store: true
    });

    // Check if the model called the function
    let toolCalls = completion.choices[0].message.tool_calls || [];
    let conversationMessages = [...initialMessages, completion.choices[0].message];

    // For each function call, handle it
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'get_user_transactions') {
        const args = JSON.parse(toolCall.function.arguments);
        // We already told the model the userId, but just in case:
        const realUserId = args.userId || userId;

        // 1. Fetch from Bubble
        const constraints = [
          { "key": "Created By", "constraint_type": "equals", "value": realUserId },
          { "key": "is_pending?", "constraint_type": "equals", "value": "false" }
        ];
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

        const response = await axios.get(bubbleURL, {
          headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });
        const transactions = response.data?.response?.results || [];

        // 2. Provide the results back as a tool message
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(transactions)
        });

        // 3. Call OpenAI again
        completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
          tools,
          store: true
        });
        conversationMessages.push(completion.choices[0].message);
      }
    }

    // Final text
    const finalText = completion.choices[0].message.content;
    return res.json({ success: true, answer: finalText });

  } catch (error) {
    console.error("Error in /assistant:", error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('Server is running!');
});
