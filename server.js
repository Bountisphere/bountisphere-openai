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

// get_user_transactions endpoint: Retrieves transactions from Bubble
app.post('/get_user_transactions', async (req, res) => {
  try {
    const { userId, startDate, endDate } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    
    // Build constraints array using only required parameters
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

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
