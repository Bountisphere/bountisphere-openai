import axios from 'axios';

const CLOUD_URL = 'https://bountisphere-openai-617952217530.us-central1.run.app';

async function testAssistant(question, userId = 'test-user-123') {
    try {
        console.log(`\nTesting question: "${question}"`);
        console.log('Making request to:', `${CLOUD_URL}/assistant`);
        console.log('Request payload:', JSON.stringify({
            input: question,
            userId: userId,
            startDate: '2024-01-01',
            endDate: '2024-12-31'
        }, null, 2));
        
        const response = await axios.post(`${CLOUD_URL}/assistant`, {
            input: question,
            userId: userId,
            startDate: '2024-01-01',
            endDate: '2024-12-31'
        });

        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        console.log('Response data:', JSON.stringify(response.data, null, 2));
        console.log('----------------------------------------');
    } catch (error) {
        console.error('\nError testing question:', question);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response headers:', error.response.headers);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
            console.error('Response config:', JSON.stringify({
                url: error.response.config.url,
                method: error.response.config.method,
                headers: error.response.config.headers,
                data: error.response.config.data
            }, null, 2));
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Error setting up request:', error.message);
        }
        console.error('----------------------------------------');
    }
}

async function runTests() {
    console.log('🚀 Starting cloud endpoint tests...');
    console.log('----------------------------------------');

    // Test with a simple question first
    await testAssistant('Hello, can you help me with my finances?');

    // If the first test succeeds, run the other tests
    await testAssistant('What was my total spending in the last month?');
    await testAssistant('Calculate my average transaction amount');
    await testAssistant("What's my spending pattern and can you suggest a budget?");
    await testAssistant('Show me my highest transaction in the last 3 months');

    console.log('✅ Tests completed!');
}

runTests(); 