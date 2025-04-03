// ✅ Bountisphere AI Server — With Direct Credit Card, Loan, and Investment Data Support
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
const BUBBLE_TRANSACTIONS_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';
const FILE_VECTOR_STORE_ID = 'vs_JScHftFeKAv35y4QHPz9QwMb';

const CREDITCARD_URL = 'https://app.bountisphere.com/api/1.1/obj/creditcard';
const LOANS_URL = 'https://app.bountisphere.com/api/1.1/obj/loans';
const INVESTMENTS_URL = 'https://app.bountisphere.com/api/1.1/obj/investments';

const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions, including date, amount, category, merchant, account, and bank.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Bountisphere user ID' },
        start_date: { type: 'string', description: 'Start date YYYY-MM-DD' },
        end_date: { type: 'string', description: 'End date YYYY-MM-DD' }
      },
      required: ['userId', 'start_date', 'end_date'],
      additionalProperties: false
    }
  },
  {
    type: 'function',
    name: 'get_full_account_data',
    description: 'Return user’s linked credit cards, loans, and investments using direct Bubble API endpoints.',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Bountisphere user ID' }
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

    const instructions = `You are the Bountisphere Money Coach — a smart, supportive, and expert financial assistant and behavioral coach.
Your mission is to help people understand their money with insight, compassion, and clarity. You read their real transactions and account balances, identify patterns, and help them build better habits using principles from psychology, behavioral science, and financial planning.
Always be on the user's side — non-judgmental, clear, warm, and helpful. Your tone should inspire calm confidence and forward progress.
Do not refer to the files in the vector store.
• For spending and transactions, call \`get_user_transactions\`
• For credit card, loan, or investment questions, call \`get_full_account_data\`
• For app help, use \`file_search\`
• For market info, use \`web_search\`
Today is ${today}. Current user ID: ${targetUserId}`;

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
      return res.json({ message: fallback || 'Sorry, I couldn’t generate a response.' });
    }

    const args = JSON.parse(toolCall.arguments);
    let toolOutput;

    if (toolCall.name === 'get_user_transactions') {
      toolOutput = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    } else if (toolCall.name === 'get_full_account_data') {
      toolOutput = await fetchAllLinkedAccounts(args.userId);
    } else {
      throw new Error('Unrecognized tool call');
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

    return res.json({ message: text || `No results found.` });
  } catch (err) {
    console.error('❌ Error in /ask handler:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
});

async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const all = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const constraints = [
      { key: 'Account Holder', constraint_type: 'equals', value: userId },
      { key: 'Date', constraint_type: 'greater than', value: startDate },
      { key: 'Date', constraint_type: 'less than', value: endDate }
    ];
    const url = `${BUBBLE_TRANSACTIONS_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&cursor=${cursor}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` } });
    const data = await resp.json();
    if (!data?.response?.results) throw new Error('No transaction data returned');

    all.push(...data.response.results.map(tx => ({
      date: tx.Date,
      amount: tx.Amount,
      merchant: tx['Merchant Name'] || tx.Description || 'Unknown',
      category: tx['Category Description'] || tx['Category (Old)'] || 'Uncategorized',
      category_details: tx['Category Details'] || null,
      account: tx['Account'] || 'Unspecified',
      bank: tx['Bank'] || null
    })));

    if (!data.response.remaining) hasMore = false;
    else cursor += data.response.count || 100;
  }

  return { totalCount: all.length, transactions: all };
}

async function fetchAllLinkedAccounts(userId) {
  const constraints = [{ key: 'Account Holder', constraint_type: 'equals', value: userId }];
  const headers = { Authorization: `Bearer ${BUBBLE_API_KEY}` };

  const [creditResp, loanResp, investResp] = await Promise.all([
    fetch(`${CREDITCARD_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`, { headers }),
    fetch(`${LOANS_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`, { headers }),
    fetch(`${INVESTMENTS_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`, { headers })
  ]);

  const creditData = await creditResp.json();
  const loanData = await loanResp.json();
  const investData = await investResp.json();

  return {
    creditCards: creditData?.response?.results || [],
    loans: loanData?.response?.results || [],
    investments: investData?.response?.results || []
  };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
