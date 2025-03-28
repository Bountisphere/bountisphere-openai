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
    type: "function",
    function: {
      name: "get_user_transactions",
      description: "Fetch a user's transactions from the Bountisphere Bubble API",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The user ID whose transactions we need to fetch"
          },
          startDate: {
            type: ["string", "null"],
            description: "Optional start date in YYYY-MM-DD format"
          },
          endDate: {
            type: ["string", "null"],
            description: "Optional end date in YYYY-MM-DD format"
          }
        },
        required: ["userId"],
        additionalProperties: false
      }
    }
  }
];

// Health check route
app.get('/', (req, res) => {
  res.send('Bountisphere AI server is running!');
});

// Helper function for date range
function getDefaultDateRange() {
  const today = new Date();
  const effectiveEndDate = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const effectiveStartDate = lastYear.toISOString().split('T')[0];
  return { effectiveStartDate, effectiveEndDate };
}

// MAIN: OpenAI assistant handler
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({
        error: 'Must provide both "input" (user question) and "userId".'
      });
    }

    const { effectiveStartDate, effectiveEndDate } = getDefaultDateRange();
    const usedStartDate = startDate || effectiveStartDate;
    const usedEndDate = endDate || effectiveEndDate;

    const initialMessages = [
      {
        role: 'system',
        content: `You are the Bountisphere Money Coach. The userId is ${userId}. 
        The default date range is the last 12 months (from ${usedStartDate} to ${usedEndDate}). 
        When answering, use transactions within that date range unless the user specifies otherwise.`
      },
      { role: 'user', content: input }
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: initialMessages,
      tools,
      tool_choice: "auto",
      stream: false,
      store: true
    });

    const toolCalls = completion.choices[0].message.tool_calls || [];
    const response_id = completion.id;
    const tool_call_id = toolCalls.length > 0 ? toolCalls[0].id : null;

    if (tool_call_id) {
      // Tool call needs to be fulfilled by Bubble via POST to our /finalize-tool-output endpoint
      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id,
        tool_name: toolCalls[0].function.name,
        tool_arguments: JSON.parse(toolCalls[0].function.arguments)
      });
    }

    // If no tool needed, just return answer
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

// FINALIZE: Send tool output to OpenAI
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: 'Missing required fields: response_id, tool_call_id, transactions' });
    }

    const endpoint = `https://api.openai.com/v1/responses/${response_id}/submit_tool_outputs`;

    const payload = {
      tool_outputs: [
        {
          tool_call_id,
          output: { transactions }
        }
      ]
    };

    const response = await axios.post(endpoint, payload, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Tool output submitted to OpenAI');
    res.json({ success: true, data: response.data });

  } catch (error) {
    console.error('❌ Error submitting tool output:', error.message);
    res.status(500).json({ error: 'Failed to submit tool output', details: error.message });
  }
});

// Start server
app.listen(process.env.PORT || 3000, () => {
  console.log('🚀 Bountisphere AI server running on port', process.env.PORT || 3000);
});
