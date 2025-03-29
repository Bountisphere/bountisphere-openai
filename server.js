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

// Corrected tool definition with `name` at top level
const tools = [
  {
    name: "get_user_transactions",
    type: "function",
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
          description: "Optional start date (YYYY-MM-DD)"
        },
        endDate: {
          type: ["string", "null"],
          description: "Optional end date (YYYY-MM-DD)"
        }
      },
      required: ["userId"]
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

app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStart = startDate || start;
    const usedEnd = endDate || end;

    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}. 
Use transactions from ${usedStart} to ${usedEnd} unless the user says otherwise.`;

    console.log("🟡 Creating response with:", {
      input,
      userId,
      instructions,
      tools
    });

    const response = await openai.responses.create({
      model: "gpt-4o",
      input,
      instructions,
      tools,
      tool_choice: "auto",
      store: true
    });

    const toolCalls = response.output?.[0]?.tool_calls || [];
    const toolCall = toolCalls[0];

    if (toolCall) {
      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: toolCall.id,
        tool_name: toolCall.name,
        tool_arguments: toolCall.arguments
      });
    }

    const finalAnswer = response.output?.[0]?.content?.[0]?.text || '';
    return res.json({ success: true, answer: finalAnswer });

  } catch (err) {
    console.error('❌ Assistant failed:', err.message);
    return res.status(500).json({
      error: 'Assistant failed',
      details: err.response?.data || err.message
    });
  }
});

app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: 'Missing required fields' });
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

    console.log("✅ Tool output submitted");
    res.json({ success: true, openaiResponse: result.data });

  } catch (err) {
    console.error("❌ Failed to submit tool output:", err.message);
    res.status(500).json({
      error: "Failed to submit tool output",
      details: err.response?.data || err.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Bountisphere AI server running on port ${process.env.PORT || 3000}`);
});
