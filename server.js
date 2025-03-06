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

// Endpoint to fetch latest transactions from Bubble (Filtered by userId)
app.post('/transactions', async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'User ID is required' });

        // Apply Bubble API constraints to filter by userId
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=[{"key":"Created By","constraint_type":"equals","value":"${userId}"}]`;

        const response = await axios.get(bubbleURL, {
            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
        });

        res.json(response.data);
    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Endpoint to analyze transactions with OpenAI
app.post('/analyze', async (req, res) => {
    try {
        const { transactions } = req.body;
        if (!transactions || transactions.length === 0) {
            return res.status(400).json({ error: 'No transactions provided' });
        }

        const prompt = `Analyze the following transactions and provide insights: ${JSON.stringify(transactions)}`;
        
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [{ role: 'system', content: prompt }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        res.json(openAIResponse.data);
    } catch (error) {
        console.error('Error analyzing transactions:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
