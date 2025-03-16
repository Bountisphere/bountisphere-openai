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
    res.send('✅ Bountisphere OpenAI API is running!');
});

// 🔹 Fetch Past Transactions from Bubble (No Future, No Pending)
app.post('/transactions', async (req, res) => {
    console.log("📥 Incoming Request Body:", req.body); // 🛠 Debugging step

    try {
        const { userId, limit = 5 } = req.body;
        
        if (!userId) {
            console.error("❌ Missing userId in request.");
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get today's date in Bubble-compatible format (YYYY-MM-DD)
        const todayDate = new Date().toISOString().split("T")[0];

        // Bubble API Query: Only Past Transactions (No Future, No Pending)
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"},
            {"key":"Date","constraint_type":"less than or equal","value":"${todayDate}"},
            {"key":"is_pending?","constraint_type":"equals","value":"false"}
        ]&limit=${limit}`;

        console.log("🌍 Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        console.log("📥 Bubble Response:", response.data); // 🛠 Debugging step

        const transactions = response.data?.response?.results || [];

        // 🛠 Format transactions for OpenAI
        const formattedTransactions = transactions.map(txn => ({
            id: txn._id,
            date: txn.Date,
            amount: txn.Amount,
            bank: txn.Bank || "Unknown Bank",
            description: txn.Description || "No Description",
            category: txn["Category Description"] || "Uncategorized"
        }));

        console.log(`✅ Retrieved ${formattedTransactions.length} transactions`);
        res.json({ transactions: formattedTransactions });

    } catch (error) {
        console.error("❌ Error fetching transactions:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Handle OpenAI Function Call for Transactions
app.post('/get-transactions', async (req, res) => {
    console.log("📥 /get-transactions Request Body:", req.body); // 🛠 Debugging step

    try {
        const { userId, limit } = req.body;
        
        if (!userId) {
            console.error("❌ Missing userId in OpenAI request.");
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Call the `/transactions` endpoint to get data
        const transactionsResponse = await axios.post(`${process.env.SERVER_URL}/transactions`, {
            userId,
            limit
        });

        console.log("✅ Transactions successfully retrieved for OpenAI.");
        
        // 🔹 OpenAI function call structured response
        res.json({
            "tool_calls": [
                {
                    "type": "function",
                    "name": "get_transactions",
                    "output": {
                        "transactions": transactionsResponse.data.transactions
                    }
                }
            ]
        });

    } catch (error) {
        console.error("❌ Error fetching transactions for OpenAI:", error.message);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
