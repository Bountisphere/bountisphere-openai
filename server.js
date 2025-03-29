import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define custom tool schema
const tools = [
  {
    type: "function",
    function: {
      name: "get_user_transactions",
      description: "Fetch the user's recent transactions.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Unique ID of the Bountisphere user"
          },
          startDate: {
            type: "string",
            description: "Start date for transaction query (YYYY-MM-DD)"
          },
          endDate: {
            type: "string",
            description: "End date for transaction query (YYYY-MM-DD)"
          }
        },
        required: ["userId"]
      }
    }
  }
];

// Utility for default 12-month range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const past = new Date(today);
  past.setFullYear(today.getFullYear() - 1);
  const start = past.toISOString().split('T')[0];
  return { start, end };
}

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere Money Coach is running');
});

// Step 1: Create assistant call
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStart = startDate || start;
    const usedEnd = endDate || end;

    console.log('🧠 Calling OpenAI /v1/responses with input:', input);

    const response = await openai.responses.create({
      model: "gpt-4o",
      input: [
        {
          type: "message",
          role: "system",
          content: [
            {
              type: "text",
              text: `You are the Bountisphere Money Coach. The userId is ${userId}. 
                Use transactions from ${usedStart} to ${usedEnd} unless the user specifies otherwise.`
            }
          ]
        },
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "text",
              text: input
            }
          ]
        }
      ],
      instructions: "You are the Bountisphere Money Coach — friendly, non-judgmental, and helpful. Use function calling for transaction-based questions.",
      tools,
      tool_choice: "auto",
      store: true
    });

    const toolCalls = response.output?.[0]?.tool_calls || [];
    const response_id = response.id;

    if (toolCalls.length > 0) {
      const tool_call_id = toolCalls[0].id;
      const args = toolCalls[0].function.arguments;
      const parsed = typeof args === 'string' ? JSON.parse(args) : args;

      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id,
        tool_name: toolCalls[0].function.name,
        tool_arguments: parsed
      });
    }

    // Return regular model response
    const message = response.output?.[0]?.content?.[0]?.text || "";
    return res.json({ success: true, answer: message });

  } catch (err) {
    console.error('❌ Assistant failed:', err?.response?.data || err.message);
    return res.status(500).json({
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// Step 2: Finalize tool output
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;
    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: "Missing required fields: response_id, tool_call_id, transactions" });
    }

    console.log('📬 Submitting tool outputs back to OpenAI /v1/responses');

    const payload = {
      tool_outputs: [
        {
          tool_call_id,
          output: { transactions }
        }
      ]
    };

    const url = `https://api.openai.com/v1/responses/${response_id}/submit_tool_outputs`;

    const result = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Tool output submitted successfully.');
    res.json({ success: true, openaiResponse: result.data });

  } catch (err) {
    console.error('❌ Error submitting tool output:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to submit tool output',
      details: err?.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
