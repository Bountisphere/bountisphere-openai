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

        // Fetch latest transactions from Bubble
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[{"key":"Created By","constraint_type":"equals","value":"${user_unique_id}"}]`;
        console.log("🌍 Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = response.data?.response?.results || [];
        console.log("✅ Transactions received:", transactions);

        if (transactions.length === 0) {
            return res.json({ message: "No transactions found for this user." });
        }

        // Categorize Transactions
        const categories = {
            "Dining": ["restaurant", "fast food", "coffee", "starbucks", "mcdonalds"],
            "Groceries": ["supermarket", "grocery", "whole foods", "trader joe's"],
            "Entertainment": ["netflix", "hulu", "spotify", "movie", "concert"],
            "Bills": ["utility", "electric", "gas", "water", "phone"],
            "Shopping": ["amazon", "target", "walmart", "mall"]
        };

        const categorizedTransactions = {};
        transactions.forEach(tx => {
            for (let [category, keywords] of Object.entries(categories)) {
                if (keywords.some(keyword => tx.description?.toLowerCase().includes(keyword))) {
                    categorizedTransactions[category] = (categorizedTransactions[category] || 0) + Math.abs(tx.amount);
                }
            }
        });

        // 🔥 Build dynamic prompt based on user message
        let prompt;
        
        if (message.toLowerCase().includes("spending") || message.toLowerCase().includes("categories")) {
            prompt = `The user asked: "${message}". Based on their transactions, here is a summary of spending by category: 
            
            ${JSON.stringify(categorizedTransactions, null, 2)}

            Provide insights and trends on their spending.`;
        } 
        else if (message.toLowerCase().includes("credit card")) {
            const creditTransactions = transactions.filter(tx => tx.account_type === "credit_card");
            const totalCreditBalance = creditTransactions.reduce((sum, tx) => sum + tx.amount, 0);

            prompt = `The user asked: "${message}". Based on their credit card transactions, their total outstanding balance is $${totalCreditBalance}. 
            
            Provide insights on whether their debt is increasing or decreasing and how they can manage it effectively.`;
        }
        else if (message.toLowerCase().includes("deposit") || message.toLowerCase().includes("savings")) {
            const depositTransactions = transactions.filter(tx => tx.amount > 0);
            const totalDeposits = depositTransactions.reduce((sum, tx) => sum + tx.amount, 0);

            prompt = `The user asked: "${message}". They have deposited a total of $${totalDeposits} into their accounts in the last period. 
            
            Provide insights on their saving patterns and suggest ways to improve.`;
        }
        else if (message.toLowerCase().includes("overdraft") || message.toLowerCase().includes("risk")) {
            const checkingTransactions = transactions.filter(tx => tx.account_type === "checking");
            const totalCheckingBalance = checkingTransactions.reduce((sum, tx) => sum + tx.amount, 0);
            const futurePayments = transactions.filter(tx => tx.scheduled && tx.amount < 0);
            const projectedBalance = totalCheckingBalance + futurePayments.reduce((sum, tx) => sum + tx.amount, 0);

            prompt = `The user asked: "${message}". Their current checking balance is $${totalCheckingBalance}. 
            
            Based on upcoming scheduled payments, their projected balance will be $${projectedBalance}. 

            Provide insights on whether they are at risk of overdraft and suggest strategies to prevent it.`;
        }
        else {
            prompt = `The user asked: "${message}". However, no specific transactions match the request. Provide general financial insights based on their spending patterns.`;
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
