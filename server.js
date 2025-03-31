import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 🧪 Log OpenAI version info
console.log('[🧪 OpenAI SDK VERSION]', OpenAI.VERSION || 'VERSION not available');
console.log('[🧪 OpenAI Instance Methods]', Object.keys(openai?.beta?.responses || {}).join(', ') || 'responses not available');

const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const DEFAULT_USER_ID = '1735159562002x959413891769328900';

// 🔧 Tool definitions
const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions, including date, amount, category, and merchant.",
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
  }
];

// 🧠 AI endpoint
app.post('/ask', async (req, res) => {
  const { userMessage, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

// Assistant endpoint
app.post('/ask', async (req, res) => {
  try {
    console.log('\n=== Starting new request ===');
    console.log('Request body:', req.body);
    
    const { userMessage, threadId, model = "gpt-4" } = req.body;
    if (!userMessage || !threadId) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: {
          error: {
            message: `Missing required parameter: ${!userMessage ? 'userMessage' : 'threadId'}`,
            type: "invalid_request_error",
            param: !userMessage ? 'userMessage' : 'threadId',
            code: "missing_required_parameter"
          }
        }
      });
    }

    console.log('\n=== Making initial OpenAI request ===');
    // Create initial response using OpenAI Responses API
    const response = await openai.responses.create({
      model: model,
      input: userMessage,
      tools: tools
    });

    console.log('[📥 Initial Response]', JSON.stringify(initialResponse, null, 2));

    let finalAnswer = '';
    let responseMetadata = {};

    // Process function calls and messages
    for (const item of response.output) {
      if (item.type === 'message') {
        finalAnswer = item.content;
      } else if (item.type === 'function_call' && item.name === 'get_user_transactions') {
        try {
          const functionArgs = JSON.parse(item.arguments);
          functionArgs.userId = functionArgs.userId || threadId;

          // Get transactions from Bubble API
          const transactions = await getBubbleTransactions(
            functionArgs.userId,
            functionArgs.startDate,
            functionArgs.endDate,
            functionArgs.bank,
            functionArgs.account
          );

          // Process transactions
          const simplifiedTransactions = transactions
            .filter(t => t.is_pending !== "yes")
            .map(t => ({
              account: t.Account,
              bank: t.Bank,
              amount: t.Amount,
              date: t.Date,
              merchant: t["Merchant Name"],
              category: t["Category Description"]
            }));

          // Limit transactions
          const MAX_TRANSACTIONS = 50;
          const limitedTransactions = simplifiedTransactions.slice(0, MAX_TRANSACTIONS);
          
          // Create summary
          const transactionSummary = {
            total_transactions: simplifiedTransactions.length,
            showing_transactions: limitedTransactions.length,
            transactions: limitedTransactions,
            note: simplifiedTransactions.length > MAX_TRANSACTIONS ? 
              `Note: Only showing ${MAX_TRANSACTIONS} most recent transactions out of ${simplifiedTransactions.length} total transactions.` : 
              undefined
          };

          // Get final response with transaction data
          const finalResponse = await openai.responses.create({
            model: "gpt-4",
            input: userMessage,
            tools: tools,
            function_results: [
              {
                name: "get_user_transactions",
                content: JSON.stringify(transactionSummary)
              }
            ]
          });

          // Extract final answer
          for (const output of finalResponse.output) {
            if (output.type === 'message') {
              finalAnswer = output.content;
              break;
            }
          }

          responseMetadata = {
            type: "transaction_response",
            total_transactions: transactionSummary.total_transactions,
            shown_transactions: transactionSummary.showing_transactions
          };
        } catch (error) {
          console.error('\n=== Error processing transactions ===');
          console.error('Error:', error);
          finalAnswer = "I apologize, but I encountered an error while trying to fetch your transactions. Please try again or contact support if the issue persists.";
        }
      }
    }

    const args = JSON.parse(toolCall.arguments);
    const result = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    console.log('[✅ Tool Output]', result);

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

    console.log('[🧠 Final AI Response]', JSON.stringify(followUp, null, 2));

    const reply = followUp.output?.find(item => item.type === 'message');
    const text =
      reply?.content?.find(c => c.type === 'output_text')?.text ||
      reply?.content?.find(c => c.type === 'text')?.text;

    return res.json({
      message: text || `No transactions found between ${args.start_date} and ${args.end_date}. Want to try a different range?`
    });

  } catch (err) {
    console.error('\n=== Error in /ask endpoint ===');
    console.error('Error:', err);
    return res.status(500).json({
      success: false,
      error: "Assistant failed",
      details: err.message
    });
  }
});

// 🔄 Transaction fetcher
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

// 🚀 Launch server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere server running on port ${PORT}`);
});
