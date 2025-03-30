import axios from 'axios';

const API_URL = 'http://localhost:3000/assistant';

// Use the correct user ID
const TEST_USER_ID = '1735159562002x959413891769328900';

async function testAssistant(description, input) {
    try {
        console.log(`\n🧪 Testing: ${description}`);
        console.log(`Question: "${input}"`);
        console.log(`User ID: ${TEST_USER_ID}`);
        
        const response = await axios.post(API_URL, {
            input,
            userId: TEST_USER_ID
        });

        console.log('✅ Success!');
        console.log('Answer:', response.data.answer);
        console.log('----------------------------------------');
        return true;
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Response:', error.response.data);
            if (error.response.data?.details) {
                console.error('Details:', error.response.data.details);
            }
        }
        console.log('----------------------------------------');
        return false;
    }
}

async function runTests() {
    console.log('🚀 Starting one-call approach tests...\n');

    const tests = [
        {
            description: "Simple greeting (no function calls needed)",
            input: "Hi, can you help me understand my finances?"
        },
        {
            description: "Transaction query (should trigger function call)",
            input: "What was my total spending last month?"
        },
        {
            description: "Analysis request (should trigger function call)",
            input: "Can you analyze my spending patterns?"
        },
        {
            description: "Specific date range query",
            input: "Show me my transactions from January 2024"
        },
        {
            description: "March 2025 transactions",
            input: "Show me my transactions from March 2025"
        },
        {
            description: "Capital One transactions",
            input: "Show me my Capital One transactions from March 2025"
        },
        {
            description: "Chase checking account transactions",
            input: "Show me my Chase checking account transactions from March 2025"
        },
        {
            description: "Chase credit card transactions",
            input: "Show me my Chase credit card transactions from March 2025"
        }
    ];

    let successCount = 0;
    for (const test of tests) {
        const success = await testAssistant(test.description, test.input);
        if (success) successCount++;
        // Add a small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`\n📊 Test Summary: ${successCount}/${tests.length} tests passed`);
}

runTests().catch(console.error); 