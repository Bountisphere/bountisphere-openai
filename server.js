// server.js
import express from 'express';
import bodyParser from 'body-parser';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const BUBBLE_API_KEY = 'b14c2547e2d20dadfb22a8a695849146';
const BUBBLE_USER_ID = '1735159562002x959413891769328900';
const BUBBLE_URL = 'https://app.bountisphere.com/api/1.1/obj/transactions';

app.post('/ask', async (req, res) => {
  const { userMessage, threadId } = req.body;

  try {
    console.log('[Step 1] Sending message to OpenAI:', userMessage);

    const initialResponse = await openai.beta.responses.create({
      assistant_id: ASSISTANT_ID,
      thread_id: threadId,
      input: [{ role: 'user', content: userMessage }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'getTransactions',
            description: 'Retrieve Bountisphere transactions for a date range',
            parameters: {
              type: 'object',
              properties: {
                start_date: { type: 'string', format: 'date-time' },
                end_date: { type: 'string', format: 'date-time' }
              },
              required: ['start_date', 'end_date']
            }
          }
        }
      ]
    });

    const toolCalls = initialResponse.required_action?.submit_tool_outputs?.tool_calls;

    if (toolCalls && toolCalls.length > 0) {
      const toolCall = toolCalls[0];
      const args = JSON.parse(toolCall.function.arguments);
      console.log('[Step 2] Tool call received. Args:', args);

      const transactions = await fetchTransactionsFromBubble(args.start_date, args.end_date);

      const followUp = await openai.beta.responses.create({
        assistant_id: ASSISTANT_ID,
        thread_id: threadId,
        previous_response_id: initialResponse.id,
        tool_outputs: [
          {
            tool_call_id: toolCall.id,
            output: JSON.stringify(transactions)
          }
        ]
      });

      const reply = followUp.content?.[0]?.text?.value || '[No response from assistant]';
      console.log('[Step 3] Final assistant message:', reply);
      return res.json({ message: reply });
    } else {
      const directReply = initialResponse.content?.[0]?.text?.value || '[No direct assistant message]';
      return res.json({ message: directReply });
    }
  } catch (err) {
    console.error('Error in /ask:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 🔄 Fetch transactions from Bubble with constraints
async function fetchTransactionsFromBubble(startDate, endDate) {
  console.log(`[Fetching transactions from ${startDate} to ${endDate}]`);

  const constraints = [
    {
      key: 'Account Holder',
      constraint_type: 'equals',
      value: BUBBLE_USER_ID
    },
    {
      key: 'Date',
      constraint_type: 'greater than',
      value: startDate
    },
    {
      key: 'Date',
      constraint_type: 'less than',
      value: endDate
    }
  ];

  const url = `${BUBBLE_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BUBBLE_API_KEY}`
    }
  });

  const data = await response.json();

  if (!data || !data.response || !data.response.results) {
    throw new Error('No transaction data returned from Bubble');
  }

  return {
    totalCount: data.response.results.length,
    transactions: data.response.results.map((tx) => ({
      date: tx.Date,
      amount: tx.Amount,
      merchant: tx['Merchant Name'] || tx.Description || 'Unknown',
      category: tx['Category Description'] || tx['Category (Old)'] || 'Uncategorized'
    }))
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
