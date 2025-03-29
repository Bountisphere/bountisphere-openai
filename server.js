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

// Function tool definition
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
            description: "The user ID to retrieve transactions for"
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
        required: ["userId"],
        additionalProperties: false
      }
    }
  }
];

// Default date range (12 months)
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Assistant endpoint
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const instructions = `
      You are the Bountisphere Money Coach. The userId is ${userId}.
      Use transactions from ${usedStartDate} to ${usedEndDate} unless told otherwise.
    `;

    const response = await openai.responses.create({
      model: 'gpt-4o',
      input: [
        {
          type: "input_text",
          text: input
        }
      ],
      instructions,
      tools,
      tool_choice: "auto",
      stream: false,
      store: true
    });

    console.log("🧠 Assistant response created:", response.id);

    const toolCalls = response.output?.[0]?.tool_calls || [];
    if (toolCalls.length > 0) {
      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: toolCalls[0].id,
        tool_name: toolCalls[0].name,
        tool_arguments: toolCalls[0].arguments
      });
    }

    const answer = response.output?.[0]?.text || '';
    return res.json({ success: true, answer });

  } catch (err) {
    console.error("❌ Assistant failed:", err?.response?.data || err.message);
    res.status(500).json({
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// Finalize tool output endpoint
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

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Tool output submitted:', response.status);
    return res.json({ success: true, result: response.data });

  } catch (err) {
    console.error("❌ Tool submission failed:", err?.response?.data || err.message);
    res.status(500).json({
      error: "Tool submission failed",
      details: err?.response?.data || err.message
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`🚀 Server listening on port ${process.env.PORT || 3000}`);
});
