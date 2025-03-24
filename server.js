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
        const userId = req.query.userId?.trim();

        console.log("📥 Received request with userId:", userId);
        console.log("📝 User input:", input);

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // First, get response from OpenAI
        const openAIResponse = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user's question involves transaction details, call the 'get_user_transactions' function with the userId provided in the prompt. For general financial advice, you can use web search to find current information and the vector store to access documentation."
                },
                {
                    role: "user",
                    content: input
                }
            ],
            tools: [
                {
                    type: "web_search_preview",
                    search_context_size: "medium",
                    user_location: {
                        type: "approximate",
                        country: "US"
                    }
                },
                {
                    type: "file_search",
                    filters: null,
                    max_num_results: 20,
                    ranking_options: {
                        ranker: "auto",
                        score_threshold: 0
                    },
                    vector_store_ids: ["vs_JScHftFeKAv35y4QHPz9QwMb"]
                },
                {
                    type: "function",
                    name: "get_user_transactions",
                    description: "Get the user's transactions when they ask about their spending, transactions, or financial activity",
                    parameters: {
                        type: "object",
                        properties: {
                            startDate: {
                                type: "string",
                                description: "Optional start date in YYYY-MM-DD format"
                            },
                            endDate: {
                                type: "string",
                                description: "Optional end date in YYYY-MM-DD format"
                            }
                        }
                    }
                }
            ],
            temperature: 0.7
        });

        // Check if OpenAI wants to call a function
        const functionCall = openAIResponse.choices[0].message.function_call;
        
        if (functionCall && functionCall.name === "get_user_transactions") {
            console.log("🔄 Function call detected, fetching transactions...");
            
            // Parse the function arguments
            const args = JSON.parse(functionCall.arguments);
            const { startDate, endDate } = args;

            // Initialize tracking variables for transaction fetch
            let allTransactions = new Map();
            let cursor = null;
            let hasMore = true;
            let pageCount = 0;
            const MAX_PAGES = 20;
            const TRANSACTIONS_PER_PAGE = 100;

            // Calculate effective date range
            const currentDate = new Date();
            const defaultStartDate = new Date(currentDate);
            defaultStartDate.setDate(currentDate.getDate() - 90);

            const effectiveStartDate = startDate ? new Date(startDate) : defaultStartDate;
            const effectiveEndDate = endDate ? new Date(endDate) : currentDate;

            // Initialize constraints
            const monthYearConstraints = [
                {"key": "Created By", "constraint_type": "equals", "value": userId},
                {"key": "Month", "constraint_type": "equals", "value": effectiveStartDate.toLocaleString('en-US', { month: 'short' })},
                {"key": "Year", "constraint_type": "equals", "value": effectiveStartDate.getFullYear().toString()}
            ];

            const dateConstraints = [
                {"key": "Created By", "constraint_type": "equals", "value": userId},
                {"key": "Date", "constraint_type": "greater than", "value": effectiveStartDate.toISOString()},
                {"key": "Date", "constraint_type": "less than", "value": effectiveEndDate.toISOString()}
            ];

            try {
                // First attempt: Try to find transactions using Month and Year fields
                console.log("🔍 First attempt: Searching by Month/Year fields...", {
                    constraints: monthYearConstraints
                });

                // First search with Month/Year
                while (hasMore && pageCount < MAX_PAGES) {
                    const cursorParam = cursor ? `&cursor=${cursor}` : '';
                    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(monthYearConstraints))}&sort_field=Date&sort_direction=descending&limit=${TRANSACTIONS_PER_PAGE}${cursorParam}`;

                    const response = await axios.get(bubbleURL, {
                        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` },
                        timeout: 15000
                    });

                    const pageTransactions = response.data?.response?.results || [];
                    
                    pageTransactions.forEach(t => {
                        const transactionKey = `${t.Date}_${t.Amount}_${t.Description}_${t.Bank || ''}`;
                        if (!allTransactions.has(transactionKey)) {
                            allTransactions.set(transactionKey, t);
                            console.log(`📅 New transaction (Month/Year search):`, {
                                date: t.Date,
                                month: t.Month,
                                year: t.Year,
                                amount: t.Amount,
                                description: t.Description
                            });
                        }
                    });

                    cursor = response.data?.response?.cursor;
                    hasMore = response.data?.response?.remaining > 0;
                    pageCount++;
                }

                // If no transactions found, try with date range
                if (allTransactions.size === 0) {
                    console.log("⚠️ No transactions found using Month/Year fields, trying date range...");

                    cursor = null;
                    hasMore = true;
                    pageCount = 0;

                    while (hasMore && pageCount < MAX_PAGES) {
                        const cursorParam = cursor ? `&cursor=${cursor}` : '';
                        const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(dateConstraints))}&sort_field=Date&sort_direction=descending&limit=${TRANSACTIONS_PER_PAGE}${cursorParam}`;

                        const response = await axios.get(bubbleURL, {
                            headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` },
                            timeout: 15000
                        });

                        const pageTransactions = response.data?.response?.results || [];
                        
                        pageTransactions.forEach(t => {
                            const transactionKey = `${t.Date}_${t.Amount}_${t.Description}_${t.Bank || ''}`;
                            if (!allTransactions.has(transactionKey)) {
                                allTransactions.set(transactionKey, t);
                                console.log(`📅 New transaction (Date range search):`, {
                                    date: t.Date,
                                    month: new Date(t.Date).toLocaleString('en-US', { month: 'short' }),
                                    year: new Date(t.Date).getFullYear(),
                                    amount: t.Amount,
                                    description: t.Description
                                });
                            }
                        });

                        cursor = response.data?.response?.cursor;
                        hasMore = response.data?.response?.remaining > 0;
                        pageCount++;
                    }
                }

                // Convert Map back to array and sort
                const sortedTransactions = Array.from(allTransactions.values()).sort((a, b) => {
                    return new Date(b.Date) - new Date(a.Date);
                });

                // Take the 50 most recent transactions for GPT-4
                const recentTransactions = sortedTransactions.slice(0, 50);

                // Format transactions for GPT-4
                const formattedTransactions = recentTransactions.map(t => {
                    const transactionDate = new Date(t.Date);
                    const isPending = t['is_pending?'] === 'true';
                    const isFutureDate = transactionDate > currentDate;
                    
                    return {
                        date: transactionDate.toLocaleString(),
                        amount: parseFloat(t.Amount).toFixed(2),
                        bank: t.Bank || '',
                        description: t.Description || 'No description',
                        category: t['Category (Old)'] || t.Category || 'Uncategorized',
                        is_pending: isPending || isFutureDate ? 'true' : 'false',
                        month: transactionDate.toLocaleString('en-US', { month: 'short' }),
                        year: transactionDate.getFullYear(),
                        transaction_status: isPending ? 'pending' : 
                                          isFutureDate ? 'future' : 
                                          'completed'
                    };
                });

                // Analyze monthly distribution with status tracking
                const monthlyStats = sortedTransactions.reduce((acc, t) => {
                    const date = new Date(t.Date);
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    const isPending = t['is_pending?'] === 'true';
                    const isFutureDate = date > currentDate;
                    const status = isPending ? 'pending' : isFutureDate ? 'future' : 'completed';
                    
                    if (!acc[monthKey]) {
                        acc[monthKey] = {
                            count: 0,
                            total: 0,
                            transactions: [],
                            status_breakdown: {
                                pending: 0,
                                future: 0,
                                completed: 0
                            }
                        };
                    }
                    acc[monthKey].count++;
                    acc[monthKey].total += parseFloat(t.Amount) || 0;
                    acc[monthKey].status_breakdown[status]++;
                    if (acc[monthKey].transactions.length < 3) {
                        acc[monthKey].transactions.push({
                            date: t.Date,
                            amount: t.Amount,
                            description: t.Description,
                            status: status
                        });
                    }
                    return acc;
                }, {});

                // After fetching transactions, send another request to OpenAI with the data
                const finalResponse = await client.chat.completions.create({
                    model: "gpt-4",
                    messages: [
                        {
                            role: "system",
                            content: "You are the Bountisphere Money Coach. Analyze the transactions and provide insights about spending patterns, focusing on the most recent transactions first."
                        },
                        {
                            role: "user",
                            content: input
                        },
                        {
                            role: "assistant",
                            content: "I've retrieved the transaction data. Let me analyze it for you."
                        },
                        {
                            role: "user",
                            content: `Here are the transactions: ${JSON.stringify(formattedTransactions, null, 2)}`
                        }
                    ],
                    temperature: 0.7
                });

                // Return in a format matching OpenAI Responses
        return res.json({
                    id: `resp_${Date.now().toString(16)}${Math.random().toString(16).substring(2)}`,
                    object: "response",
                    created_at: Math.floor(Date.now() / 1000),
                    model: "gpt-4o-mini-2024-07-18",
                    status: "completed",
                    error: null,
                    incomplete_details: null,
                    instructions: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user's question involves transaction details, call the 'get_user_transactions' function with the userId provided in the prompt. For general financial advice, you can use web search to find current information and the vector store to access documentation.",
                    output: [
                        {
                            type: "function_call",
                            id: `fc_${Date.now().toString(16)}${Math.random().toString(16).substring(2)}`,
                            call_id: `call_${Math.random().toString(36).substring(2)}`,
                            name: "get_user_transactions",
                            arguments: JSON.stringify({ startDate, endDate }),
                            status: "completed"
                        }
                    ],
                    parallel_tool_calls: true,
                    text: {
                        format: { type: "text" },
                        value: finalResponse.choices[0].message.content
                    },
            transactions: formattedTransactions,
                    tool_choice: "auto",
                    tools: [
                        {
                            type: "file_search",
                            filters: null,
                            max_num_results: 20,
                            ranking_options: {
                                ranker: "auto",
                                score_threshold: 0
                            },
                            vector_store_ids: ["vs_JScHftFeKAv35y4QHPz9QwMb"]
                        },
                        {
                            type: "web_search_preview",
                            search_context_size: "medium",
                            user_location: {
                                type: "approximate",
                                country: "US"
                            }
                        },
                        {
                            type: "function",
                            name: "get_user_transactions",
                            description: "Get the user's transactions when they ask about their spending, transactions, or financial activity",
                            parameters: {
                                type: "object",
                                properties: {
                                    startDate: {
                                        type: "string",
                                        description: "Optional start date in YYYY-MM-DD format"
                                    },
                                    endDate: {
                                        type: "string",
                                        description: "Optional end date in YYYY-MM-DD format"
                                    }
                                }
                            },
                            strict: true
                        }
                    ],
                    usage: {
                        input_tokens: 1000, // Approximate
                        input_tokens_details: {
                            cached_tokens: 0
                        },
                        output_tokens: finalResponse.usage?.completion_tokens || 0,
                        output_tokens_details: {
                            reasoning_tokens: 0
                        },
                        total_tokens: finalResponse.usage?.total_tokens || 0
                    },
                    debug: {
                        totalTransactions: allTransactions.size,
                        recentTransactionsUsed: formattedTransactions.length,
                        paginationInfo: {
                            pagesRetrieved: pageCount,
                            hasMorePages: hasMore,
                            transactionsPerPage: TRANSACTIONS_PER_PAGE
                        },
                        dateRange: {
                            requestedRange: {
                                start: effectiveStartDate.toISOString(),
                                end: effectiveEndDate.toISOString(),
                                isDefault: !startDate && !endDate
                            },
                            actual: {
                                earliest: sortedTransactions[sortedTransactions.length - 1]?.Date,
                                latest: sortedTransactions[0]?.Date,
                                currentServerTime: new Date().toISOString()
                            }
                        },
                        monthlyStats,
                        searchResults: {
                            byMonthField: Array.from(allTransactions.values()).filter(t => 
                                t.Month === effectiveStartDate.toLocaleString('en-US', { month: 'short' }) && 
                                t.Year === effectiveStartDate.getFullYear().toString()
                            ).length,
                            byDateRange: Array.from(allTransactions.values()).filter(t => {
                                const date = new Date(t.Date);
                                return date.getMonth() === effectiveStartDate.getMonth() && 
                                       date.getFullYear() === effectiveStartDate.getFullYear();
                            }).length
                        },
                        query: {
                            monthYearConstraints,
                            dateConstraints,
                            userId
                        }
                    }
                });

            } catch (error) {
                console.error("❌ Error fetching transactions:", error);
                throw error;
            }
        } else {
            // If no function call, return regular response in OpenAI Responses format
            console.log("📝 Regular response (no transactions needed)");
            return res.json({
                id: `resp_${Date.now().toString(16)}${Math.random().toString(16).substring(2)}`,
                object: "response",
                created_at: Math.floor(Date.now() / 1000),
                model: "gpt-4o-mini-2024-07-18",
                status: "completed",
                error: null,
                incomplete_details: null,
                instructions: "You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. If the user's question involves transaction details, call the 'get_user_transactions' function with the userId provided in the prompt. For general financial advice, you can use web search to find current information and the vector store to access documentation.",
                output: [],
                parallel_tool_calls: true,
                text: {
                    format: { type: "text" },
                    value: openAIResponse.choices[0].message.content
                },
                tool_choice: "auto",
                tools: [
                    {
                        type: "file_search",
                        filters: null,
                        max_num_results: 20,
                        ranking_options: {
                            ranker: "auto",
                            score_threshold: 0
                        },
                        vector_store_ids: ["vs_JScHftFeKAv35y4QHPz9QwMb"]
                    },
                    {
                        type: "web_search_preview",
                        search_context_size: "medium",
                        user_location: {
                            type: "approximate",
                            country: "US"
                        }
                    },
                    {
                        type: "function",
                        name: "get_user_transactions",
                        description: "Get the user's transactions when they ask about their spending, transactions, or financial activity",
                        parameters: {
                            type: "object",
                            properties: {
                                startDate: {
                                    type: "string",
                                    description: "Optional start date in YYYY-MM-DD format"
                                },
                                endDate: {
                                    type: "string",
                                    description: "Optional end date in YYYY-MM-DD format"
                                }
                            }
                        },
                        strict: true
                    }
                ],
                usage: {
                    input_tokens: openAIResponse.usage?.prompt_tokens || 0,
                    input_tokens_details: {
                        cached_tokens: 0
                    },
                    output_tokens: openAIResponse.usage?.completion_tokens || 0,
                    output_tokens_details: {
                        reasoning_tokens: 0
                    },
                    total_tokens: openAIResponse.usage?.total_tokens || 0
                }
            });
        }

    } catch (error) {
        console.error("❌ Error in /assistant endpoint:", error);
        res.status(500).json({ 
            error: 'Internal server error', 
            details: error.message,
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
