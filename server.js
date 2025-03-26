import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Health check route
app.get('/', (req, res) => {
  res.send('🚀 Bountisphere OpenAI API is running!');
});

// /get_user_transactions endpoint: Retrieves transactions from Bubble using constraints
app.post('/get_user_transactions', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // Build constraints array
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
    console.error("Error in /get_user_transactions endpoint:", error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

// /assistant endpoint: Processes user questions by fetching transaction data and returning a summary
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId, startDate, endDate } = req.body;
    if (!userId || !input) {
      return res.status(400).json({ error: 'User ID and input are required' });
    }

    // Fetch transactions using the same logic as in /get_user_transactions
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
    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
    console.log("Assistant: Fetching transactions from:", bubbleURL);

    const response = await axios.get(bubbleURL, {
      headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
    });

    const transactions = response.data?.response?.results || [];
    console.log(`Assistant: Retrieved ${transactions.length} transactions.`);

    // For now, generate a dummy summary using the last three transactions.
    // (In production, you might send this data to OpenAI for analysis.)
    const lastThree = transactions.slice(0, 3);
    const summary = lastThree.map(tx => {
      return `${tx.Date} - ${tx.Amount} - ${tx.Description || 'No description'}`;
    }).join('; ');

    const answer = `Based on your query "${input}", your last three transactions are: ${summary}.`;
    res.json({ success: true, answer, transactions: lastThree });
  } catch (error) {
    console.error("Error in /assistant endpoint:", error.message);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
