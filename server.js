import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
// just to redeploy

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';

// ✅ Flattened tool schema for /v1/responses API
const tools = [{
  type: 'function',
  name: 'get_transactions',
  description: 'Get a list of transactions for the user between two dates.',
  parameters: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format.'
      },
      end_date: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format.'
      }
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false
  }
}];

// ✅ POST /ask — Entry point from Bubble
app.post('/ask', async (req, res) => {
  const { userMessage, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  try {
    const initialResponse = await openai.responses.create({
      model: MODEL,
      input: [{ role: 'user', content: userMessage }],
      tools,
      tool_choice: 'auto'
    });

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');
    if (!toolCall) {
      const textResponse = initialResponse.output?.[0]?.text || '[No assistant reply]';
      return res.json({ message: textResponse });
    }

    const args = JSON.parse(toolCall.arguments);
    console.log('[Tool Call Received]', toolCall.name, args);

    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, targetUserId);

    const followUp = await openai.responses.create({
      model: MODEL,
      input: [
        toolCall,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(result)
        }
      ],
      tools
    });

    const finalResponse = followUp.output?.[0]?.text || '[No assistant follow-up]';
    return res.json({ message: finalResponse });

  } catch (err) {
    console.error('❌ Error in /ask:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

// ✅ Fetch transactions from Bubble
async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const constraints = [
    { key: 'Account Holder', constraint_type: 'equals', value: userId },
    { key: 'Date', constraint_type: 'greater than', value: startDate },
    { key: 'Date', constraint_type: 'less than', value: endDate }
  ];

  const url = `${BUBBLE_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
  console.log('[Bubble API URL]', url); // 👈 Add this line

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
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
