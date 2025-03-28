import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
app.use(express.json());

// Tool definition for get_user_transactions
const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "get_user_transactions",
      description: "Return the user's recent financial transactions",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "The unique ID of the Bountisphere user"
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
  }
];

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is live.');
});

// Generate default date range (last 12 months)
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Step 1: Create a response via OpenAI /v1/responses
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing input or userId' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const response = await axios.post(
      'https://api.openai.com/v1/responses',
      {
        model: "gpt-4o-mini",
        input,
        instructions: `You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user’s question involves transaction details, call the 'get_user_transactions' function. Current logged in user is ${userId}. Today's date is ${end}.`,
        tools: toolDefinitions,
        tool_choice: "auto"
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const { id: response_id, required_action } = response.data;

    if (required_action?.submit_tool_outputs) {
      const toolCall = required_action.submit_tool_outputs.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);

      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id: toolCall.id,
        tool_name: toolCall.function.name,
        tool_arguments: args
      });
    }

    const finalAnswer = response.data.output?.text || "Sorry, I didn’t understand the question.";
    return res.json({ success: true, answer: finalAnswer });

  } catch (err) {
    console.error("❌ Error in /assistant:", err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to create assistant response',
      details: err.response?.data || err.message
    });
  }
});

// Step 2: Send tool outputs back to /v1/responses/{id}/submit_tool_outputs
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({
        error: 'Missing required fields: response_id, tool_call_id, transactions'
      });
    }

    const response = await axios.post(
      `https://api.openai.com/v1/responses/${response_id}/submit_tool_outputs`,
      {
        tool_outputs: [
          {
            tool_call_id,
            output: { transactions }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const finalText = response.data.output?.text || "Success, but no final answer provided.";
    console.log("✅ Tool output submitted to OpenAI.");
    return res.json({ success: true, answer: finalText });

  } catch (err) {
    console.error("❌ Error in /finalize-tool-output:", err.response?.data || err.message);
    res.status(500).json({
      error: 'Failed to submit tool output',
      details: err.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
