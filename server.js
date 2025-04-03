// ✅ Bountisphere AI Server Upgrade with Direct CreditCard, Loan, Investment Fetching
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
const CREDIT_URL = process.env.BUBBLE_CREDIT_URL;
const LOAN_URL = process.env.BUBBLE_LOAN_URL;
const INVESTMENT_URL = process.env.BUBBLE_INVESTMENT_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';
const FILE_VECTOR_STORE_ID = 'vs_JScHftFeKAv35y4QHPz9QwMb';

const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' }
      },
      required: ['userId', 'start_date', 'end_date']
    }
  },
  {
    type: 'function',
    name: 'get_full_account_data',
    description: 'Return user’s credit card, loan, and investment data.',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' }
      },
      required: ['userId']
    }
  },
  { type: 'file_search', vector_store_ids: [FILE_VECTOR_STORE_ID] },
  { type: 'web_search' }
];

app.post('/ask', async (req, res) => {
  const { userMessage, userId, userLocalDate } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;
  const today = userLocalDate || new Date().toDateString();

  try {
    const input = [{ role: 'user', content: userMessage }];

    const instructions = `You are the Bountisphere Money Coach — supportive and smart. Use tools:
- get_user_transactions for transaction analysis
- get_full_account_data for credit card, loan, investment info
Today is ${today}. User ID: ${targetUserId}`;

    const initialResponse = await openai.responses.create({
      model: MODEL,
      input,
      instructions,
      tools,
      tool_choice: 'auto'
    });

    const toolCall = initialResponse.output?.find(i => i.type === 'function_call');
    if (!toolCall) {
      const fallback = initialResponse.output?.find(i => i.type === 'message')?.content?.[0]?.text;
      return res.json({ message: fallback || 'Sorry, no response generated.' });
    }

    const args = JSON.parse(toolCall.arguments);
    let toolOutput;

    if (toolCall.name === 'get_user_transactions') {
      toolOutput = await fetchTransactions(args.start_date, args.end_date, args.userId);
    } else if (toolCall.name === 'get_full_account_data') {
      toolOutput = await fetchFinancialData(args.userId);
    } else {
      throw new Error('Unknown tool call');
    }

    const followUp = await openai.responses.create({
      model: MODEL,
      input: [
        ...input,
        toolCall,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(toolOutput)
        }
      ],
      instructions,
      tools
    });

    const reply = followUp.output?.find(item => item.type === 'message');
    const text = reply?.content?.find(c => c.type === 'output_text')?.text ||
                 reply?.content?.find(c => c.type === 'text')?.text;

    return res.json({ message: text || 'No follow-up response.' });
  } catch (err) {
    console.error('❌ Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

async function fetchTransactions(startDate, endDate, userId) {
  const all = [];
  let cursor = 0, hasMore = true;
  while (hasMore) {
    const constraints = [
      { key: 'Account Holder', constraint_type: 'equals', value: userId },
      { key: 'Date', constraint_type: 'greater than', value: startDate },
      { key: 'Date', constraint_type: 'less than', value: endDate }
    ];
    const url = `${process.env.BUBBLE_API_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&cursor=${cursor}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` } });
    const data = await resp.json();
    if (!data?.response?.results) break;
    all.push(...data.response.results);
    if (!data.response.remaining) hasMore = false;
    else cursor += data.response.count || 100;
  }
  return { totalCount: all.length, transactions: all };
}

async function fetchFinancialData(userId) {
  const [creditCards, loans, investments] = await Promise.all([
    fetchByType(CREDIT_URL, userId),
    fetchByType(LOAN_URL, userId),
    fetchByType(INVESTMENT_URL, userId)
  ]);
  return {
    creditCards,
    loans,
    investments,
    totalAccounts: creditCards.length + loans.length + investments.length
  };
}

async function fetchByType(endpoint, userId) {
  const url = `${endpoint}?constraints=${encodeURIComponent(JSON.stringify([{ key: 'Account Holder', constraint_type: 'equals', value: userId }]))}&limit=1000`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` } });
  const data = await resp.json();
  return data?.response?.results || [];
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server live on port ${PORT}`));
