// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());

// 🔹 Health Check Route
app.get('/', (req, res) => {
  res.send('🚀 Bountisphere OpenAI API is running!');
});

// 🔹 Fetch All Past Transactions (Excludes Future Transactions)
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

// Start the Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
