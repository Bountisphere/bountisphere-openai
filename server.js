import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// OpenAI client init
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define tools with proper schema structure
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
            description: "The user's Bubble ID"
          },
          startDate: {
            type: "string",
            format: "date",
            description: "Start date (YYYY-MM-DD)"
          },
          endDate: {
            type: "string",
            format: "date",
            description: "End date (YYYY-MM-DD)"
          }
        },
        required: ["userId"]
      }
    }
  }
];

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI is running!');
});

// Utility to compute date range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const past = new Date(today);
  past.setFullYear(today.getFullYear() - 1);
  const start = past.toISOString().split('T')[0];
  return { start, end };
}

// Assistant call
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStart = startDate || start;
    const usedEnd = endDate || end;

    const messages = [
      {
        role: 'system',
        content: `You are the Bountisphere Money Coach. Use transactions between ${usedStart} and ${usedEnd}.`
      },
      {
        role: 'user',
        content: input
      }
    ];

    const completion = await openai.responses.create({
      model: "gpt-4o",
      input: messages,
      instructions: null,
      tools: tools,
      tool_choice: "auto",
      store: true
    });

    console.log('📬 Assistant response:', JSON.stringify(completion, null, 2));

    const response_id = completion.id;
    const tool_calls = completion.output?.[0]?.content?.[0]?.tool_calls || [];
    const first_tool_call = tool_calls[0];

    if (first_tool_call) {
      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id: first_tool_call.id,
        tool_name: first_tool_call.name,
        tool_arguments: first_tool_call.arguments
      });
    }

    return res.json({
      success: true,
      answer: completion.output?.[0]?.content?.[0]?.text || "No response text."
    });

  } catch (err) {
    console.error('❌ Assistant error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// Tool output submission
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({
        error: 'Missing required fields: response_id, tool_call_id, transactions'
      });
    }

    const payload = {
      tool_outputs: [
        {
          tool_call_id,
          output: { transactions }
        }
      ]
    };

    const endpoint = `https://api.openai.com/v1/responses/${response_id}/submit_tool_outputs`;
    const result = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Submitted tool output:', JSON.stringify(result.data, null, 2));
    return res.json({ success: true, data: result.data });

  } catch (err) {
    console.error('❌ Finalize error:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to submit tool output',
      details: err?.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
});
