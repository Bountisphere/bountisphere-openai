// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware to parse JSON requests
app.use(express.json());

// 🔹 Health Check Route
app.get('/', (req, res) => {
  res.send('🚀 Bountisphere OpenAI API is running!');
});

// 🔹 Fetch **All Past Transactions** (Excludes Future Transactions)
app.post('/transactions', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const today = new Date().toISOString().split("T")[0];

    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
        {"key":"Created By","constraint_type":"equals","value":"${userId}"},
        {"key":"Date","constraint_type":"less than","value":"${today}"},
        {"key":"is_pending?","constraint_type":"equals","value":"false"}
    ]`;

    console.log("🌍 Fetching past transactions from:", bubbleURL);

    const response = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });

    const transactions = response.data?.response?.results || [];

    console.log(`✅ Retrieved ${transactions.length} past transactions`);
    res.json(transactions);

  } catch (error) {
    console.error("❌ Error fetching past transactions:", error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔹 Analyze **All Past Transactions** with OpenAI using Function Calling
app.post('/analyze-transactions', async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const today = new Date().toISOString().split("T")[0];

    // 🔥 Step 1: Fetch Past Transactions
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
        {"key":"Created By","constraint_type":"equals","value":"${userId}"},
        {"key":"Date","constraint_type":"less than","value":"${today}"}
    ]`;

    console.log("🌍 Fetching past transactions from:", bubbleURL);

    const transactionResponse = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });

    const transactions = transactionResponse.data?.response?.results || [];

    if (transactions.length === 0) {
      return res.json({ message: "No past transactions found for analysis." });
    }

    // 🔥 Step 2: Send Past Transactions to OpenAI for Analysis
    const openAIResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: "system", content: "You are a financial assistant providing insights on spending habits, recurring charges, and budgeting strategies." },
        { role: "user", content: `Analyze the user's past transactions up to ${today}. Identify spending trends, recurring expenses, and budgeting opportunities based on these transactions:` },
        { role: "user", content: JSON.stringify(transactions, null, 2) }
      ],
      functions: [
        {
          name: "analyze_spending",
          description: "Analyze past spending trends, recurring expenses, and budgeting opportunities",
          parameters: {
            type: "object",
            properties: {
              total_spent: { type: "number", description: "Total amount spent in the given period" },
              top_categories: { type: "array", items: { type: "string" }, description: "Most frequent spending categories" },
              recurring_expenses: { type: "array", items: { type: "string" }, description: "Recurring transactions detected" },
              savings_opportunities: { type: "array", items: { type: "string" }, description: "Potential areas where spending could be reduced" }
            }
          }
        }
      ],
      function_call: "auto",
      temperature: 0.7
    });

    console.log("✅ OpenAI Response Received");
    res.json(openAIResponse);

  } catch (error) {
    console.error("❌ Error processing /analyze-transactions:", error.response?.data || error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔹 Handle General Questions About Data
app.post('/ask-question', async (req, res) => {
  try {
    const { userId, question } = req.body;

    if (!userId || !question) {
      return res.status(400).json({ error: 'User ID and question are required' });
    }

    // 🔥 Step 1: Fetch Relevant Data
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
        {"key":"Created By","constraint_type":"equals","value":"${userId}"}
    ]`;

    console.log("🌍 Fetching data from Bubble for question:", question);

    const dataResponse = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });

    const data = dataResponse.data?.response?.results || [];

    if (data.length === 0) {
      return res.json({ message: "No data found to answer your question." });
    }

    // 🔥 Step 2: Send Question and Data to OpenAI
    const openAIResponse = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { 
          role: "system", 
          content: "You are a helpful assistant that analyzes financial data and answers questions about transactions, spending patterns, and financial insights. Provide clear, concise answers based on the available data." 
        },
        { 
          role: "user", 
          content: `Here is the user's data and question. Please analyze the data and answer the question: "${question}"\n\nData: ${JSON.stringify(data, null, 2)}` 
        }
      ],
      temperature: 0.7
    });

    console.log("✅ OpenAI Response Received");
    res.json({
      answer: openAIResponse.choices[0].message.content,
      data_used: data.length
    });

  } catch (error) {
    console.error("❌ Error processing question:", error.response?.data || error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🔹 OpenAI Responses API Endpoint
app.post('/assistant', async (req, res) => {
  try {
    // Extract the relevant fields from the request body
    const { model, tools, input, instructions, functions } = req.body;
    // We'll expect the userId from the query string or body
    const userId = req.query.userId || req.body.userId;

    console.log("📥 Received request with userId:", userId);

    // Validate user ID
    if (!userId) {
      console.error("❌ No userId provided in request");
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Validate input
    if (!input) {
      console.error("❌ No input provided in request");
      return res.status(400).json({ error: 'Input is required' });
    }

    // 🔥 Step 1: Verify user exists in Bubble
    const userURL = `${process.env.BUBBLE_API_URL}/user?constraints=[
        {"key":"_id","constraint_type":"equals","value":"${userId}"}
    ]`;

    console.log("🔍 Verifying user:", userId);

    try {
      const userResponse = await axios.get(userURL, {
        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
      });

      if (!userResponse.data?.response?.results?.length) {
        console.error("❌ User not found in Bubble:", userId);
        return res.status(404).json({ error: 'User not found' });
      }

      console.log("✅ User verified:", userId);

      // 🔥 Step 2: Create the initial response with OpenAI's Responses API
      const response = await openai.responses.create({
        model: model || 'gpt-4',
        tools: tools || [],
        input: input,
        instructions:
          instructions ||
          "You are the Bountisphere AI Money Coach. Always be aware of the real date when answering questions. If the user asks about their transactions, call the 'get_user_transactions' function to retrieve their financial data.",
        functions: functions || [
          // If you didn't provide functions in the request body, define them here
          {
            name: "get_user_transactions",
            description: "Fetch a user's transactions from the Bountisphere endpoint for analysis",
            parameters: {
              type: "object",
              properties: {
                userId: {
                  type: "string",
                  description: "The user ID whose transactions we need to fetch"
                }
              },
              required: ["userId"]
            }
          }
        ],
        metadata: {
          userId: userId,
          userEmail: userResponse.data.response.results[0].email
        }
      });

      console.log("✅ Initial OpenAI response received");

      // 🔥 Step 3: Handle function calls if any
      if (response.output && response.output.length > 0) {
        for (const output of response.output) {
          if (output.type === 'function_call' && output.name === 'get_user_transactions') {
            // 3A. Extract arguments from the function call
            const { userId: functionUserId } = output.arguments;

            console.log("🌍 The model is requesting transactions for user:", functionUserId);

            // 3B. Fetch transactions from your /transactions endpoint
            const transactionResponse = await axios.post(
              // If your server is the same, you can use a relative path:
              // `${process.env.API_SERVER_URL}/transactions`
              // or your direct URL:
              'https://bountisphere-openai-617952217530.us-central1.run.app/transactions',
              { userId: functionUserId }
            );

            const transactions = transactionResponse.data;
            console.log("✅ Transactions retrieved:", transactions.length, "records");

            // 3C. Return the transaction data as the function call result
            const followUpResponse = await openai.responses.create({
              model: model || 'gpt-4',
              input,
              instructions:
                instructions ||
                "You are the Bountisphere AI Money Coach. Always be aware of the real date when answering questions.",
              metadata: {
                userId: functionUserId,
                userEmail: userResponse.data.response.results[0].email
              },
              // Let the AI know we've satisfied the function call
              function_call_result: {
                name: 'get_user_transactions',
                data: {
                  transactions
                }
              },
              previous_response_id: response.id
            });

            console.log("✅ Follow-up response after providing transactions");
            return res.json(followUpResponse);
          }
        }
      }

      // If no function calls were made, return the initial response
      res.json(response);

    } catch (bubbleError) {
      console.error("❌ Error calling Bubble API:", bubbleError.response?.data || bubbleError.message);
      return res.status(500).json({
        error: 'Error accessing Bubble API',
        details: bubbleError.response?.data || bubbleError.message
      });
    }
  } catch (error) {
    console.error("❌ Error processing response request:", error.response?.data || error.message);
    return res.status(500).json({
      error: 'Internal server error',
      details: error.response?.data || error.message
    });
  }
});

// 🔹 Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
