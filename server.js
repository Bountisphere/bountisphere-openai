// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON requests
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// 🔹 Health Check Route
app.get('/', (req, res) => {
    res.send('Bountisphere OpenAI API is running!');
});

// 🔹 Fetch **All Past Transactions** (Excludes Future Transactions)
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

// 🔹 Analyze Transactions with OpenAI **Function Calling**
app.post('/ask-money-coach', async (req, res) => {
    try {
        const userQuery = req.body.query;
        const userId = req.body.userId;

        if (!userQuery || !userId) {
            return res.status(400).json({ error: 'User query and user ID are required' });
        }

        console.log("🤖 User asked:", userQuery);

        const response = await openai.chat.completions.create({
            model: process.env.OPENAI_MODEL || "gpt-4-turbo",
            messages: [{ role: "user", content: userQuery }],
            functions: [
                {
                    name: "get_transactions",
                    description: "Retrieve user transactions based on filters such as date, category, or amount.",
                    parameters: {
                        type: "object",
                        properties: {
                            user_id: { type: "string", description: "User's unique ID in Bubble." },
                            date_range: { type: "string", description: "Timeframe for transactions, e.g., 'last month' or '2024-02-01 to 2024-02-29'." },
                            category: { type: "string", description: "Transaction category, e.g., 'Groceries'." },
                            min_amount: { type: "number", description: "Minimum transaction amount." },
                            max_amount: { type: "number", description: "Maximum transaction amount." }
                        },
                        required: ["user_id"]
                    }
                }
            ]
        });

        if (response.choices[0].message.function_call) {
            const functionName = response.choices[0].message.function_call.name;
            const functionArgs = JSON.parse(response.choices[0].message.function_call.arguments);

            if (functionName === "get_transactions") {
                const transactions = await getTransactions(functionArgs);
                return res.json({ response: transactions });
            }
        }

        res.json({ response: response.choices[0].message.content });

    } catch (error) {
        console.error("❌ Error processing AI request:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Fetch Transactions Based on Filters (Used in Function Calling)
async function getTransactions({ user_id, date_range, category, min_amount, max_amount }) {
    let constraints = [
        { key: "Created By", constraint_type: "equals", value: user_id }
    ];

    if (date_range) {
        const [startDate, endDate] = date_range.split(" to ");
        constraints.push(
            { key: "Date", constraint_type: "greater than", value: startDate },
            { key: "Date", constraint_type: "less than", value: endDate }
        );
    }

    if (category) {
        constraints.push({ key: "Category", constraint_type: "equals", value: category });
    }

    if (min_amount) {
        constraints.push({ key: "Amount", constraint_type: "greater than", value: min_amount });
    }

    if (max_amount) {
        constraints.push({ key: "Amount", constraint_type: "less than", value: max_amount });
    }

    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${JSON.stringify(constraints)}`;

    console.log("🔍 Fetching transactions with filters:", constraints);

    try {
        const response = await axios.get(bubbleURL, {
            headers: { Authorization: `Bearer ${process.env.BUBBLE_API_KEY}` }
        });
        return response.data.response.results;
    } catch (error) {
        console.error("❌ Error fetching filtered transactions:", error.message);
        return [];
    }
}

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
