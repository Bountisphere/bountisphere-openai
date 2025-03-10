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
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

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

        // 🛠️ Detect Recurring Transactions
        const recurringTransactions = transactions.filter(tx => 
            transactions.filter(t => t.description === tx.description).length > 3
        );

        // 🛠️ Financial Query Matching
        let prompt;
        if (message.toLowerCase().includes("spend") || 
            message.toLowerCase().includes("transaction") || 
            message.toLowerCase().includes("budget") || 
            message.toLowerCase().includes("expense") || 
            message.toLowerCase().includes("bill") ||
            message.toLowerCase().includes("balance") ||
            message.toLowerCase().includes("interest") ||
            message.toLowerCase().includes("fees")) {

            // 🛠️ Build Enhanced Financial Analysis Prompt
            prompt = `Today's date is ${today}. The user asked: "${message}". Based on their transactions, here is the analysis:

            📊 **Categorized Spending Summary**
            ${JSON.stringify(categorizedTransactions, null, 2)}

            🔁 **Recurring Transactions Detected**
            ${JSON.stringify(recurringTransactions, null, 2)}

            🔥 **Spending Trends**
            Analyze if the user's spending in any category is increasing or decreasing. Provide insights and suggestions.`;

        } else {
            // Non-financial questions get direct responses
            prompt = `Today's date is ${today}. The user asked: "${message}". Respond only to their question without adding any additional transaction details.`;
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

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
