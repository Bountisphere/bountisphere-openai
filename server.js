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

// 🔹 Fetch Recent Transactions from Bubble
app.post('/transactions', async (req, res) => {
    console.log("📥 Incoming Request Body:", req.body); // 🛠 Debugging step

    try {
        const { userId, limit = 5 } = req.body;
        
        if (!userId) {
            console.error("❌ Missing userId in request.");
            return res.status(400).json({ error: 'User ID is required' });
        }

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"}
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
            category: txn["Category Description"] || "Uncategorized",
            is_pending: txn["is_pending?"] ? "Yes (Pending)" : "No"
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
            userId, // ✅ Correctly passing userId
            limit
        });

        console.log("✅ Transactions successfully retrieved for OpenAI.");
        res.json(transactionsResponse.data);

    } catch (error) {
        console.error("❌ Error fetching transactions for OpenAI:", error.message);
        res.status(500).json({ error: 'Failed to fetch transactions' });
    }
});

// 🔹 Analyze Transactions with OpenAI
app.post('/analyze-transactions', async (req, res) => {
    console.log("📥 /analyze-transactions Request Body:", req.body); // 🛠 Debugging step

    try {
        const { userId } = req.body;
        
        if (!userId) {
            console.error("❌ Missing userId for analysis.");
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Fetch past transactions
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"}
        ]`;

        console.log("🌍 Fetching past transactions from:", bubbleURL);

        const transactionResponse = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = transactionResponse.data?.response?.results || [];

        if (transactions.length === 0) {
            return res.json({ message: "No past transactions found for analysis." });
        }

        // 🔥 Send Past Transactions to OpenAI for Analysis
        const openAIResponse = await axios.post(
            'https://api.openai.com/v1/responses',
            {
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                input: `Analyze the user's past transactions. Identify spending trends, recurring expenses, and budgeting opportunities:\n\n${JSON.stringify(transactions, null, 2)}`,
                instructions: "You are a financial assistant providing insights on spending habits, recurring charges, and budgeting strategies.",
                temperature: 0.7,
                userId  // ✅ Now correctly included
            },
            {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log("✅ OpenAI Response Received");
        res.json(openAIResponse.data);

    } catch (error) {
        console.error("❌ Error processing /analyze-transactions:", error.response?.data || error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
