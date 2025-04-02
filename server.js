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
console.log('[🧪 openai.responses.create]', typeof openai.responses?.create === 'function' ? '✅ OK' : '❌ Not found');

const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';
const FILE_VECTOR_STORE_ID = 'vs_JScHftFeKAv35y4QHPz9QwMb';

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
    type: 'file_search',
    vector_store_ids: [FILE_VECTOR_STORE_ID]
  },
  {
    type: 'web_search'
  }
];

// 🧠 AI endpoint
app.post('/ask', async (req, res) => {
  const { userMessage, userId, userLocalDate } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;
  const today = userLocalDate || new Date().toDateString();

  try {
    const input = [
      {
        role: 'user',
        content: userMessage
      }
    ];

    const instructions = `You are the Bountisphere Money Coach — a smart, supportive, and expert financial assistant and behavioral coach.
Your mission is to help people understand their money with insight, compassion, and clarity. You read their real transactions, identify spending patterns, and help them build better habits using principles from psychology, behavioral science, and financial planning.
Always be on the user's side — non-judgmental, clear, warm, and helpful. Your tone should inspire calm confidence and forward progress.
Do not refer to the files in the vector store or uploaded files.
• If the question is about transactions or spending, call \`get_user_transactions\` first.
• For app features or help, use \`file_search\`.
• For market/economic questions, use \`web_search\`.

Use one tool only per question. Today is ${today}.
Current user ID: ${targetUserId}`;

    console.log('[📤 Initial Input]', input);

    const initialResponse = await openai.responses.create({
      model: MODEL,
      input,
      instructions,
      tools,
      tool_choice: 'auto'
    });

    console.log('[📥 Initial Response]', JSON.stringify(initialResponse, null, 2));

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');
    if (!toolCall) {
      const fallback = initialResponse.output?.find(item => item.type === 'message')?.content?.[0]?.text;
      return res.json({ message: fallback || 'Sorry, I couldn’t generate a response.' });
    }

    const args = JSON.parse(toolCall.arguments);
    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    console.log('[✅ Tool Output]', result);

    const followUp = await openai.responses.create({
      model: MODEL,
      input: [
        ...input,
        toolCall,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(result)
        }
      ],
      instructions,
      tools
    });

    console.log('[🧠 Final AI Response]', JSON.stringify(followUp, null, 2));

    const reply = followUp.output?.find(item => item.type === 'message');
    const text = reply?.content?.find(c => c.type === 'output_text')?.text ||
                 reply?.content?.find(c => c.type === 'text')?.text;

    return res.json({
      message: text || `No transactions found between ${args.start_date} and ${args.end_date}. Want to try a different range?`
    });

  } catch (err) {
    console.error('❌ Error in /ask handler:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
});

// 🔄 Transaction fetcher with pagination
async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const allTransactions = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const constraints = [
      { key: 'Account Holder', constraint_type: 'equals', value: userId },
      { key: 'Date', constraint_type: 'greater than', value: startDate },
      { key: 'Date', constraint_type: 'less than', value: endDate }
    ];

    const url = `${BUBBLE_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&cursor=${cursor}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${BUBBLE_API_KEY}`
      }
    });

    const data = await response.json();

    if (!data?.response?.results) {
      throw new Error('No transaction data returned from Bubble');
    }

    allTransactions.push(
      ...data.response.results.map(tx => ({
        date: tx.Date,
        amount: tx.Amount,
        merchant: tx['Merchant Name'] || tx.Description || 'Unknown',
        category: tx['Category Description'] || tx['Category (Old)'] || 'Uncategorized',
        category_details: tx['Category Details'] || null,
        account: tx['Account'] || 'Unspecified',
        bank: tx['Bank'] || null
      }))
    );

    if (data.response.remaining === 0 || !data.response.remaining) {
      hasMore = false;
    } else {
      cursor += data.response.count || 100;
    }
  }

  return {
    totalCount: allTransactions.length,
    transactions: allTransactions
  };
}

// 🚀 Launch server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere server running on port ${PORT}`);
});
