import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
app.use(express.json());

// ✅ OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // If needed:
  // defaultQuery: { 'api-version': '2024-02-15' },
  // defaultHeaders: { 'api-type': 'openai' }
});

// ✅ Tool definition
const tools = [
  {
    // No top-level "type" here. We'll rely on the "function" sub-object.
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

// ✅ Health check
app.get('/', (req, res) => {
  res.send('✅ Bountisphere AI server is live!');
});

// ✅ Helper: default date range
function getDefaultDateRange() {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const start = lastYear.toISOString().split('T')[0];
  return { start, end };
}

// ✅ Assistant endpoint
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId"' });
    }

    const { start, end } = getDefaultDateRange();
    const usedStartDate = startDate || start;
    const usedEndDate = endDate || end;

    // System instructions
    const instructions = `You are the Bountisphere Money Coach. The userId is ${userId}.
Use transactions from ${usedStartDate} to ${usedEndDate} unless the user specifies otherwise.`;

    console.log("📝 /assistant input:", input);
    console.log("📝 instructions:", instructions);

    // The user's question as a single "message" item
    const openaiResponse = await openai.responses.create({
      model: "gpt-4o",
      instructions,
      tools,
      tool_choice: "auto",
      input: [
        {
          type: "message",
          role: "user",
          content: [
            {
              type: "message",
              text: input
            }
          ]
        }
      ],
      store: true
    });

    console.log("🧠 OpenAI response ID:", openaiResponse.id);

    // Possibly multiple items in output. We'll find function calls or final text.
    const outputItems = openaiResponse.output || [];
    // e.g. look for { type: 'function_call', ... }
    const toolCalls = outputItems.filter(item => item.type === 'function_call');

    if (toolCalls.length > 0) {
      const firstToolCall = toolCalls[0];
      console.log("🔧 Tool call found:", firstToolCall);

      const response_id = openaiResponse.id;
      const tool_call_id = firstToolCall.id;
      const tool_name = firstToolCall.function_call?.name || "unknown_tool";
      const tool_argsRaw = firstToolCall.function_call?.arguments || "{}";

      return res.json({
        requires_tool: true,
        response_id,
        tool_call_id,
        tool_name,
        tool_arguments: JSON.parse(tool_argsRaw)
      });
    }

    // If no tool calls, return the final text
    // Some models store direct text in output_text or in content array
    const finalText = openaiResponse.output_text 
      || outputItems.find(item => item.type === 'message')?.content?.[0]?.text
      || '';

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

// ✅ Finalize tool output
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

    console.log("🛠️ finalize-tool-output payload:", payload);

    const result = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log("✅ Tool output submitted to OpenAI:", result.status);
    return res.json({ success: true, data: result.data });

  } catch (err) {
    console.error("❌ finalize-tool-output error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: "Failed to submit tool output",
      details: err?.response?.data || err.message
    });
  }
});

// ✅ Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server listening on port ${PORT}`);
});
