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
    res.send('Bountisphere OpenAI API is running!');
});

// 🔹 Fetch Only **Past Transactions** (Exclude Future & Pending)
app.post('/transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            console.error("🚨 Error: User ID is missing!");
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

        console.log("✅ Past transactions received:", response.data);
        res.json(response.data);
    } catch (error) {
        console.error("❌ Error fetching past transactions:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Fetch Only **Future Transactions** (For Upcoming Bills)
app.post('/future-transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const today = new Date().toISOString().split("T")[0];

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"},
            {"key":"Date","constraint_type":"greater than","value":"${today}"}
        ]`;

        console.log("🌍 Fetching future transactions from:", bubbleURL);
        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        console.log("✅ Future transactions received:", response.data);
        res.json(response.data);
    } catch (error) {
        console.error("❌ Error fetching future transactions:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Assistant API - Handles User Queries and Fetches Past Transactions
app.post('/assistant', async (req, res) => {
    try {
        const { user_unique_id, message } = req.body;  
        
        if (!user_unique_id || !message) {
            return res.status(400).json({ error: 'Missing user ID or message' });
        }

        console.log("🛠 Received request at /assistant:", req.body);

        const today = new Date().toISOString().split("T")[0];

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${user_unique_id}"},
            {"key":"Date","constraint_type":"less than","value":"${today}"},
            {"key":"is_pending?","constraint_type":"equals","value":"false"}
        ]`;

        console.log("🌍 Fetching past transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = response.data?.response?.results || [];
        console.log("✅ Past transactions received:", transactions.length, "transactions");

        let prompt;
        if (transactions.length > 0) {
            prompt = `Based on the user's past transactions, provide insights related to their question: "${message}". Transactions:\n\n${transactions.map(tx => `- $${Math.abs(tx.Amount)} at ${tx.Description} on ${tx.Date}`).join("\n")}`;
        } else {
            prompt = `The user asked: "${message}". No matching past transactions were found. Provide general financial advice.`;
        }

        // 🔥 Call OpenAI Assistant API
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: "You are a financial assistant providing transaction insights." }, { role: 'user', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ OpenAI Response:", openAIResponse.data);
        res.json(openAIResponse.data);

    } catch (error) {
        console.error("❌ Error processing /assistant:", error.response?.data || error.message);
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

        const prompt = `Analyze the following past transactions and provide insights:\n\n${transactions.map(tx => `- $${Math.abs(tx.Amount)} at ${tx.Description} on ${tx.Date}`).join("\n")}`;

        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: "You are a financial assistant providing transaction insights." }, { role: 'user', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(openAIResponse.data);
    } catch (error) {
        console.error("❌ Error analyzing transactions:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
