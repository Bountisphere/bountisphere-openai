import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultQuery: { 'api-version': '2024-02-15' },
  defaultHeaders: { 'api-type': 'openai' }
});

// Define the function (tool) schema for fetching transactions
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
          },
          "startDate": {
            "type": ["string", "null"],
            "description": "Optional start date in YYYY-MM-DD format"
          },
          "endDate": {
            "type": ["string", "null"],
            "description": "Optional end date in YYYY-MM-DD format"
          }
        },
        "required": ["userId"],
        "additionalProperties": false
      },
      "strict": true
    }
  }
];

// Health check route
app.get('/', (req, res) => {
  res.send('Bountisphere AI server is running!');
});

// Helper function to compute default date range (last 12 months)
function getDefaultDateRange() {
  const today = new Date();
  const effectiveEndDate = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const effectiveStartDate = lastYear.toISOString().split('T')[0];
  return { effectiveStartDate, effectiveEndDate };
}

// Single /assistant endpoint for user queries and function calling
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({
        error: 'Must provide both "input" (the user question) and "userId".'
      });
    }

    // Compute default date range if not provided
    const { effectiveStartDate, effectiveEndDate } = getDefaultDateRange();
    const usedStartDate = startDate || effectiveStartDate;
    const usedEndDate = endDate || effectiveEndDate;

    // Include a system message to provide context (including the default date range)
    const initialMessages = [
      {
        role: 'system',
        content: `You are the Bountisphere Money Coach. The userId is ${userId} and the default date range is the last 12 months (from ${usedStartDate} to ${usedEndDate}). When answering, use transactions within that date range unless specified otherwise.`
      },
      { role: 'user', content: input }
    ];

    // Step A: Send the user’s question to OpenAI with the function definitions
    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: initialMessages,
      tools,
      store: true
    });

    // Initialize conversation with the initial messages and the first response
    let toolCalls = completion.choices[0].message.tool_calls || [];
    let conversationMessages = [...initialMessages, completion.choices[0].message];

    // Step B: If the model calls get_user_transactions, process it
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'get_user_transactions') {
        // Parse arguments from the function call; if dates not provided, use defaults
        const args = JSON.parse(toolCall.function.arguments);
        const realUserId = args.userId || userId;
        const realStartDate = args.startDate || usedStartDate;
        const realEndDate = args.endDate || usedEndDate;

        // Build constraints for Bubble query
        const constraints = [
          { "key": "Created By", "constraint_type": "equals", "value": realUserId },
          { "key": "is_pending?", "constraint_type": "equals", "value": "false" }
        ];
        constraints.push({ "key": "Date", "constraint_type": "greater than", "value": realStartDate });
        constraints.push({ "key": "Date", "constraint_type": "less than", "value": realEndDate });

        // Construct the Bubble API URL
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
        console.log("Fetching transactions from:", bubbleURL);

        // Fetch transactions from Bubble
        const response = await axios.get(bubbleURL, {
          headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });
        const transactions = response.data?.response?.results || [];
        console.log(`Retrieved ${transactions.length} transactions from Bubble.`);

        // Append a new tool message with the fetched transactions
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(transactions)
        });

        // Step C: Call OpenAI again with the updated conversation (now including transaction data)
        completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
          tools,
          store: true
        });
        conversationMessages.push(completion.choices[0].message);
      }
    }

    // Final text answer from OpenAI
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
