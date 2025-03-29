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

// Tool definition using the new /v1/responses-compatible format
const tools = [
  {
    type: 'function',
    function: {
      name: 'get_user_transactions',
      description: 'Fetch a user’s transactions from the Bountisphere Bubble API',
      parameters: {
        type: 'object',
        properties: {
          userId: {
            type: 'string',
            description: 'The user ID whose transactions we need to fetch'
          },
          startDate: {
            type: ['string', 'null'],
            description: 'Optional start date in YYYY-MM-DD format'
          },
          endDate: {
            type: ['string', 'null'],
            description: 'Optional end date in YYYY-MM-DD format'
          }
        },
        required: ['userId'],
        additionalProperties: false
      }
    }
  }
];

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is up!');
});

// Default 12-month window
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Main assistant call
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Must provide "input" and "userId".' });
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
          content: [
            {
              type: 'input_text',
              text: `You are the Bountisphere Money Coach. The userId is ${userId}. 
Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`
            }
          ]
        },
        {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: input
            }
          ]
        }
      ],
      tools,
      tool_choice: 'auto',
      store: true,
      stream: false
    });

    const toolCalls = response.output?.[0]?.tool_calls || [];
    const response_id = response.id;
    const tool_call_id = toolCalls.length > 0 ? toolCalls[0].id : null;

    console.log('🧠 Response ID:', response_id);
    console.log('🛠️ Tool call:', toolCalls);

    if (tool_call_id) {
      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id,
        tool_name: toolCalls[0].name,
        tool_arguments: toolCalls[0].args
      });
    }

    // If no tool needed, return plain answer
    const answer = response.output?.[0]?.content?.[0]?.text || '';
    return res.json({ success: true, answer });

  } catch (err) {
    console.error('❌ Assistant failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Assistant failed', details: err.response?.data || err.message });
  }
});

// Finalize tool output and submit results back to OpenAI
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

    console.log('✅ Tool output successfully submitted to OpenAI.');
    return res.json({ success: true, openaiResponse: response.data });

  } catch (err) {
    console.error('❌ Failed to submit tool output:', err.response?.data || err.message);
    return res.status(500).json({
      error: 'Failed to submit tool output',
      details: err.response?.data || err.message
    });
  }
});

// Boot server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
