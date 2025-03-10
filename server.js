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

// Health check route
app.get('/', (req, res) => {
    res.send('Bountisphere OpenAI API is running!');
});

// 🔹 Fetch Latest Transactions from Bubble (Filtered by userId)
app.post('/transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            console.error("🚨 Error: User ID is missing!");
            return res.status(400).json({ error: 'User ID is required' });
        }

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[{"key":"Created By","constraint_type":"equals","value":"${userId}"}]`;

        console.log("🌍 Fetching transactions from:", bubbleURL);
        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        console.log("✅ Transactions received:", response.data);
        res.json(response.data);
    } catch (error) {
        console.error("❌ Error fetching transactions:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Assistant API - Handles User Queries and Fetches Transactions
app.post('/assistant', async (req, res) => {
    try {
        const { assistantId, threadId, user_unique_id, message, accountId, version } = req.body;  
        if (!user_unique_id || !message) {
            return res.status(400).json({ error: 'Missing user ID or message' });
        }

        console.log("🛠 Received request at /assistant");
        console.log("🆔 User ID:", user_unique_id);
        console.log("💬 Message:", message);
        console.log("📌 Assistant ID:", assistantId);
        console.log("📌 Thread ID:", threadId);
        console.log("📌 Account ID:", accountId);

        // Fetch latest transactions from Bubble
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[{"key":"Created By","constraint_type":"equals","value":"${user_unique_id}"}]`;
        console.log("🌍 Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = response.data?.response?.results || [];
        console.log("✅ Transactions received:", transactions);

        // 🛑 Check if there are transactions before calling OpenAI
        if (transactions.length === 0) {
            return res.json({ message: "No transactions found for this user." });
        }

        // 🛠️ Filter transactions based on the user query (e.g., "Whole Foods")
        const filteredTransactions = transactions.filter(tx => 
            tx.description && tx.description.toLowerCase().includes(message.toLowerCase())
        );

        // 🛠️ Build a more dynamic OpenAI prompt
        let prompt;
        if (filteredTransactions.length > 0) {
            prompt = `The user asked: "${message}". Based on their transactions, here are the most relevant transactions:\n\n${JSON.stringify(filteredTransactions)}\n\nProvide an analysis of these transactions.`;
        } else {
            prompt = `The user asked: "${message}". However, no specific transactions match the request. Provide insights based on all transactions: \n\n${JSON.stringify(transactions)}`;
        }

        // 🔥 Call OpenAI API with GPT-4o
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!openAIResponse || !openAIResponse.data) {
            console.error("❌ OpenAI API did not return a valid response.");
            return res.status(500).json({ error: "Failed to get response from OpenAI" });
        }

        console.log("🤖 OpenAI Response:", openAIResponse.data);
        res.json(openAIResponse.data);

    } catch (error) {
        console.error("❌ Error processing /assistant:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Analyze Transactions
app.post('/analyze', async (req, res) => {
    try {
        const { transactions } = req.body;
        if (!transactions || transactions.length === 0) {
            return res.status(400).json({ error: 'No transactions provided' });
        }

        const prompt = `Analyze the following transactions and provide insights: ${JSON.stringify(transactions)}`;
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(openAIResponse.data);
    } catch (error) {
        console.error('❌ Error analyzing transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
