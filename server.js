import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Tools: top-level name & type
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
];

// Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is up!');
});

// Helper for default date range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// Assistant route
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId".' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    // We'll pass some instructions for context
    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}.
Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`;

    console.log("📝 instructions:", instructions);
    console.log("📝 user input:", input);

    // Official doc approach: just pass input as a plain string
    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions,
      input, // <-- a plain string
      tools,
      tool_choice: "auto",
      store: true
    });

    console.log("🧠 /assistant response_id:", response.id);

    // Inspect the model's output
    const outputItems = response.output || [];
    console.log("🔎 output items:", JSON.stringify(outputItems, null, 2));

    // If there's a function call
    const functionCalls = outputItems.filter(i => i.type === "function_call");
    if (functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log("🔧 Found function call:", call);

      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: call.id,
        tool_name: call.name,
        tool_arguments: call.arguments ? JSON.parse(call.arguments) : {}
      });
    }

    // If no function calls, read final text from output_text or from a message item
    const finalText = response.output_text
      || (outputItems.find(i => i.type === "message")?.content?.[0]?.text ?? "")
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

// finalize-tool-output
app.post('/finalize-tool-output', async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;
    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({
        error: 'Missing response_id, tool_call_id, or transactions'
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

    console.log("📬 finalize-tool-output payload:", JSON.stringify(payload, null, 2));

    const result = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("✅ finalize-tool-output success:", result.status);
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
  console.log(`🚀 Bountisphere AI server listening on port ${PORT}`);
});
