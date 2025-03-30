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
    description: 'Return the user\'s recent financial transactions, including date, amount, category, and merchant.',
    parameters: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'The unique ID of the Bountisphere user'
        },
        start_date: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format (inclusive).'
        },
        end_date: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format (inclusive).'
        }
      },
      required: ['userId'],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: 'file_search',
    filters: null,
    max_num_results: 20,
    ranking_options: {
      ranker: 'auto',
      score_threshold: 0
    },
    vector_store_ids: ['vs_JScHftFeKAv35y4QHPz9QwMb']
  },
  {
    type: 'web_search_preview',
    search_context_size: 'medium',
    user_location: {
      type: 'approximate',
      city: null,
      country: 'US',
      region: null,
      timezone: null
    }
  }
];

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
      instructions: `You are the Bountisphere Money Coach — a friendly, supportive, and expert financial assistant.\n\nYour goal is to help users make better financial decisions by answering questions with the right tools.\n\n• If the question is about the user's transactions, spending, or budgeting, always call the get_user_transactions function first. Never answer these questions without seeing their transactions.\n\n• If the question is about how to use Bountisphere, app features, onboarding, or support topics, use the file_search tool to find answers in our documentation.\n\n• If the question is about markets, the economy, inflation, investing trends, or external news, use the web_search_preview tool to retrieve up-to-date information.\n\nDo not mix tools. Use only one tool per question. Prioritize accuracy and relevance.\n\nCurrent logged in user is ${targetUserId}. Today's date is ${new Date().toDateString()}.`
    });

    const toolCall = initialResponse.output?.find(item => item.type === 'function_call');

    if (!toolCall) {
      const textResponse = initialResponse.output
        ?.find(item => item.type === 'message')
        ?.content?.find(c => c.type === 'output_text')?.text;

      return res.json({ message: textResponse || '[No assistant response]' });
    }

    const args = JSON.parse(toolCall.arguments);
    console.log('[Tool Call Received]', toolCall.name, args);

    const result = await fetchTransactionsFromBubble(
      args.start_date || '2025-01-01',
      args.end_date || '2025-01-15',
      targetUserId
    );

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

    const textItem = followUp.output
      ?.find(item => item.type === 'message')
      ?.content?.find(c => c.type === 'output_text');

    const finalResponse = textItem?.text;
    console.log('[Final Assistant Message]', finalResponse);

    return res.json({
      message: finalResponse ||
        `You don’t seem to have any transactions between ${args.start_date} and ${args.end_date}. Want to try a different date range?`
    });

  } catch (err) {
    console.error('❌ Error in /ask:', err);
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
});

async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const constraints = [
    { key: 'Account Holder', constraint_type: 'equals', value: userId },
    { key: 'Date', constraint_type: 'greater than or equal to', value: startDate },
    { key: 'Date', constraint_type: 'less than or equal to', value: endDate }
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
