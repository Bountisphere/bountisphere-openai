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

// 2. Define the function (tool) schema, without strict mode
//    so the model can omit startDate/endDate if it wants.
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
        // Only userId is truly required
        "required": ["userId"],
        // Remove strict mode to avoid schema errors
        "additionalProperties": false
      }
      // Omit `"strict": true`
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

    // Include a system message to provide context
    const initialMessages = [
      {
        role: 'system',
        content: `You are the Bountisphere Money Coach. The userId is ${userId}. 
        The default date range is the last 12 months (from ${usedStartDate} to ${usedEndDate}). 
        When answering, use transactions within that date range unless the user specifies otherwise.`
      },
      { role: 'user', content: input }
    ];

    // Step A: Send the user's question to OpenAI with the function definitions
    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: initialMessages,
      tools,
      store: true
    });

    // Check if the model called get_user_transactions
    let toolCalls = completion.choices[0].message.tool_calls || [];
    let conversationMessages = [...initialMessages, completion.choices[0].message];

    // If the model calls get_user_transactions, handle it
    for (const toolCall of toolCalls) {
      if (toolCall.function.name === 'get_user_transactions') {
        // Parse arguments, or default if missing
        const args = JSON.parse(toolCall.function.arguments);
        const realUserId = args.userId || userId;
        const realStartDate = args.startDate || usedStartDate;
        const realEndDate = args.endDate || usedEndDate;

        // Build constraints for Bubble - only filter by pending status
        const constraints = [
          { "key": "is_pending?", "constraint_type": "equals", "value": "false" }
        ];

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
        console.log("Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
          headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });
        
        // Filter transactions by userId in our code
        const allTransactions = response.data?.response?.results || [];
        const userTransactions = allTransactions.filter(tx => tx["Created By"] === realUserId);
        
        console.log(`Retrieved ${allTransactions.length} total transactions, filtered to ${userTransactions.length} for user ${realUserId}`);

        // Provide filtered transaction data to the model
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(userTransactions)
        });

        // Call OpenAI again with the updated conversation
        completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: conversationMessages,
          tools,
          store: true
        });
        conversationMessages.push(completion.choices[0].message);
      }
    }

    // Final answer from the model
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
