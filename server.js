// server.js (Updated to include get_full_account_data)

import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import OpenAI from "openai";
import fetch from "node-fetch";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const assistantId = process.env.OPENAI_ASSISTANT_ID;

const instructions = `
You are the Bountisphere Money Coach — a smart, supportive, and expert financial assistant and behavioral coach.

Your mission is to help people understand their money with insight, compassion, and clarity. You read their real transactions, identify spending patterns, and help them build better habits using principles from psychology, behavioral science, and financial planning.

Always be on the user's side — non-judgmental, clear, warm, and helpful. Your tone should inspire calm confidence and forward progress.

• If the question is about transactions or spending, call `get_user_transactions` first.
• If the question is about a specific account’s credit card, loan, or investment details, call `get_full_account_data` with the account ID.
• For app features or help, use `file_search`.
• For market/economic questions, use `web_search`.
`;

const tools = [
  {
    type: "function",
    function: {
      name: "get_user_transactions",
      description: "Gets the user's most recent financial transactions from Bubble.io.",
      parameters: {
        type: "object",
        properties: {
          user_id: {
            type: "string",
            description: "The Bubble user ID to fetch transactions for."
          }
        },
        required: ["user_id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_full_account_data",
      description: "Retrieves a user's account and its linked credit card, loan, or investment if available.",
      parameters: {
        type: "object",
        properties: {
          account_id: {
            type: "string",
            description: "The ID of the account from Bubble to retrieve."
          }
        },
        required: ["account_id"]
      }
    }
  }
];

app.post("/chat", async (req, res) => {
  const { user_input, user_id } = req.body;

  try {
    const thread = await openai.beta.threads.create();

    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: user_input
    });

    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId,
      instructions,
      tools
    });

    let toolOutputs = [];

    let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    while (runStatus.status === "in_progress" || runStatus.status === "requires_action") {
      if (runStatus.status === "requires_action" && runStatus.required_action?.submit_tool_outputs) {
        const toolCalls = runStatus.required_action.submit_tool_outputs.tool_calls;

        for (const toolCall of toolCalls) {
          if (toolCall.function.name === "get_user_transactions") {
            const { user_id } = JSON.parse(toolCall.function.arguments);

            const txRes = await fetch(`https://app.bountisphere.com/api/1.1/obj/transaction?constraints=[{"key":"Created By","constraint_type":"equals","value":"${user_id}"}]`);
            const txData = await txRes.json();

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(txData.response.results)
            });
          }

          if (toolCall.function.name === "get_full_account_data") {
            const { account_id } = JSON.parse(toolCall.function.arguments);

            const accountRes = await fetch(`https://app.bountisphere.com/api/1.1/obj/account/${account_id}`, {
              headers: {
                "Content-Type": "application/json"
              }
            });

            const accountData = await accountRes.json();

            toolOutputs.push({
              tool_call_id: toolCall.id,
              output: JSON.stringify(accountData.response)
            });
          }
        }

        await openai.beta.threads.runs.submitToolOutputs(thread.id, run.id, {
          tool_outputs: toolOutputs
        });
      }

      runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    }

    const messages = await openai.beta.threads.messages.list(thread.id);
    const lastMessage = messages.data.find((msg) => msg.role === "assistant");

    res.json({ reply: lastMessage?.content?.[0]?.text?.value || "No response." });
  } catch (error) {
    console.error("Error handling chat:", error);
    res.status(500).json({ error: "Something went wrong." });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
