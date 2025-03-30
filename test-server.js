import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function testAssistant(question, userId = 'test-user-123') {
    try {
        console.log(`\nTesting question: "${question}"`);
        console.log('Making request to:', `${BASE_URL}/assistant`);
        
        const response = await axios.post(`${BASE_URL}/assistant`, {
            input: question,
            userId: userId,
            startDate: '2024-01-01',
            endDate: '2024-12-31'
        });

        console.log('Response status:', response.status);
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        console.log('----------------------------------------');
    } catch (error) {
        console.error('\nError testing question:', question);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
        console.error('----------------------------------------');
    }
}

async function runTests() {
    console.log('🚀 Starting server tests...');
    console.log('Environment variables loaded:', {
        PORT: process.env.PORT,
        BUBBLE_API_URL: process.env.BUBBLE_API_URL ? 'Set' : 'Not set',
        BUBBLE_API_KEY: process.env.BUBBLE_API_KEY ? 'Set' : 'Not set',
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? 'Set' : 'Not set'
    });
    console.log('----------------------------------------');

    // Test web search type question
    await testAssistant('What was my total spending in the last month?');

    // Test function call type question
    await testAssistant('Calculate my average transaction amount');

    // Test mixed type question
    await testAssistant("What's my spending pattern and can you suggest a budget?");

    // Test specific transaction question
    await testAssistant('Show me my highest transaction in the last 3 months');

    console.log('✅ Tests completed!');
}

runTests(); 