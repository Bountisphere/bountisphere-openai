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
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// Middleware to parse JSON requests
app.use(express.json());

// 🔹 Health Check Route
app.get('/', (req, res) => {
    res.send('🚀 Bountisphere OpenAI API is running!');
});

// 🔹 Fetch All Past Transactions (Excludes Future Transactions)
app.post('/transactions', async (req, res) => {
    // ... your existing transactions endpoint code ...
});

// 🔹 OpenAI Responses API Endpoint
app.post('/assistant', async (req, res) => {
    try {
        const { input } = req.body;
        const userId = req.query.userId;

        console.log("📥 Received request with userId:", userId);

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // 🔥 Step 1: Initial OpenAI Response
        const initialResponse = await openai.responses.create({
            model: "gpt-4o-mini",
            tools: [
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

        // 🔥 Step 2: Handle function calls
        if (initialResponse.output && initialResponse.output.length > 0) {
            for (const output of initialResponse.output) {
                if (output.type === 'function_call' && output.name === 'get_user_transactions') {
                    console.log("🔄 Function call detected, fetching transactions");

                    // Fetch transactions from Bubble
                    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
                        {"key":"Created By","constraint_type":"equals","value":"${userId}"},
                        {"key":"is_pending?","constraint_type":"equals","value":"false"}
                    ]&sort_field=Date&sort_direction=descending&limit=3`;

                    console.log("🌍 Fetching transactions for user:", userId);

                    const transactionResponse = await axios.get(bubbleURL, {
                        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
                    });

                    const transactions = transactionResponse.data?.response?.results || [];

                    // 🔥 Step 3: Follow-up OpenAI Response with transactions
                    const followUpResponse = await openai.responses.create({
                        model: "gpt-4o-mini",
                        input: input,
                        instructions: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. Analyze the provided transactions and answer the user's question.",
                        metadata: {
                            transactions: transactions
                        },
                        previous_response_id: initialResponse.id
                    });

                    console.log("✅ Follow-up response received with transaction analysis");
                    return res.json(followUpResponse);
                }
            }
        }

        // If no function calls were made, return the initial response
        console.log("✅ No function calls needed, returning initial response");
        res.json(initialResponse);

    } catch (error) {
        console.error("❌ Error:", error.response?.data || error.message);
        return res.status(500).json({ 
            error: 'Internal server error',
            details: error.response?.data || error.message
        });
    }
});

// Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
