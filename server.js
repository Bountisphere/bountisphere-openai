import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// ✅ Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ✅ Tools array with top-level "name" & "type"
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
      required: ["userId"]
    }
  }
];

// ✅ Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is live and well!');
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

// ✅ /assistant
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId".' });
    }

    // Generate instructions
    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}.
Use transactions from ${usedStartDate} to ${usedEndDate} unless otherwise specified.`;

    console.log('📝 Creating response with instructions:', instructions);
    console.log('📝 User input:', input);

    // The user's query is passed as a single "input_text" item
    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions,
      tools,
      tool_choice: "auto",
      store: true,
      input: [
        {
          type: "input_text",
          text: input
        }
      ]
    });

    console.log("🧠 Response ID:", response.id);

    // The model's output array
    const outputItems = response.output || [];
    console.log("🔍 Output items:", JSON.stringify(outputItems, null, 2));

    // Check for function calls
    const functionCalls = outputItems.filter(i => i.type === "function_call");
    if (functionCalls.length > 0) {
      // The first function call
      const call = functionCalls[0];
      console.log("🔧 Function call item found:", call);

      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: call.id,
        tool_name: call.name,
        tool_arguments: call.arguments
          ? JSON.parse(call.arguments)
          : {}
      });
    }

    // Otherwise, check for "output_text"
    const textItem = outputItems.find(i => i.type === "output_text");
    const finalAnswer = textItem?.text || "";

    console.log("💬 Final answer:", finalAnswer);
    return res.json({ success: true, answer: finalAnswer });

  } catch (err) {
    console.error("❌ /assistant error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// ✅ /finalize-tool-output
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

    console.log("📬 Submitting tool outputs to OpenAI:", payload);

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server is running on port ${PORT}`);
});
