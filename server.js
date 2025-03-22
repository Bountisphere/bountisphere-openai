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
        const { userId, startDate, endDate } = req.body;
        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // Build constraints array - start with just the user ID
        const constraints = [
            {"key": "Created By", "constraint_type": "equals", "value": userId},
            {"key": "is_pending?", "constraint_type": "equals", "value": "false"}
        ];

        // Add date constraint to get recent transactions
        const today = new Date().toISOString().split('T')[0];
        const ninetyDaysAgo = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
        constraints.push({"key": "Date", "constraint_type": "greater than", "value": ninetyDaysAgo});
        constraints.push({"key": "Date", "constraint_type": "less than", "value": today});

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

        console.log("🌍 Fetching transactions from:", bubbleURL);
        console.log("📅 Date range:", { ninetyDaysAgo, today });
        console.log("🔍 Constraints:", JSON.stringify(constraints, null, 2));

        try {
            // Log the full request details
            console.log("📤 Request details:", {
                url: bubbleURL,
                headers: {
                    'Authorization': 'Bearer [REDACTED]'
                }
            });

            const response = await axios.get(bubbleURL, {
                headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
            });

            // Log the full response
            console.log("📥 Response status:", response.status);
            console.log("📥 Response headers:", response.headers);
            console.log("📥 Response data:", JSON.stringify(response.data, null, 2));

            const transactions = response.data?.response?.results || [];
            
            // Add debug information
            const debugInfo = {
                totalTransactions: transactions.length,
                dateRange: transactions.length > 0 ? {
                    earliest: transactions[transactions.length - 1].Date,
                    latest: transactions[0].Date,
                    currentServerTime: new Date().toISOString(),
                    requestedDateRange: {
                        startDate: ninetyDaysAgo,
                        endDate: today
                    }
                } : null,
                query: {
                    url: bubbleURL,
                    constraints,
                    userId,
                    rawResponse: response.data,
                    pagination: {
                        cursor: response.data?.response?.cursor,
                        remaining: response.data?.response?.remaining
                    }
                },
                userInfo: transactions.length > 0 ? {
                    providedUserId: userId,
                    transactionCreatedBy: transactions[0]['Created By'],
                    userEmail: transactions[0].User_Email || null,
                    firstTransactionDetails: {
                        date: transactions[0].Date,
                        createdDate: transactions[0].Created_Date,
                        modifiedDate: transactions[0].Modified_Date
                    }
                } : null
            };

            console.log(`✅ Retrieved ${transactions.length} transactions`);
            console.log("📊 Full debug info:", JSON.stringify(debugInfo, null, 2));
            
            res.json({
                success: true,
                transactions,
                debug: debugInfo,
                pagination: {
                    cursor: response.data?.response?.cursor,
                    remaining: response.data?.response?.remaining
                }
            });

        } catch (error) {
            console.error("❌ Error fetching transactions:", error.response?.data || error.message);
            console.error("Full error:", error);
            console.error("Error response:", error.response?.data);
            console.error("Error status:", error.response?.status);
            console.error("Error headers:", error.response?.headers);
            console.error("Request URL:", error.config?.url);
            console.error("Request method:", error.config?.method);
            console.error("Request headers:", error.config?.headers);
            
            res.status(500).json({ 
                error: 'Internal server error', 
                details: error.message,
                url: error.config?.url || 'URL not available',
                response: error.response?.data,
                status: error.response?.status,
                requestDetails: {
                    method: error.config?.method,
                    headers: error.config?.headers ? Object.keys(error.config.headers) : null
                }
            });
        }
    } catch (error) {
        console.error("❌ Error fetching transactions:", error.response?.data || error.message);
        console.error("Full error:", error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
            url: error.config?.url || 'URL not available'
        });
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
        ]&sort_field=Date&sort_direction=descending&limit=100`;

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
        ]&sort_field=Date&sort_direction=descending&limit=100`;

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

// 🔹 OpenAI Assistant Endpoint
app.post('/assistant', async (req, res) => {
    try {
        const { input } = req.body;
        const userId = req.query.userId?.trim(); // Remove any whitespace or newlines

        console.log("📥 Received request with userId:", userId);

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // 🔥 Step 1: Fetch transactions with properly formatted URL
        const now = new Date();
        
        // Format dates to match Bubble's ISO format
        function formatDateForBubble(date) {
            return date.toISOString().split('.')[0] + '.000Z';  // Format: YYYY-MM-DDTHH:mm:ss.000Z
        }

        // Add one day to ensure we include today's transactions
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(23, 59, 59, 999);  // End of day in local time
        const endDate = formatDateForBubble(tomorrow);
        
        // Go back 90 days from tomorrow to ensure full coverage
        const ninetyDaysAgo = new Date(tomorrow);
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        ninetyDaysAgo.setHours(0, 0, 0, 0);  // Start of day in local time
        const startDate = formatDateForBubble(ninetyDaysAgo);
        
        // Log the date calculations
        console.log("📅 Date calculations:", {
            now: {
                iso: now.toISOString(),
                local: now.toLocaleString(),
                date: now.toLocaleDateString(),
                timestamp: now.getTime()
            },
            queryRange: {
                start: startDate,
                end: endDate,
                explanation: "Using Bubble's ISO format with supported operators"
            }
        });
        
        // Use supported constraint types with ISO dates
        const constraints = JSON.stringify([
            {"key": "Created By", "constraint_type": "equals", "value": userId},
            {"key": "Date", "constraint_type": "greater than", "value": startDate},
            {"key": "Date", "constraint_type": "less than", "value": endDate}
        ]);
        
        // Increase limit to ensure we get all transactions
        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(constraints)}&sort_field=Date&sort_direction=descending&limit=200`;

        console.log("🌍 Attempting to fetch from URL:", bubbleURL);
        console.log("📅 Date range:", { 
            startDate,
            endDate,
            currentServerTime: new Date().toISOString()
        });

        try {
            // Initialize arrays to store all transactions
            let allTransactions = [];
            let cursor = 0;
            let hasMore = true;
            let pageCount = 0;
            const MAX_PAGES = 3; // Limit to 3 pages to prevent timeout

            // Fetch transactions with pagination
            while (hasMore && pageCount < MAX_PAGES) {
                const pageURL = `${bubbleURL}&cursor=${cursor}`;
                console.log(`🔄 Fetching page ${pageCount + 1} with cursor: ${cursor}`);

                const transactionResponse = await axios.get(pageURL, {
                    headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` },
                    timeout: 10000 // 10 second timeout for each request
                });

                const pageTransactions = transactionResponse.data?.response?.results || [];
                allTransactions = [...allTransactions, ...pageTransactions];
                
                // Check if there are more pages
                const remaining = transactionResponse.data?.response?.remaining || 0;
                cursor = transactionResponse.data?.response?.cursor || 0;
                hasMore = remaining > 0;
                pageCount++;

                console.log(`📊 Page ${pageCount} stats:`, {
                    newTransactions: pageTransactions.length,
                    totalSoFar: allTransactions.length,
                    remaining,
                    cursor,
                    hasMore
                });

                // Break early if we have enough recent transactions
                if (allTransactions.length >= 200) {
                    console.log("📈 Reached sufficient transactions (200+), stopping pagination");
                    break;
                }
            }

            console.log(`✅ Retrieved ${allTransactions.length} total transactions across ${pageCount} pages`);
            
            // Sort all transactions by date (newest first)
            const sortedTransactions = allTransactions.sort((a, b) => {
                return new Date(b.Date) - new Date(a.Date);
            });

            // Take the 50 most recent transactions for GPT-4
            const recentTransactions = sortedTransactions.slice(0, 50);

            // Quick month analysis of recent transactions
            const monthCounts = recentTransactions.reduce((acc, t) => {
                const date = new Date(t.Date);
                const monthYear = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                acc[monthYear] = (acc[monthYear] || 0) + 1;
                return acc;
            }, {});

            console.log("\n📅 Recent Transactions by Month:", monthCounts);

            // Format transactions with minimal fields for GPT-4
            const formattedTransactions = recentTransactions.map(t => ({
                date: t.Date ? new Date(t.Date).toLocaleString() : '',
                amount: parseFloat(t.Amount).toFixed(2),
                bank: t.Bank || '',
                description: t.Description || 'No description',
                category: t['Category (Old)'] || t.Category || 'Uncategorized',
                is_pending: t['is_pending?'] || 'false'
            }));

            // Add debug information to the response
            const debugInfo = {
                totalTransactions: allTransactions.length,
                recentTransactionsUsed: recentTransactions.length,
                paginationInfo: {
                    pagesRetrieved: pageCount,
                    hasMorePages: hasMore
                },
                dateRange: recentTransactions.length > 0 ? {
                    earliest: recentTransactions[recentTransactions.length - 1].Date,
                    latest: recentTransactions[0].Date,
                    currentServerTime: new Date().toISOString(),
                    requestedDateRange: {
                        startDate,
                        endDate
                    }
                } : null,
                monthDistribution: monthCounts,
                query: {
                    url: bubbleURL,
                    constraints: JSON.parse(constraints),
                    userId
                }
            };

            // 🔥 Step 2: Send to OpenAI for analysis with enhanced prompt
            const openAIResponse = await client.chat.completions.create({
                model: "gpt-4",
                messages: [
                    {
                        role: "system",
                        content: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. When analyzing transactions:\n" +
                                "1. Focus on the most recent and relevant transactions\n" +
                                "2. Include bank names and transaction types\n" +
                                "3. Use categories for context\n" +
                                "4. Format amounts with currency codes\n" +
                                "5. Look for patterns and trends across transactions\n" +
                                "6. Consider the full date range when answering questions"
                    },
                    {
                        role: "user",
                        content: `Please analyze these transactions and answer the following question: ${input}\n\nTransactions: ${JSON.stringify(formattedTransactions, null, 2)}`
                    }
                ],
                temperature: 0.7
            });

            // 🔥 Step 3: Return formatted response with debug info
            return res.json({
                success: true,
                answer: openAIResponse.choices[0].message.content,
                transactions: formattedTransactions,
                debug: debugInfo
            });

        } catch (error) {
            console.error("❌ Error fetching transactions:", error.response?.data || error.message);
            console.error("Full error:", error);
            console.error("Error response:", error.response?.data);
            console.error("Error status:", error.response?.status);
            console.error("Error headers:", error.response?.headers);
            console.error("Request URL:", error.config?.url);
            console.error("Request method:", error.config?.method);
            console.error("Request headers:", error.config?.headers);
            
            res.status(500).json({ 
                error: 'Internal server error', 
                details: error.message,
                url: error.config?.url || 'URL not available',
                response: error.response?.data,
                status: error.response?.status,
                requestDetails: {
                    method: error.config?.method,
                    headers: error.config?.headers ? Object.keys(error.config.headers) : null
                }
            });
        }
    } catch (error) {
        console.error("❌ Error in /assistant endpoint:", error.response?.data || error.message);
        console.error("Full error:", error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
            url: error.config?.url || 'URL not available',
            stack: error.stack
        });
    }
});

// Add test endpoint for transaction date verification
app.get('/api/test-transactions', async (req, res) => {
    try {
        const userId = req.query.userId;
        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // Create a date range for the last 90 days
        const endDate = new Date().toISOString().split('T')[0];
        const startDate = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

        // Log the date calculations
        console.log("📅 Test endpoint date calculations:", {
            today: {
                iso: endDate,
                full: new Date().toISOString(),
                local: new Date().toLocaleString()
            },
            ninetyDaysAgo: {
                iso: startDate,
                full: new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toISOString(),
                local: new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toLocaleString()
            }
        });

        // Try without the is_pending constraint
        const constraints = [
            {"key": "Created By", "constraint_type": "equals", "value": userId},
            {"key": "Date", "constraint_type": "greater than", "value": startDate},
            {"key": "Date", "constraint_type": "less than", "value": endDate}
        ];

        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending`;
        
        console.log('🔍 Test endpoint URL:', bubbleURL);
        console.log('📅 Test endpoint constraints:', JSON.stringify(constraints, null, 2));
        
        const response = await axios.get(bubbleURL, {
            headers: {
                'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}`
            }
        });

        const transactions = response.data?.response?.results || [];
        
        // Log all transaction dates with details
        console.log("\n📊 All transaction dates with details:");
        transactions.forEach((t, index) => {
            const transactionDate = new Date(t.Date);
            console.log(`${index + 1}. Date: ${t.Date} (${transactionDate.toLocaleString()}), Amount: ${t.Amount}, Bank: ${t.Bank}, Description: ${t.Description}, Month: ${t.Month}, Year: ${t.Year}, is_pending: ${t['is_pending?']}`);
        });

        // Log transactions by month and year
        const transactionsByMonthYear = transactions.reduce((acc, t) => {
            const monthYear = `${t.Month} ${t.Year}`;
            if (!acc[monthYear]) {
                acc[monthYear] = [];
            }
            acc[monthYear].push(t);
            return acc;
        }, {});

        console.log("\n📅 Transactions by month and year:");
        Object.entries(transactionsByMonthYear).forEach(([monthYear, txs]) => {
            console.log(`${monthYear}: ${txs.length} transactions`);
            txs.slice(0, 3).forEach(t => {
                console.log(`  - ${t.Date}: ${t.Amount} - ${t.Description}`);
            });
        });
        
        const debugInfo = {
            requestInfo: {
                userId,
                startDate,
                endDate,
                currentTime: new Date().toISOString(),
                constraints: JSON.parse(decodeURIComponent(bubbleURL.split('constraints=')[1].split('&')[0]))
            },
            responseInfo: {
                totalTransactions: transactions.length,
                dateRange: transactions.length > 0 ? {
                    earliest: transactions[transactions.length - 1].Date,
                    latest: transactions[0].Date
                } : null,
                firstTransaction: transactions.length > 0 ? {
                    date: transactions[0].Date,
                    createdDate: transactions[0].Created_Date,
                    modifiedDate: transactions[0].Modified_Date,
                    createdBy: transactions[0]['Created By']
                } : null,
                transactionsByMonthYear,
                rawResponse: response.data
            }
        };

        res.json(debugInfo);
    } catch (error) {
        console.error('❌ Error in test-transactions endpoint:', error);
        res.status(500).json({
            error: 'Failed to fetch transactions',
            details: error.message,
            response: error.response?.data
        });
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
