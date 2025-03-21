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

// 🔹 OpenAI Responses API Endpoint
app.post('/assistant', async (req, res) => {
    try {
        const { input } = req.body;
        const userId = req.query.userId;

        console.log("📥 Received request with userId:", userId);

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // 🔥 Step 1: Initial OpenAI call
        const response = await axios.post('https://api.openai.com/v1/responses', {
            model: "gpt-4o-mini",
            tools: [
                {
                    type: "file_search",
                    vector_store_ids: ["vs_JScHftFeKAv35y4QHPz9QwMb"]
                },
                {
                    type: "web_search_preview"
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
                }
            ],
            input: input,
            instructions: `You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user's question involves transaction details, call the 'get_user_transactions' function with the userId provided in the prompt. userId is '${userId}'.`
        }, {
            headers: {
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log("✅ Initial OpenAI response received:", response.data.id);

        // 🔥 Step 2: Handle function calls if present
        const functionCall = response.data.output.find(out => out.type === 'function_call');
        
        if (functionCall && functionCall.name === 'get_user_transactions') {
            // Fetch transactions from Bubble
            const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[
                {"key":"Created By","constraint_type":"equals","value":"${userId}"},
                {"key":"is_pending?","constraint_type":"equals","value":"false"}
            ]&sort_field=Date&sort_direction=descending`;

            const transactionResponse = await axios.get(bubbleURL, {
                headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
            });

            const transactions = transactionResponse.data?.response?.results || [];
            
            // Send transactions back to OpenAI for analysis
            const analysisResponse = await axios.post('https://api.openai.com/v1/responses', {
                model: "gpt-4o-mini",
                input: `Based on these transactions, ${input} Transactions: ${JSON.stringify(transactions)}`,
                instructions: "Analyze the transactions and provide a clear, specific answer to the user's question."
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            });

            return res.json({
                success: true,
                answer: analysisResponse.data.output[0]?.content || "Analysis completed",
                transactions: transactions
            });
        }

        // If no function calls, return the initial response
        res.json({
            success: true,
            answer: response.data.output[0]?.content || "No transaction analysis needed"
        });

    } catch (error) {
        console.error("❌ Error:", error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
