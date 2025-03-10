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
        const { user_unique_id, message } = req.body;  
        if (!user_unique_id || !message) {
            return res.status(400).json({ error: 'Missing user ID or message' });
        }

        console.log("🛠 Received request at /assistant");
        console.log("🆔 User ID:", user_unique_id);
        console.log("💬 Message:", message);

        // Get today's date
        const today = new Date();
        const todayString = today.toISOString().split("T")[0]; // YYYY-MM-DD format

        // Helper function to calculate date ranges
        function getDateMonthsAgo(months) {
            let pastDate = new Date();
            pastDate.setMonth(pastDate.getMonth() - months);
            return pastDate.toISOString().split("T")[0];
        }

        // Determine if the query is time-based (e.g., "last 6 months")
        let startDate = null;
        if (message.toLowerCase().includes("last month")) {
            startDate = getDateMonthsAgo(1);
        } else if (message.toLowerCase().includes("last 6 months")) {
            startDate = getDateMonthsAgo(6);
        }

        // Fetch transactions from Bubble
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[{"key":"Created By","constraint_type":"equals","value":"${user_unique_id}"}]`;
        console.log("🌍 Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        let transactions = response.data?.response?.results || [];
        console.log("✅ Transactions received:", transactions.length);

        // 🛑 Check if there are transactions before calling OpenAI
        if (transactions.length === 0) {
            return res.json({ message: "No transactions found for this user." });
        }

        // Filter transactions by date range if requested
        if (startDate) {
            transactions = transactions.filter(tx => tx.date >= startDate && tx.date <= todayString);
        }

        // 🛠️ Categorize Transactions
        const categories = {
            "Groceries": ["whole foods", "trader joe's", "supermarket"],
            "Dining": ["restaurant", "starbucks", "mcdonald's", "coffee"],
            "Entertainment": ["netflix", "hulu", "spotify", "movie"],
            "Bills": ["utility", "electric", "gas", "water", "phone"],
            "Shopping": ["amazon", "target", "walmart"],
            "Interest & Fees": ["interest", "fee", "late payment"]
        };

        const categorizedTransactions = {};
        transactions.forEach(tx => {
            for (let [category, keywords] of Object.entries(categories)) {
                if (keywords.some(keyword => tx.description?.toLowerCase().includes(keyword))) {
                    categorizedTransactions[category] = (categorizedTransactions[category] || 0) + Math.abs(tx.amount);
                }
            }
        });

        // 🛠️ Summarize Transactions
        let totalAmount = transactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

        // 🛠️ Build Prompt for OpenAI
        let prompt;
        if (message.toLowerCase().includes("spend") || 
            message.toLowerCase().includes("transaction") || 
            message.toLowerCase().includes("budget") || 
            message.toLowerCase().includes("expense") || 
            message.toLowerCase().includes("bill") ||
            message.toLowerCase().includes("balance") ||
            message.toLowerCase().includes("interest") ||
            message.toLowerCase().includes("fees")) {

            prompt = `Today's date is ${todayString}. The user asked: "${message}". Based on their transactions, here is the analysis:

            📊 **Categorized Spending Summary**
            ${JSON.stringify(categorizedTransactions, null, 2)}

            💰 **Total Spending in Time Period:** $${totalAmount.toFixed(2)}

            🔍 **Transaction Breakdown**
            ${JSON.stringify(transactions.slice(0, 5), null, 2)}

            Provide financial insights based on this data.`;
        } else {
            prompt = `Today's date is ${todayString}. The user asked: "${message}". Respond only to their question without adding any additional transaction details.`;
        }

        // 🔥 Call OpenAI API
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("🤖 OpenAI Response:", openAIResponse.data);
        res.json(openAIResponse.data);

    } catch (error) {
        console.error("❌ Error processing /assistant:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
