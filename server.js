import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

console.log('[🧪 OpenAI SDK VERSION]', OpenAI.VERSION || 'VERSION not available');
console.log('[🧪 OpenAI Instance Methods]', Object.keys(openai?.beta?.responses || {}).join(', ') || 'responses not available');

const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';

const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Bountisphere user ID' },
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' }
      },
      required: ['userId', 'start_date', 'end_date']
    }
  }
];

app.post('/ask', async (req, res) => {
  const { userMessage, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  try {
    const input = [{ role: 'user', content: userMessage }];

    const instructions = `
You are the Bountisphere Money Coach — friendly, supportive, and helpful.

If the question involves transactions or budgeting, use the \`get_user_transactions\` function.

If the question involves app support, use the \`file_search\` tool.

If the question involves markets or economy, use \`web_search_preview\`.

Today is ${new Date().toDateString()}. Current user ID is ${targetUserId}.
`.trim();

    const initialResponse = await openai.beta.responses.create({
      model: MODEL,
      input,
      instructions,
      tools,
      tool_choice: 'auto'
    });

    console.log('[🪵 Initial Response]', JSON.stringify(initialResponse, null, 2));

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');
    if (!toolCall) {
      const textResponse = initialResponse.output?.find(item => item.type === 'message')?.content?.[0]?.text;
      return res.json({ message: textResponse || 'Sorry, I wasn’t able to generate a response.' });
    }

    const args = JSON.parse(toolCall.arguments);
    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    console.log('[✅ Tool Call Output]', result);

    const followUp = await openai.beta.responses.create({
      model: MODEL,
      input: [
        ...input,
        toolCall,
        {
          type: 'tool_output',
          call_id: toolCall.call_id,
          output: result
        }
      ],
      instructions,
      tools
    });

    console.log('[🔁 Follow-Up Response]', JSON.stringify(followUp, null, 2));

    const reply = followUp.output?.find(item => item.type === 'message');
    const text =
      reply?.content?.find(c => c.type === 'output_text')?.text ||
      reply?.content?.find(c => c.type === 'text')?.text;

    if (!text) {
      return res.json({
        message: `You don’t seem to have any transactions between ${args.start_date} and ${args.end_date}. Want to try a different date range?`
      });
    }

    return res.json({ message: text });

  } catch (err) {
    console.error('❌ Server Error:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
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
app.listen(PORT, () => console.log(`🚀 Bountisphere server running on port ${PORT}`));
