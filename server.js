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
            description: "The user's unique ID from Bubble"
          },
          startDate: {
            type: "string",
            description: "Start date for transaction lookup (YYYY-MM-DD)"
          },
          endDate: {
            type: "string",
            description: "End date for transaction lookup (YYYY-MM-DD)"
          }
        },
        required: ["userId"],
        additionalProperties: false
      }
    }
  }
];

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is running.');
});

// Default date range (last 12 months)
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Assistant entry point
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}.
Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`;

    const openaiResponse = await openai.responses.create({
      model: "gpt-4o",
      instructions,
      tools,
      tool_choice: "auto",
      input: [
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
      stream: false,
      store: true
    });

    const toolCalls = openaiResponse.output?.[0]?.tool_calls || [];
    const response_id = openaiResponse.id;
    const tool_call_id = toolCalls.length > 0 ? toolCalls[0].id : null;

    if (tool_call_id) {
      console.log('🛠️ Tool call requested:', toolCalls[0]);
      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id,
        tool_name: toolCalls[0].function.name,
        tool_arguments: JSON.parse(toolCalls[0].function.arguments)
      });
    }

    const finalText = openaiResponse.output?.[0]?.content?.[0]?.text || '';
    return res.json({ success: true, answer: finalText });

  } catch (err) {
    console.error('❌ Error in /assistant:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'Assistant failed',
      details: err.response?.data || err.message
    });
  }
});

// Finalize tool output
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({
        error: 'Missing required fields: response_id, tool_call_id, transactions'
      });
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
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Tool output submitted to OpenAI');
    res.json({ success: true, openaiResponse: response.data });

  } catch (err) {
    console.error('❌ Failed to submit tool output:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to submit tool output',
      details: err.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server listening on port ${PORT}`);
});
