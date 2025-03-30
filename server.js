import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());

// Define the function (tool) schema
const tools = [
  {
    type: "function",
    description: "Return the user's recent financial transactions",
    name: "get_user_transactions",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The unique ID of the Bountisphere user"
        },
        startDate: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format"
        },
        endDate: {
          type: "string",
          description: "Optional end date in YYYY-MM-DD format"
        }
      },
      required: ["userId"]
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

    // Create initial response using OpenAI Responses API
    const response = await axios.post('https://api.openai.com/v1/responses', {
      instructions: `You are the Bountisphere Money Coach. The current user's ID is ${userId}. When analyzing transactions, automatically use this ID to fetch the data. Help users understand their transactions and financial patterns.`,
      model: "gpt-4o-mini-2024-07-18",
      text: { format: { type: "text" } },
      tools: tools,
      output: [
        {
          type: "message",
          role: "user",
          content: input
        }
      ]
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Find function call or message in the output
    const functionCall = response.data.output.find(o => o.type === "function_call");
    const messageOutput = response.data.output.find(o => o.type === "message");

    // Initialize response variables
    let finalAnswer;
    let responseMetadata = {};

    // Check if we need to handle transactions
    if (functionCall && functionCall.name === "get_user_transactions") {
      // Parse the function arguments
      const functionArgs = JSON.parse(functionCall.arguments);
      
      // Add userId if not provided in the function call
      functionArgs.userId = functionArgs.userId || userId;

      // Get default date range (last 12 months)
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      // Prepare Bubble API request
      const constraints = [
        { 
          "key": "Account Holder", 
          "constraint_type": "equals", 
          "value": functionArgs.userId 
        },
        {
          "key": "Date",
          "constraint_type": "greater than",
          "value": (functionArgs.startDate || startDate) + "T00:00:00.000Z"
        },
        {
          "key": "Date",
          "constraint_type": "less than",
          "value": (functionArgs.endDate || endDate) + "T00:00:00.000Z"
        }
      ];

      // Call Bubble API
      const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
      console.log("Fetching transactions from:", bubbleURL);
      
      const bubbleResponse = await axios.get(bubbleURL, {
        headers: { 
          'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      const transactions = bubbleResponse.data?.response?.results || [];
      console.log(`Retrieved ${transactions.length} transactions from Bubble.`);

      // Filter out pending transactions and simplify transaction objects
      const simplifiedTransactions = transactions
        .filter(t => t.is_pending !== "yes")
        .map(t => ({
          account: t.Account,
          bank: t.Bank,
          amount: t.Amount,
          date: t.Date,
          day: t["Date / Day of Month"],
          month: t.Month,
          year: t.Year,
          merchant: t["Merchant Name"],
          category: t["Category Description"]
        }));

      // Limit transactions to reduce token usage
      const MAX_TRANSACTIONS = 50;
      const limitedTransactions = simplifiedTransactions.slice(0, MAX_TRANSACTIONS);
      
      // Create a summary if we limited transactions
      const transactionSummary = {
        total_transactions: simplifiedTransactions.length,
        showing_transactions: limitedTransactions.length,
        transactions: limitedTransactions,
        note: simplifiedTransactions.length > MAX_TRANSACTIONS ? 
          `Note: Only showing ${MAX_TRANSACTIONS} most recent transactions out of ${simplifiedTransactions.length} total transactions to stay within API limits.` : 
          undefined
      };

      // Get final response with transaction data
      const finalResponse = await axios.post('https://api.openai.com/v1/responses', {
        instructions: `You are the Bountisphere Money Coach. Help users understand their transactions and financial patterns. ${transactionSummary.note || ''}`,
        model: "gpt-4o-mini-2024-07-18",
        text: { format: { type: "text" } },
        tools: tools,
        output: [
          {
            type: "message",
            role: "user",
            content: input
          },
          {
            type: "function_result",
            name: "get_user_transactions",
            content: JSON.stringify(transactionSummary)
          }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });

      // Extract the text response from the message output
      const finalMessageOutput = finalResponse.data.output.find(o => o.type === "message");
      finalAnswer = finalMessageOutput?.content[0]?.text || "Sorry, I couldn't analyze your transactions.";
      
      responseMetadata = {
        type: "transaction_response",
        total_transactions: transactionSummary.total_transactions,
        shown_transactions: transactionSummary.showing_transactions
      };
    } else {
      // Direct response (like web search results)
      finalAnswer = messageOutput?.content[0]?.text || "I couldn't process your request.";
      responseMetadata = {
        type: "direct_response"
      };

      // Extract citations if they exist
      const urlMatch = finalAnswer.match(/\[([^\]]+)\]\(([^)]+)\)/g);
      if (urlMatch) {
        responseMetadata.citations = urlMatch.map(citation => {
          const [_, text, url] = citation.match(/\[([^\]]+)\]\(([^)]+)\)/);
          return { text, url };
        });
      }
    }

    // Return data in a format easy for Bubble to handle
    return res.json({
      success: true,
      data: {
        answer: finalAnswer,
        metadata: responseMetadata
      }
    });

  } catch (err) {
    console.error("❌ /assistant error:", err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bountisphere AI server running at http://localhost:${PORT}`);
  console.log('Environment Configuration:');
  console.log('- BUBBLE_API_URL:', process.env.BUBBLE_API_URL);
  console.log('- OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing');
  console.log('- Bubble API Key:', process.env.BUBBLE_API_KEY ? '✓ Set' : '✗ Missing');
});
