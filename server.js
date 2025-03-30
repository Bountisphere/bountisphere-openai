import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSISTANT_ID = process.env.ASSISTANT_ID;
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY || 'b14c2547e2d20dadfb22a8a695849146';
const BUBBLE_URL = 'https://app.bountisphere.com/api/1.1/obj/transactions';

const DEFAULT_USER_ID = '1735159562002x959413891769328900';

// ✅ Create a thread for new chats
app.post('/create-thread', async (req, res) => {
  try {
    const thread = await openai.beta.threads.create();
    console.log('🧵 Created thread:', thread.id);
    res.json({ threadId: thread.id });
  } catch (err) {
    console.error('Error creating thread:', err);
    res.status(500).json({ error: 'Failed to create thread' });
  }
});

// ✅ Main endpoint to send user message and get assistant reply
app.post('/ask', async (req, res) => {
  const { userMessage, threadId } = req.body;

  try {
    console.log('[Step 1] User message:', userMessage);

    const initialResponse = await openai.responses.create({
      assistant_id: ASSISTANT_ID,
      thread_id: threadId,
      input: [{ role: 'user', content: userMessage }]
    });

    const toolCalls = initialResponse.required_action?.submit_tool_outputs?.tool_calls;

    if (toolCalls?.length > 0) {
      const toolCall = toolCalls[0];
      const args = JSON.parse(toolCall.function.arguments);

      console.log('[Step 2] Tool call received:', toolCall.function.name, args);

      const transactions = await fetchTransactionsFromBubble(args.start_date, args.end_date);

      const followUp = await openai.responses.create({
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

      const finalMessage = followUp.content?.[0]?.text?.value || '[No assistant response]';
      console.log('[Step 3] Assistant reply:', finalMessage);
      return res.json({ message: finalMessage });
    }

    const message = initialResponse.content?.[0]?.text?.value || '[No direct assistant reply]';
    return res.json({ message });

  } catch (err) {
    console.error('Error in /ask:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// ✅ Helper: Fetch transactions from Bubble
async function fetchTransactionsFromBubble(startDate, endDate) {
  console.log(`[Fetching transactions from ${startDate} to ${endDate}]`);

  const constraints = [
    { key: 'Account Holder', constraint_type: 'equals', value: DEFAULT_USER_ID },
    { key: 'Date', constraint_type: 'greater than', value: startDate },
    { key: 'Date', constraint_type: 'less than', value: endDate }
  ];

  const url = `${BUBBLE_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${BUBBLE_API_KEY}`
    }
  });

  const data = await response.json();

  if (!data?.response?.results) {
    throw new Error('No transaction data returned from Bubble');
  }

  return {
    totalCount: data.response.results.length,
    transactions: data.response.results.map(tx => ({
      date: tx.Date,
      amount: tx.Amount,
      merchant: tx['Merchant Name'] || tx.Description || 'Unknown',
      category: tx['Category Description'] || tx['Category (Old)'] || 'Uncategorized'
    }))
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
