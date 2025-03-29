import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// 🔧 TOOL DEFINITION
const tools = [
  {
    type: "function",
    name: "get_user_transactions", // REQUIRED
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
];

// 🧠 Default 12-month range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split("T")[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split("T")[0];
  return { start, end };
}

// 🚀 Assistant entry point
app.post("/assistant", async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId"' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    const response = await openai.beta.responses.create({
      model: "gpt-4o",
      input: input,
      instructions: `You are the Bountisphere Money Coach. Current userId is ${userId}. Use transaction data between ${usedStartDate} and ${usedEndDate} unless told otherwise.`,
      tools,
      tool_choice: "auto",
      stream: false,
      store: true
    });

    const toolCalls = response.output?.[0]?.tool_calls || [];
    const toolCall = toolCalls.length > 0 ? toolCalls[0] : null;

    if (toolCall) {
      console.log("🛠️ Model is requesting tool call:", toolCall);

      return res.json({
        requires_tool: true,
        response_id: response.id,
        tool_call_id: toolCall.id,
        tool_name: toolCall.name,
        tool_arguments: toolCall.arguments
      });
    }

    const output = response.output?.[0]?.content?.[0]?.text || '';
    return res.json({ success: true, answer: output });

  } catch (err) {
    console.error("❌ Assistant Error:", err.response?.data || err.message);
    return res.status(500).json({ error: "Assistant failed", details: err.response?.data || err.message });
  }
});

// ✅ Finalize tool call (submit tool output)
app.post("/finalize-tool-output", async (req, res) => {
  try {
    const { response_id, tool_call_id, transactions } = req.body;

    if (!response_id || !tool_call_id || !transactions) {
      return res.status(400).json({ error: "Missing response_id, tool_call_id, or transactions" });
    }

    const submitURL = `https://api.openai.com/v1/responses/${response_id}/submit_tool_outputs`;

    const payload = {
      tool_outputs: [
        {
          tool_call_id,
          output: { transactions }
        }
      ]
    };

    await axios.post(submitURL, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    console.log("✅ Tool output submitted. Sending follow-up...");

    // Call OpenAI again using previous_response_id
    const followUp = await openai.beta.responses.create({
      model: "gpt-4o",
      previous_response_id: response_id,
      stream: false
    });

    const finalOutput = followUp.output?.[0]?.content?.[0]?.text || '';
    return res.json({ success: true, answer: finalOutput });

  } catch (err) {
    console.error("❌ Finalize Tool Output Error:", err.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to submit tool output",
      details: err.response?.data || err.message
    });
  }
});

// 🌐 Health check
app.get("/", (req, res) => {
  res.send("✅ Bountisphere AI Server is running!");
});

// Start
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server live on port ${PORT}`);
});
