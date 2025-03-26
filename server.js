import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// 1. Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultQuery: { 'api-version': '2024-02-15' },
  defaultHeaders: { 'api-type': 'openai' }
});

// 2. Define a single function (tool) schema for fetching transactions
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

// Health check route (optional)
app.get('/', (req, res) => {
  res.send('Bountisphere AI server is running!');
});

// 3. Single /assistant endpoint for user queries + function calling
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId } = req.body;
    if (!input || !userId) {
      return res.status(400).json({
        error: 'Must provide both "input" (the user question) and "userId".'
      });
    }

    // Step A: Send the user’s question to OpenAI with the function schema
    const initialMessages = [
      { role: 'user', content: input }
    ];

    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',   // Using GPT-4o-mini as requested
      messages: initialMessages,
      tools,
      store: true
    });

    // Check if the model called the function
    let toolCalls = completion.choices[0].message.tool_calls || [];
    // Keep track of the entire conversation
    let conversationMessages = [...initialMessages, completion.choices[0].message];

    // Handle any function calls the model made
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'get_user_transactions') {
        // 1. Parse the function arguments
        const args = JSON.parse(toolCall.function.arguments);
        const realUserId = args.userId || userId;

        // 2. Fetch transactions from Bubble
        const constraints = [
          { "key": "Created By", "constraint_type": "equals", "value": realUserId },
          { "key": "is_pending?", "constraint_type": "equals", "value": "false" }
        ];
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

        console.log("Fetching transactions from:", bubbleURL);
        const response = await axios.get(bubbleURL, {
          headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });
        const transactions = response.data?.response?.results || [];

        // 3. Append a tool message with the fetched transactions
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(transactions)
        });

        // 4. Call OpenAI again so it can incorporate the transaction data into a final answer
        completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
          tools,
          store: true
        });
        // Add the new response to our conversation
        conversationMessages.push(completion.choices[0].message);
      }
    }

    // Step C: Return the final text answer to Bubble
    const finalText = completion.choices[0].message.content;
    return res.json({ success: true, answer: finalText });

  } catch (error) {
    console.error("Error in /assistant endpoint:", error.message);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log('🚀 Bountisphere AI server running on port', process.env.PORT || 3000);
});
