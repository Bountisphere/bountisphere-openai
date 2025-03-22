// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['OPENAI_API_KEY', 'BUBBLE_API_URL', 'BUBBLE_API_KEY'];
for (const varName of requiredEnvVars) {
  if (!process.env[varName]) {
    console.error(`ERROR: Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI API client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Middleware to parse JSON requests
app.use(express.json());

/**
 * Helper function to calculate a 12-month date range.
 * If an end date is provided (as a string in ISO format), it uses that.
 * Otherwise, it uses the current date as the end date.
 * The start date is calculated as 12 months before the end date.
 */
function getDateRange(providedEndDate) {
  const currentDate = providedEndDate ? new Date(providedEndDate) : new Date();
  const endDate = new Date(currentDate);
  const startDate = new Date(currentDate);
  startDate.setFullYear(startDate.getFullYear() - 1);
  const formattedEndDate = endDate.toISOString().split('T')[0];
  const formattedStartDate = startDate.toISOString().split('T')[0];
  return { formattedStartDate, formattedEndDate };
}

// 🔹 Health Check Route
app.get('/', (req, res) => {
  res.send('🚀 Bountisphere OpenAI API is running!');
});

// 🔹 Fetch Transactions Endpoint (Last 12 Months)
app.post('/transactions', async (req, res) => {
  try {
    const { userId, endDate: userEndDate } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const { formattedStartDate, formattedEndDate } = getDateRange(userEndDate);
    const constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "is_pending?", "constraint_type": "equals", "value": "false" },
      { "key": "Date", "constraint_type": "greater than or equal", "value": formattedStartDate },
      { "key": "Date", "constraint_type": "less than or equal", "value": formattedEndDate }
    ];
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

    console.log("🌍 Fetching transactions from:", bubbleURL);
    console.log("📅 Date range:", { formattedStartDate, formattedEndDate });
    console.log("🔍 Constraints:", constraints);

    const response = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });
    const transactions = response.data?.response?.results || [];
    const debugInfo = {
      totalTransactions: transactions.length,
      dateRange: transactions.length > 0 ? {
        earliest: transactions[transactions.length - 1].Date,
        latest: transactions[0].Date,
        currentServerTime: new Date().toISOString(),
        requestedDateRange: { startDate: formattedStartDate, endDate: formattedEndDate }
      } : null,
      query: {
        url: bubbleURL,
        constraints,
        userId
      }
    };

    console.log(`✅ Retrieved ${transactions.length} transactions`);
    res.json({
      success: true,
      transactions,
      debug: debugInfo,
      pagination: {
        cursor: response.data?.response?.cursor,
        remaining: response.data?.response?.remaining
      }
    });
  } catch (error) {
    console.error("❌ Error fetching transactions:", error.response?.data || error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// 🔹 Analyze Transactions Endpoint (Last 12 Months)
app.post('/analyze-transactions', async (req, res) => {
  try {
    const { userId, endDate: userEndDate } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const { formattedStartDate, formattedEndDate } = getDateRange(userEndDate);
    const constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "Date", "constraint_type": "greater than or equal", "value": formattedStartDate },
      { "key": "Date", "constraint_type": "less than or equal", "value": formattedEndDate }
    ];
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

    console.log("🌍 Fetching transactions for analysis from:", bubbleURL);
    const transactionResponse = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });
    const transactions = transactionResponse.data?.response?.results || [];
    if (transactions.length === 0) {
      return res.json({ message: "No transactions found for analysis in the last 12 months." });
    }
    const openAIResponse = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: "system", content: "You are a financial assistant providing insights on spending habits, recurring charges, and budgeting strategies." },
        { role: "user", content: `Analyze the user's transactions from ${formattedStartDate} to ${formattedEndDate}. Identify spending trends, recurring expenses, and budgeting opportunities:` },
        { role: "user", content: JSON.stringify(transactions) }
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

// 🔹 Ask Question Endpoint (Last 12 Months)
app.post('/ask-question', async (req, res) => {
  try {
    const { userId, question, endDate: userEndDate } = req.body;
    if (!userId || !question) {
      return res.status(400).json({ error: 'User ID and question are required' });
    }
    const { formattedStartDate, formattedEndDate } = getDateRange(userEndDate);
    const constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "Date", "constraint_type": "greater than or equal", "value": formattedStartDate },
      { "key": "Date", "constraint_type": "less than or equal", "value": formattedEndDate }
    ];
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

    console.log("🌍 Fetching transaction data from Bubble for question:", question);
    const dataResponse = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });
    const data = dataResponse.data?.response?.results || [];
    if (data.length === 0) {
      return res.json({ message: "No data found in the last 12 months to answer your question." });
    }
    const openAIResponse = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4',
      messages: [
        { role: "system", content: "You are a helpful assistant that analyzes financial data and answers questions about transactions, spending patterns, and financial insights." },
        { role: "user", content: `Here is the user's transaction data from ${formattedStartDate} to ${formattedEndDate} and question: "${question}"\n\nData: ${JSON.stringify(data)}` }
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

// 🔹 OpenAI Assistant Endpoint (Reduced Data Version)
app.post('/assistant', async (req, res) => {
  try {
    const { input, endDate: userEndDate } = req.body;
    const userId = req.query.userId?.trim();
    console.log("📥 Received /assistant request with userId:", userId);
    if (!userId || !input) {
      return res.status(400).json({ error: 'User ID and input are required' });
    }
    const { formattedStartDate, formattedEndDate } = getDateRange(userEndDate);
    const constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "is_pending?", "constraint_type": "equals", "value": "false" },
      { "key": "Date", "constraint_type": "greater than or equal", "value": formattedStartDate },
      { "key": "Date", "constraint_type": "less than or equal", "value": formattedEndDate }
    ];
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
    console.log("🌍 Fetching transactions from:", bubbleURL);
    const transactionResponse = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });
    const transactions = transactionResponse.data?.response?.results || [];
    console.log(`✅ Retrieved ${transactions.length} transactions`);

    // Simplify transaction data to essential fields only
    const formattedTransactions = transactions.map(t => ({
      date: t.Date ? new Date(t.Date).toLocaleString() : '',
      amount: parseFloat(t.Amount).toFixed(2),
      bank: t.Bank || '',
      description: t.Description || 'No description',
      category: t['Category (Old)'] || t.Category || 'Uncategorized',
      transaction_type: t['Transaction Type'] || ''
    }));
    
    // Limit the payload to the top 20 transactions
    const maxTransactions = 20;
    const limitedTransactions = formattedTransactions.slice(0, maxTransactions);
    const transactionsString = JSON.stringify(limitedTransactions);

    const debugInfo = {
      totalTransactions: transactions.length,
      usedTransactions: limitedTransactions.length,
      dateRange: transactions.length > 0 ? {
        earliest: transactions[transactions.length - 1].Date,
        latest: transactions[0].Date,
        currentServerTime: new Date().toISOString(),
        requestedDateRange: { startDate: formattedStartDate, endDate: formattedEndDate }
      } : null,
      query: {
        url: bubbleURL,
        constraints,
        userId
      }
    };

    const openAIResponse = await client.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. When analyzing transactions, focus on the most recent and relevant transactions, include bank names and transaction types, use categories and descriptions for context, and format amounts with currency codes."
        },
        {
          role: "user",
          content: `Please analyze these transactions from ${formattedStartDate} to ${formattedEndDate} and answer the following question: ${input}\n\nTransactions: ${transactionsString}`
        }
      ],
      temperature: 0.7
    });
    
    res.json({
      success: true,
      answer: openAIResponse.choices[0].message.content,
      transactions: limitedTransactions,
      debug: debugInfo
    });
  } catch (error) {
    console.error("❌ Error in /assistant endpoint:", error.response?.data || error.message);
    res.status(500).json({ 
      error: 'Internal server error', 
      details: error.message,
      stack: error.stack
    });
  }
});

// 🔹 Test Endpoint for Transaction Date Verification
app.get('/api/test-transactions', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    const { formattedStartDate, formattedEndDate } = getDateRange();
    const constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "Date", "constraint_type": "greater than or equal", "value": formattedStartDate },
      { "key": "Date", "constraint_type": "less than or equal", "value": formattedEndDate }
    ];
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending`;
    console.log('🔍 Test endpoint URL:', bubbleURL);
    const response = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });
    const transactions = response.data?.response?.results || [];
    const debugInfo = {
      requestInfo: {
        userId,
        dateRange: { startDate: formattedStartDate, endDate: formattedEndDate },
        currentTime: new Date().toISOString(),
        constraints: JSON.parse(decodeURIComponent(bubbleURL.split('constraints=')[1].split('&')[0]))
      },
      responseInfo: {
        totalTransactions: transactions.length,
        dateRange: transactions.length > 0 ? {
          earliest: transactions[transactions.length - 1].Date,
          latest: transactions[0].Date
        } : null,
        firstTransaction: transactions.length > 0 ? {
          date: transactions[0].Date,
          createdDate: transactions[0]["Created Date"],
          modifiedDate: transactions[0]["Modified Date"],
          createdBy: transactions[0]["Created By"]
        } : null,
        rawResponse: response.data
      }
    };
    res.json(debugInfo);
  } catch (error) {
    console.error('❌ Error in test-transactions endpoint:', error);
    res.status(500).json({ error: 'Failed to fetch transactions', details: error.message, response: error.response?.data });
  }
});

// 🔹 Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
