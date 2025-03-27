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

// 2. Define the function (tool) schema
const tools = [
  {
    "type": "file_search",
    "vector_store_ids": ["vs_JScHftFeKAv35y4QHPz9QwMb"]
  },
  {
    "type": "web_search_preview"
  },
  {
    "type": "function",
    "function": {
      "name": "get_user_transactions",
      "description": "Fetch a user's transactions from the Bountisphere endpoint for analysis",
      "parameters": {
        "type": "object",
        "properties": {
          "userId": {
            "type": "string",
            "description": "The user ID whose transactions we need to fetch"
          }
        },
        "required": ["userId"]
      }
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
        When answering, use transactions within that date range unless the user specifies otherwise.
        You can use web search for market data and file search for internal documentation.
        For user-specific financial data, use the get_user_transactions function.`
      },
      { role: 'user', content: input }
    ];

    // Single call to OpenAI with all tools
    let completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: initialMessages,
      tools,
      store: true
    });

    // Handle any tool calls in a loop until we get a final response
    let conversationMessages = [...initialMessages, completion.choices[0].message];
    let toolCalls = completion.choices[0].message.tool_calls || [];

    while (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        let toolResponse;
        
        if (toolCall.function.name === 'get_user_transactions') {
          // Handle transaction function call
          const args = JSON.parse(toolCall.function.arguments);
          const realUserId = args.userId || userId;
          
          // Build constraints for Bubble API
          const constraints = [
            { "key": "Created By", "constraint_type": "equals", "value": realUserId },
            { "key": "is_pending?", "constraint_type": "equals", "value": false }
          ];

          if (usedStartDate) {
            constraints.push({ "key": "Date", "constraint_type": "greater than", "value": usedStartDate });
          }
          if (usedEndDate) {
            constraints.push({ "key": "Date", "constraint_type": "less than", "value": usedEndDate });
          }

          const bubbleURL = 'https://app.bountisphere.com/api/1.1/obj/transactions';
          const constraintsStr = encodeURIComponent(JSON.stringify(constraints));
          const fullURL = `${bubbleURL}?constraints=${constraintsStr}&sort_field=Date&sort_direction=descending&limit=100`;
          
          const response = await axios.get(fullURL, {
            headers: {
              'Authorization': `Bearer b14c2547e2d20dadfb22a8a695849146`,
              'Content-Type': 'application/json'
            }
          });

          toolResponse = JSON.stringify(response.data?.response?.results || []);
        } else if (toolCall.type === 'file_search') {
          // Handle file search results
          toolResponse = JSON.stringify(toolCall.file_search_results || []);
        } else if (toolCall.type === 'web_search_preview') {
          // Handle web search results
          toolResponse = JSON.stringify(toolCall.web_search_results || []);
        }

        // Add tool response to conversation
        conversationMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolResponse
        });
      }

      // Get next response from model
      completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: conversationMessages,
        tools,
        store: true
      });

      conversationMessages.push(completion.choices[0].message);
      toolCalls = completion.choices[0].message.tool_calls || [];
    }

    // Return final response
    return res.json({ 
      success: true, 
      answer: completion.choices[0].message.content 
    });

  } catch (error) {
    console.error("Error in /assistant endpoint:", error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
