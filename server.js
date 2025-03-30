import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';

const tools = [{
  type: 'function',
  name: 'get_transactions',
  description: 'Retrieve user transaction history for budgeting purposes.',
  parameters: {
    type: 'object',
    properties: {
      start_date: {
        type: 'string',
        description: 'Start date in YYYY-MM-DD format (inclusive).'
      },
      end_date: {
        type: 'string',
        description: 'End date in YYYY-MM-DD format (inclusive).'
      }
    },
    required: ['start_date', 'end_date'],
    additionalProperties: false
  }
}];

app.post('/ask', async (req, res) => {
  const { userMessage, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  try {
    const inputMessages = [
      { role: 'developer', content: 'You are a friendly and smart money coach. If a tool is defined and needed, call it. Otherwise, respond clearly.' },
      { role: 'user', content: userMessage }
    ];

    const initialResponse = await openai.responses.create({
      model: MODEL,
      input: inputMessages,
      tools,
      tool_choice: 'auto',
      instructions: 'Help the user manage their finances. Use the function tool if transaction data is needed.'
    });

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');
    if (!toolCall) {
      const textResponse = initialResponse.output?.find(item => item.content)?.content?.[0]?.text || '[No assistant reply]';
      return res.json({ message: textResponse });
    }

    const args = JSON.parse(toolCall.arguments);
    console.log('[Tool Call Received]', toolCall.name, args);

    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, targetUserId);
    console.log('[Transaction Result]', result);

    const followUp = await openai.responses.create({
      model: MODEL,
      input: [
        ...inputMessages,
        toolCall,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(result)
        }
      ],
      tools
    });

    const textItem = followUp.output?.find(item => item.content)?.content?.find(c => c.type === 'output_text');
    const finalResponse = textItem?.text;

    if (!finalResponse) {
      return res.json({
        message: `You don’t seem to have any transactions between ${args.start_date} and ${args.end_date}. Want to try a different date range?`
      });
    }

    return res.json({ message: finalResponse });

  } catch (err) {
    console.error('❌ Error in /ask:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const constraints = [
    { key: 'Account Holder', constraint_type: 'equals', value: userId },
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
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
