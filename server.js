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

// Tools: Defined with top-level name, type, description, and parameters using nullable: true
const tools = [
  {
    type: "function",
    name: "get_user_transactions",
    description: "Fetch a user's transactions from the Bountisphere Bubble API",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The user ID for the transactions"
        },
        startDate: {
          type: "string",
          nullable: true,
          description: "Optional start date in YYYY-MM-DD format"
        },
        endDate: {
          type: "string",
          nullable: true,
          description: "Optional end date in YYYY-MM-DD format"
        }
      },
      required: ["userId"],
      additionalProperties: false
    }
  }
];

// Health check route
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is up!');
});

// Helper for default date range (last 12 months)
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
      return res.status(400).json({ error: 'Missing "input" or "userId".' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    // Build instructions for context
    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}.
Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`;

    console.log("📝 Instructions:", instructions);
    console.log("📝 User input:", input);

    // According to the official docs, pass input as a plain string
    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions,
      input, // Passing the input as a plain string
      tools,
      tool_choice: "auto",
      store: true
    });

    console.log("🧠 Assistant response ID:", response.id);
    const outputItems = response.output || [];
    console.log("🔎 Output items:", JSON.stringify(outputItems, null, 2));

    // Check if the model requested a function call
    const functionCalls = outputItems.filter(item => item.type === "function_call");
    if (functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log("🔧 Function call found:", call);

      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: call.id,
        tool_name: call.name,
        tool_arguments: call.arguments ? JSON.parse(call.arguments) : {}
      });
    }

    // Otherwise, try to retrieve the final text
    const finalText = response.output_text
      || (outputItems.find(item => item.type === "message")?.content?.[0]?.text ?? "")
      || "";

    console.log("💬 Final answer:", finalText);
    return res.json({ success: true, answer: finalText });

  } catch (err) {
    console.error("❌ /assistant error:", err?.response?.data || err.message);
    return res.status(500).json({
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

    console.log("📬 Finalize payload:", JSON.stringify(payload, null, 2));

    const result = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("✅ Tool output submitted successfully:", result.status);
    return res.json({ success: true, data: result.data });

  } catch (err) {
    console.error("❌ finalize-tool-output error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to submit tool output",
      details: err?.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server is running on port ${PORT}`);
});
