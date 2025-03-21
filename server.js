// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI API
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware to parse JSON requests
app.use(express.json());

// 🔹 Health Check Route
app.get('/', (req, res) => {
    res.send('🚀 Bountisphere OpenAI API is running!');
});

// 🔹 Fetch Transactions (Basic endpoint)
app.post('/transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"},
            {"key":"is_pending?","constraint_type":"equals","value":"false"}
        ]&sort_field=Date&sort_direction=descending`;

        console.log("🌍 Fetching transactions from:", bubbleURL);

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = response.data?.response?.results || [];
        console.log(`✅ Retrieved ${transactions.length} transactions`);
        res.json(transactions);

    } catch (error) {
        console.error("❌ Error fetching transactions:", error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Analyze **All Past Transactions** with OpenAI using Function Calling
app.post('/analyze-transactions', async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const today = new Date().toISOString().split("T")[0];

        // 🔥 Step 1: Fetch Past Transactions
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"},
            {"key":"Date","constraint_type":"less than","value":"${today}"}
        ]`;

        console.log("🌍 Fetching past transactions from:", bubbleURL);

        const transactionResponse = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const transactions = transactionResponse.data?.response?.results || [];

        if (transactions.length === 0) {
            return res.json({ message: "No past transactions found for analysis." });
        }

        // 🔥 Step 2: Send Past Transactions to OpenAI for Analysis
        const openAIResponse = await client.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: "system", content: "You are a financial assistant providing insights on spending habits, recurring charges, and budgeting strategies." },
                { role: "user", content: `Analyze the user's past transactions up to ${today}. Identify spending trends, recurring expenses, and budgeting opportunities based on these transactions:` },
                { role: "user", content: JSON.stringify(transactions, null, 2) }
            ],
            functions: [
                {
                    name: "analyze_spending",
                    description: "Analyze past spending trends, recurring expenses, and budgeting opportunities",
                    parameters: {
                        type: "object",
                        properties: {
                            total_spent: { type: "number", description: "Total amount spent in the given period" },
                            top_categories: { type: "array", items: { type: "string" }, description: "Most frequent spending categories" },
                            recurring_expenses: { type: "array", items: { type: "string" }, description: "Recurring transactions detected" },
                            savings_opportunities: { type: "array", items: { type: "string" }, description: "Potential areas where spending could be reduced" }
                        }
                    }
                }
            ],
            function_call: "auto",
            temperature: 0.7
        });

        console.log("✅ OpenAI Response Received");
        res.json(openAIResponse);

    } catch (error) {
        console.error("❌ Error processing /analyze-transactions:", error.response?.data || error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 Handle General Questions About Data
app.post('/ask-question', async (req, res) => {
    try {
        const { userId, question } = req.body;

        if (!userId || !question) {
            return res.status(400).json({ error: 'User ID and question are required' });
        }

        // 🔥 Step 1: Fetch Relevant Data
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
            {"key":"Created By","constraint_type":"equals","value":"${userId}"}
        ]`;

        console.log("🌍 Fetching data from Bubble for question:", question);

        const dataResponse = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        const data = dataResponse.data?.response?.results || [];

        if (data.length === 0) {
            return res.json({ message: "No data found to answer your question." });
        }

        // 🔥 Step 2: Send Question and Data to OpenAI
        const openAIResponse = await client.chat.completions.create({
            model: process.env.OPENAI_MODEL || 'gpt-4',
            messages: [
                { 
                    role: "system", 
                    content: "You are a helpful assistant that analyzes financial data and answers questions about transactions, spending patterns, and financial insights. Provide clear, concise answers based on the available data." 
                },
                { 
                    role: "user", 
                    content: `Here is the user's data and question. Please analyze the data and answer the question: "${question}"\n\nData: ${JSON.stringify(data, null, 2)}` 
                }
            ],
            temperature: 0.7
        });

        console.log("✅ OpenAI Response Received");
        res.json({
            answer: openAIResponse.choices[0].message.content,
            data_used: data.length
        });

    } catch (error) {
        console.error("❌ Error processing question:", error.response?.data || error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 🔹 OpenAI Responses API Endpoint
app.post('/assistant', async (req, res) => {
    try {
        const { input, tools } = req.body;
        const userId = req.query.userId;

        console.log("📥 Received request with userId:", userId);

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // 🔥 Step 1: Create the OpenAI response
        const response = await client.responses.create({
            model: "gpt-4o-mini",
            tools: tools || [
                {
                    type: "file_search",
                    vector_store_ids: ["vs_JScHftFeKAv35y4QHPz9QwMb"]
                },
                {
                    type: "function",
                    name: "get_user_transactions",
                    description: "Fetch a user's transactions from the Bountisphere endpoint for analysis",
                    parameters: {
                        type: "object",
                        properties: {
                            userId: {
                                type: "string",
                                description: "The user ID whose transactions we need to fetch"
                            }
                        },
                        required: ["userId"]
                    }
                },
                {
                    type: "web_search_preview"
                }
            ],
            input: `My user ID is ${userId}. ${input}`,
            instructions: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user's question involves transaction details, call the 'get_user_transactions' function with the userId provided in the prompt."
        });

        console.log("✅ Initial OpenAI response received");

        // 🔥 Step 2: Handle function calls if any
        if (response.output && response.output.length > 0) {
            for (const output of response.output) {
                if (output.type === 'function_call' && output.name === 'get_user_transactions') {
                    // Fetch transactions directly from Bubble
                    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
                        {"key":"Created By","constraint_type":"equals","value":"${userId}"},
                        {"key":"is_pending?","constraint_type":"equals","value":"false"}
                    ]&sort_field=Date&sort_direction=descending&limit=3`;

                    console.log("🌍 Fetching transactions for user:", userId);

                    const transactionResponse = await axios.get(bubbleURL, {
                        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
                    });

                    const transactions = transactionResponse.data?.response?.results || [];
                    console.log(`✅ Retrieved ${transactions.length} transactions`);

                    // Create a summarized version of transactions
                    const transactionSummary = transactions.slice(0, 3).map(t => ({
                        date: t.Date,
                        amount: t.Amount,
                        description: t.Description
                    }));

                    // Make a follow-up call to OpenAI with the tool outputs
                    const followUpResponse = await client.responses.create({
                        model: "gpt-4o-mini",
                        input: input,
                        instructions: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. Analyze the transactions provided and answer the user's question.",
                        previous_response_id: response.id,
                        tool_call_results: [
                            {
                                tool_call_id: output.id,
                                output: JSON.stringify(transactionSummary)
                            }
                        ]
                    });

                    return res.json(followUpResponse);
                }
            }
        }

        // If no function calls were made, return the initial response
        res.json(response);

    } catch (error) {
        console.error("❌ Error processing response request:", error.response?.data || error.message);
        return res.status(500).json({
            error: 'Internal server error',
            details: error.response?.data || error.message
        });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
