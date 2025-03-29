import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Tool schema with required "name" field
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

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is running');
});

// Default 12-month date range helper
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// POST /assistant
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId.' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    console.log('📥 Received Assistant input:', input);
    console.log('🔍 Using date range:', usedStartDate, '→', usedEndDate);

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      input: [
        {
          type: 'input_text',
          text: `UserId: ${userId}. Use transactions from ${usedStartDate} to ${usedEndDate} unless otherwise specified.\n\n${input}`
        }
      ],
      tools,
      tool_choice: "auto",
      stream: false,
      store: true
    });

    const responseId = response.id;
    const message = response.output?.find(msg => msg.role === 'assistant');
    const toolCall = response.output?.find(msg => msg.tool_calls)?.tool_calls?.[0];

    console.log('✅ OpenAI assistant call completed. Response ID:', responseId);

    if (toolCall) {
      console.log('🔧 Tool call required:', toolCall.function?.name);
      return res.json({
        requires_tool: true,
        response_id: responseId,
        tool_call_id: toolCall.id,
        tool_name: toolCall.function.name,
        tool_arguments: JSON.parse(toolCall.function.arguments)
      });
    }

    const answer = message?.content?.[0]?.text || '';
    return res.json({ success: true, answer });

  } catch (err) {
    console.error('❌ Assistant failed:', err?.response?.data || err.message);
    return res.status(500).json({
      error: 'Assistant failed',
      details: err?.response?.data || err.message
    });
  }
});

// POST /finalize-tool-output
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;
    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: 'Missing required fields.' });
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

    console.log('✅ Tool output submitted for response:', response_id);
    res.json({ success: true, result: result.data });

  } catch (err) {
    console.error('❌ Tool output failed:', err?.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to submit tool output',
      details: err?.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server listening on port ${PORT}`);
});
