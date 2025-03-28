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

// Tool schema with required top-level `name`
const tools = [
  {
    name: "get_user_transactions",
    type: "function",
    function: {
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

app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is running!');
});

function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Step 1: Assistant call with potential function tool use
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Must provide both "input" and "userId".' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          type: 'message',
          role: 'system',
          content: `You are the Bountisphere Money Coach. The userId is ${userId}. Use transactions from ${usedStartDate} to ${usedEndDate} unless otherwise specified.`
        },
        {
          type: 'message',
          role: 'user',
          content: input
        }
      ],
      tools,
      tool_choice: 'auto',
      store: true
    });

    const toolCalls = response.output?.filter(item => item.type === 'tool_call') || [];
    const toolCall = toolCalls[0];

    if (toolCall) {
      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: toolCall.id,
        tool_name: toolCall.name,
        tool_arguments: toolCall.input
      });
    }

    const answer = response.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';
    return res.json({ success: true, answer });

  } catch (err) {
    console.error('❌ Error in /assistant:', err.response?.data || err.message);
    res.status(500).json({
      error: 'Internal server error',
      details: err.response?.data || err.message
    });
  }
});

// Step 2: Continue the session with tool output
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: 'Missing required fields: response_id, tool_call_id, transactions' });
    }

    const continuation = await openai.responses.create({
      model: 'gpt-4o',
      previous_response_id: response_id,
      input: [
        {
          type: 'tool_result',
          tool_call_id,
          content: { transactions }
        }
      ],
      store: true
    });

    const finalOutput = continuation.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';
    return res.json({ success: true, answer: finalOutput });

  } catch (err) {
    console.error('❌ Failed to finalize tool output:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to finalize tool output',
      details: err.response?.data || err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
