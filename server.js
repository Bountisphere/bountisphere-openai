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

const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions, including date, amount, category, and merchant.",
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'The unique ID of the Bountisphere user'
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive)'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive)'
        }
      },
      required: ['userId', 'start_date', 'end_date'],
      additionalProperties: false
    }
  }
];

app.post('/ask', async (req, res) => {
  const { userMessage, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  try {
    const input = [
      {
        role: 'user',
        content: userMessage
      }
    ];

    const instructions = `
You are the Bountisphere Money Coach — a friendly, supportive, and expert financial assistant.

Your goal is to help users make better financial decisions by answering questions with the right tools.

• If the question is about the user's **transactions, spending, or budgeting**, always call the \`get_user_transactions\` function first. Never answer these questions without seeing their transactions.

• If the question is about how to use Bountisphere, app features, onboarding, or support topics, use the \`file_search\` tool to find answers in our documentation.

• If the question is about **markets, the economy, inflation, investing trends, or external news**, use the \`web_search_preview\` tool to retrieve up-to-date information.

Do not mix tools. Use only one tool per question. Prioritize accuracy and relevance.

Current logged in user is ${targetUserId}. Today's date is ${new Date().toDateString()}.
`.trim();

    const initialResponse = await openai.beta.responses.create({
      model: MODEL,
      input,
      instructions,
      tools,
      tool_choice: 'auto'
    });

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');
    if (!toolCall) {
      const textResponse = initialResponse.output?.find(item => item.type === 'message')?.content?.[0]?.text;
      return res.json({ message: textResponse || 'Sorry, I wasn’t able to generate a response.' });
    }

    const args = JSON.parse(toolCall.arguments);
    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    console.log('[✅ Function Call Result]', result);

    const followUp = await openai.beta.responses.create({
      model: MODEL,
      input: [
        ...input,
        toolCall,
        {
          type: 'tool_output',
          tool_call_id: toolCall.call_id,
          output: JSON.stringify(result)
        }
      ],
      instructions,
      tools
    });

    const reply = followUp.output?.find(item => item.type === 'message');
    const text = reply?.content?.find(c => c.type === 'output_text')?.text;

    if (!text) {
      return res.json({
        message: `You don’t seem to have any transactions between ${args.start_date} and ${args.end_date}. Want to try a different date range?`
      });
    }

    return res.json({ message: text });

  } catch (err) {
    console.error('❌ Error in /ask:', err);
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
