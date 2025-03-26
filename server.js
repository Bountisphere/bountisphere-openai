import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI API client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  defaultQuery: { 'api-version': '2024-02-15' },
  defaultHeaders: { 'api-type': 'openai' }
});

app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.send('🚀 Bountisphere OpenAI API is running!');
});

// /transactions endpoint: Retrieves transactions from Bubble using constraints
app.post('/transactions', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Build constraints array without an optional query
    let constraints = [
      { "key": "Created By", "constraint_type": "equals", "value": userId },
      { "key": "is_pending?", "constraint_type": "equals", "value": "false" }
    ];
    if (startDate) {
      constraints.push({ "key": "Date", "constraint_type": "greater than", "value": startDate });
    }
    if (endDate) {
      constraints.push({ "key": "Date", "constraint_type": "less than", "value": endDate });
    }

    // Construct the Bubble API URL
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
    console.log("Fetching transactions from:", bubbleURL);

    const response = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });

    const transactions = response.data?.response?.results || [];
    console.log(`✅ Retrieved ${transactions.length} transactions.`);
    res.json({ success: true, transactions });
  } catch (error) {
    console.error("Error in /transactions endpoint:", error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// /assistant endpoint: Processes user questions and provides a production-ready answer
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!userId || !input) {
      return res.status(400).json({ error: 'User ID and input are required' });
    }

    // Fetch transactions from the Bubble API using our /transactions logic.
    // In production, you might want to call an internal function instead.
    const transactionsResponse = await axios.post(`http://localhost:${PORT}/transactions`, {
      userId,
      startDate,
      endDate
    });
    const transactions = transactionsResponse.data.transactions || [];

    // Format transactions for the prompt (adjust as needed for brevity)
    const formattedTransactions = transactions.map(tx => ({
      date: tx.Date,
      amount: tx.Amount,
      description: tx.Description || ''
    }));

    // Build the prompt for the OpenAI API
    const systemMessage = "You are the Bountisphere Money Coach. Provide insightful, data-driven financial advice based on the user's transaction history.";
    const userMessage = `User question: ${input}\n\nTransaction Data:\n${JSON.stringify(formattedTransactions, null, 2)}`;

    console.log("Sending prompt to OpenAI:", { systemMessage, userMessage });

    // Call the OpenAI API using the configured client
    const openAIResponse = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userMessage }
      ],
      temperature: 0.7
    });

    const answer = openAIResponse.choices[0].message.content;
    res.json({ success: true, answer });
  } catch (error) {
    console.error("Error in /assistant endpoint:", error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
