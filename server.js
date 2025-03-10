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

// Function to standardize category descriptions
const mapCategory = (category) => {
    const categoryMapping = {
        "FOOD_AND_DRINK_GROCERIES": "Groceries",
        "FOOD_AND_DRINK_RESTAURANT": "Dining Out",
        "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES": "Online Shopping",
        "TRANSPORTATION_GAS": "Gasoline",
        "BANK_FEES_INTEREST_CHARGE": "Bank Fees",
        "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT": "Credit Card Payment",
        "GENERAL_SERVICES_OTHER_GENERAL_SERVICES": "Subscriptions",
        "EXPENSE_BUSINESS_SERVICES": "Business Expenses"
    };
    return categoryMapping[category] || "Other";
};

// 🔹 Fetch Only **Past Transactions** (Exclude Future & Pending)
app.post('/transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            console.error("🚨 Error: User ID is missing!");
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split("T")[0];

        // Fetch only past transactions (exclude future & pending)
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"},
            {"key":"Date","constraint_type":"less than","value":"${today}"},
            {"key":"is_pending?","constraint_type":"equals","value":"false"}
        ]`;

        console.log("🌍 Fetching past transactions from:", bubbleURL);
        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        let transactions = response.data?.response?.results || [];

        // Filter out mislabeled "Future Transactions" if the date is already in the past
        transactions = transactions.filter(tx => tx["Transaction Frequency"] !== "Future Transactions");

        // Map category names to standard format
        transactions = transactions.map(tx => ({
            date: tx.Date,
            amount: tx.Amount,
            description: tx.Description,
            merchant: tx["Merchant Name"] || tx.Description,
            category: mapCategory(tx["Personal Finance Category"]),
            bank: tx.Bank
        }));

        console.log("✅ Cleaned past transactions:", transactions);
        res.json(transactions);
    } catch (error) {
        console.error("❌ Error fetching past transactions:", error.message);
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

        console.log("🛠 Received request at /assistant");

        // Fetch past transactions (only completed transactions)
        const transactionsResponse = await axios.post('https://bountisphere-openai-617952217530.us-central1.run.app/transactions', {
            userId: user_unique_id
        });

        let transactions = transactionsResponse.data || [];
        if (transactions.length === 0) {
            return res.json({ message: "No past transactions found for this user." });
        }

        // Filter transactions based on user query
        let filteredTransactions = transactions.filter(tx => 
            tx.description.toLowerCase().includes(message.toLowerCase()) || 
            tx.category.toLowerCase().includes(message.toLowerCase())
        );

        let prompt;
        if (["spend", "transaction", "budget", "expense", "bill", "balance"].some(word => message.toLowerCase().includes(word))) {
            if (filteredTransactions.length > 0) {
                prompt = `Today's date is ${new Date().toISOString().split("T")[0]}. The user asked: "${message}". Based on their past transactions, here are the relevant transactions:\n\n${filteredTransactions.map(tx => `- $${Math.abs(tx.amount)} at ${tx.merchant} on ${tx.date} (Category: ${tx.category})`).join("\n")}\n\nProvide an analysis.`;
            } else {
                prompt = `Today's date is ${new Date().toISOString().split("T")[0]}. The user asked: "${message}". However, no matching past transactions were found. Provide general financial insights based on their spending habits.`;
            }
        } else {
            prompt = `Today's date is ${new Date().toISOString().split("T")[0]}. The user asked: "${message}". Respond only to their question.`;
        }

        // 🔥 Call OpenAI API
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [{ role: 'system', content: "You are a financial assistant providing transaction insights." }, { role: 'user', content: prompt }]
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }
        });

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
