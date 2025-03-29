import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// ✅ Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultQuery: { 'api-version': '2024-02-15' },
  defaultHeaders: { 'api-type': 'openai' }
});

// ✅ Define tool schema
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

// ✅ Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is live!');
});

// ✅ Default date range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// ✅ Assistant call
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId"' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const systemMessage = `You are the Bountisphere Money Coach. The userId is ${userId}. Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      instructions: systemMessage,
      input: [
        {
          type: 'input_text',
          text: input
        }
      ],
      tools,
      tool_choice: 'auto',
      store: true
    });

    console.log('🧠 Assistant response ID:', response.id);
    const outputs = response.output || [];
    const toolCalls = outputs.filter(item => item.type === 'function_call');

    if (toolCalls.length > 0) {
      const tool_call_id = toolCalls[0].id;
      const args = toolCalls[0].function_call.arguments;
      const toolName = toolCalls[0].function_call.name;

      console.log('🛠️ Tool call requested:', toolName, args);

      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id,
        tool_name: toolName,
        tool_arguments: JSON.parse(args)
      });
    }

    const answer = response.output_text || '';
    return res.json({ success: true, answer });

  } catch (err) {
    console.error('❌ Assistant failed:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Assistant failed',
      details: err.response?.data || err.message
    });
  }
});

// ✅ Tool output submission
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: 'Missing response_id, tool_call_id, or transactions' });
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

    const result = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Tool output submitted successfully.');
    res.json({ success: true, data: result.data });

  } catch (err) {
    console.error('❌ Failed to submit tool output:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to submit tool output',
      details: err.response?.data || err.message
    });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server is running on port ${PORT}`);
});
