import express from 'express';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import cors from 'cors';

// Load environment variables
dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  console.log('Request body:', JSON.stringify(req.body, null, 2));
  next();
});

// Define the function (tool) schema
const tools = [
  {
    type: "function",
    name: "get_user_transactions",
    description: "Get transactions for a user within a date range, optionally filtered by bank and account",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The user ID to get transactions for"
        },
        startDate: {
          type: ["string", "null"],
          description: "Start date in YYYY-MM-DD format"
        },
        endDate: {
          type: ["string", "null"],
          description: "End date in YYYY-MM-DD format"
        },
        bank: {
          type: ["string", "null"],
          description: "Optional bank name to filter by (e.g., 'Capital One', 'Chase')"
        },
        account: {
          type: ["string", "null"],
          description: "Optional account name to filter by (e.g., 'Quicksilver', '360 Checking')"
        }
      },
      required: ["userId"],
      additionalProperties: false
    }
  }
];

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Bountisphere AI server is running!',
    environment: {
      bubbleApiConfigured: !!process.env.BUBBLE_API_URL && !!process.env.BUBBLE_API_KEY,
      openaiApiConfigured: !!process.env.OPENAI_API_KEY
    }
  });
});

// Assistant endpoint
app.post('/assistant', async (req, res) => {
  try {
    console.log('\n=== Starting new request ===');
    console.log('Request body:', req.body);
    
    const { input, userId } = req.body;
    if (!input || !userId) {
      return res.status(400).json({
        error: "Missing required parameters",
        details: {
          error: {
            message: `Missing required parameter: ${!input ? 'input' : 'userId'}`,
            type: "invalid_request_error",
            param: !input ? 'input' : 'userId',
            code: "missing_required_parameter"
          }
        }
      });
    }

    console.log('\n=== Making initial OpenAI request ===');
    // Create initial response using OpenAI Responses API
    const response = await openai.responses.create({
      model: "gpt-4o",
      input: input,
      tools: tools
    });

    console.log('\n=== OpenAI Response ===');
    console.log('Response:', JSON.stringify(response, null, 2));

    let finalAnswer = '';
    let responseMetadata = {};

    // Process function calls and messages
    for (const item of response.output) {
      if (item.type === 'message') {
        finalAnswer = item.content;
      } else if (item.type === 'function_call' && item.name === 'get_user_transactions') {
        try {
          const functionArgs = JSON.parse(item.arguments);
          functionArgs.userId = functionArgs.userId || userId;

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
            model: "gpt-4o",
            input: input,
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

    // Return the final response
    return res.json({
      success: true,
      data: {
        answer: finalAnswer,
        metadata: responseMetadata
      }
    });

  } catch (err) {
    console.error('\n=== Error in /assistant endpoint ===');
    console.error('Error:', err);
    return res.status(500).json({
      success: false,
      error: "Assistant failed",
      details: err.message
    });
  }
});

function inferAccountType(transaction) {
  let accountType = "Unknown";
  
  // First check Account field
  if (transaction.Account) {
    const accountLower = transaction.Account.toLowerCase();
    if (accountLower.includes('ckg') || accountLower.includes('checking')) {
      accountType = 'Checking';
    } else if (accountLower.includes('sav') || accountLower.includes('savings')) {
      accountType = 'Savings';
    } else if (accountLower.includes('cc') || accountLower.includes('credit')) {
      accountType = 'Credit Card';
    }
  }

  // If still unknown, check Description
  if (accountType === "Unknown" && transaction.Description) {
    const descLower = transaction.Description.toLowerCase();
    
    // Credit card indicators
    if (descLower.includes('credit card') || 
        descLower.includes('creditcard') ||
        descLower.includes('card payment') ||
        descLower.includes('card ending in')) {
      accountType = 'Credit Card';
    }
    
    // Checking indicators
    else if (descLower.includes('checking') ||
             descLower.includes('debit card') ||
             descLower.includes('atm') ||
             descLower.includes('direct deposit') ||
             descLower.includes('dir dep')) {
      accountType = 'Checking';
    }
    
    // Savings indicators
    else if (descLower.includes('savings') ||
             descLower.includes('interest payment') ||
             descLower.includes('interest earned')) {
      accountType = 'Savings';
    }
  }

  // If still unknown, try to infer from transaction type/category
  if (accountType === "Unknown" && transaction.Category) {
    const categoryLower = transaction.Category.toLowerCase();
    
    // Credit card likely categories
    if (categoryLower.includes('credit card payment') ||
        categoryLower.includes('card payment')) {
      accountType = 'Credit Card';
    }
    
    // Checking likely categories
    else if (categoryLower.includes('atm') ||
             categoryLower.includes('direct deposit') ||
             categoryLower.includes('transfer')) {
      accountType = 'Checking';
    }
    
    // Savings likely categories
    else if (categoryLower.includes('interest') ||
             categoryLower.includes('savings')) {
      accountType = 'Savings';
    }
  }

  return accountType;
}

function formatTransactionForOpenAI(transaction) {
  const bank = transaction.Bank || "Unknown Bank";
  const account = transaction.Account || "Unknown Account";
  const description = transaction.Description || "";
  const amount = transaction.Amount || 0;
  const date = transaction.Date || "";
  
  return {
    date,
    description: `${bank} ${account}: ${description}`,
    amount
  };
}

async function getBubbleTransactions(userId, startDate, endDate, bank, account) {
  const constraints = [
    {
      key: "Account Holder",
      constraint_type: "equals",
      value: userId
    }
  ];

  if (startDate) {
    constraints.push({
      key: "Date",
      constraint_type: "greater than",
      value: new Date(startDate).toISOString()
    });
  }

  if (endDate) {
    constraints.push({
      key: "Date",
      constraint_type: "less than",
      value: new Date(endDate).toISOString()
    });
  }

  if (bank) {
    constraints.push({
      key: "Bank",
      constraint_type: "equals",
      value: bank
    });
  }

  if (account) {
    constraints.push({
      key: "Account",
      constraint_type: "equals",
      value: account
    });
  }

  const queryParams = new URLSearchParams({
    constraints: JSON.stringify(constraints)
  });

  const url = `${process.env.BUBBLE_API_URL}/transactions?${queryParams}`;
  console.log("Fetching transactions from:", url);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw {
      statusCode: response.status,
      body: await response.json()
    };
  }

  const data = await response.json();
  return data.response.results;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bountisphere AI server running at http://localhost:${PORT}`);
  console.log('Environment Configuration:');
  console.log('- BUBBLE_API_URL:', process.env.BUBBLE_API_URL);
  console.log('- OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing');
  console.log('- Bubble API Key:', process.env.BUBBLE_API_KEY ? '✓ Set' : '✗ Missing');
});