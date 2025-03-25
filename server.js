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

// Response formatting utilities
const FALLBACK_MESSAGE = "I couldn't find an up-to-date answer for that, but you might try checking a financial news site or your brokerage app for the latest details.";

const formatResponse = (toolSource, success, content, fallback = false) => {
    const baseResponse = {
        source: toolSource,
        success,
        content,
        fallback,
        timestamp: new Date().toISOString()
    };

    // Add metadata based on response type
    if (toolSource === "web") {
        baseResponse.metadata = {
            type: "web_search",
            citations: content.annotations || [],
            query: content.query || null
        };
    } else if (toolSource === "function") {
        baseResponse.metadata = {
            type: "function_call",
            function_name: content.function_name || null,
            parameters: content.parameters || null
        };
    }

    return baseResponse;
};

const isVagueResponse = (response) => {
    const vaguePatterns = [
        /I (couldn't|could not) find (this|that) in (the files|my training data|my knowledge)/i,
        /I don't have access to (the|this|that|current|real-time) information/i,
        /Based on my training data/i,
        /I (can't|cannot) provide real-time/i,
        /I (don't|do not) have (current|up-to-date|real-time)/i
    ];
    return vaguePatterns.some(pattern => pattern.test(response));
};

const processOpenAIResponse = (response, toolSource = "function") => {
    const content = response.choices[0].message.content;
    
    // Handle different response types
    if (toolSource === "web") {
        return formatResponse(toolSource, true, {
            text: content,
            annotations: response.choices[0].message.annotations || []
        });
    }

    if (isVagueResponse(content)) {
        return formatResponse(toolSource, false, FALLBACK_MESSAGE, true);
    }

    return formatResponse(toolSource, true, content);
};

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
            return res.json(formatResponse("function", false, "User ID is required"));
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

        try {
            const response = await axios.get(bubbleURL, {
                headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
            });

            const transactions = response.data?.response?.results || [];
            
            // Transform transactions to include essential fields plus additional useful information
            const transformedTransactions = transactions.map(tx => {
                const transactionDate = new Date(tx.Date);
                const isPending = tx['is_pending?'] === 'true';
                const isFutureDate = transactionDate > new Date();
                
                // Determine category based on description and other fields
                let category = "Uncategorized";
                if (tx.Description?.toLowerCase().includes("amazon")) {
                    category = "Shops";
                } else if (tx.Description?.toLowerCase().includes("insurance") || 
                          tx.Description?.toLowerCase().includes("geico") ||
                          tx.Description?.toLowerCase().includes("hanover")) {
                    category = "Service, Insurance";
                } else if (tx.Description?.toLowerCase().includes("payment") ||
                          tx.Description?.toLowerCase().includes("transfer")) {
                    category = "Transfer, Debit";
                } else if (tx.Description?.toLowerCase().includes("service") ||
                          tx.Description?.toLowerCase().includes("subscription")) {
                    category = "Service";
                } else if (tx.Description?.toLowerCase().includes("credit")) {
                    category = "Credit";
                }
                
                return {
                    date: transactionDate.toLocaleString(),
                    amount: tx.Amount,
                    description: tx.Description,
                    bank: tx.Bank || "",
                    account: tx.Account,
                    category: category,
                    isPending: isPending || isFutureDate ? 'true' : 'false',
                    month: transactionDate.toLocaleString('en-US', { month: 'short' }),
                    year: transactionDate.getFullYear(),
                    transaction_status: isPending ? 'pending' : 
                                      isFutureDate ? 'future' : 
                                      'completed'
                };
            });

            // Add essential debug information
            const debugInfo = {
                totalTransactions: transactions.length,
                dateRange: transactions.length > 0 ? {
                    earliest: transactions[transactions.length - 1].Date,
                    latest: transactions[0].Date,
                    currentServerTime: new Date().toISOString()
                } : null,
                pagination: {
                    cursor: response.data?.response?.cursor,
                    remaining: response.data?.response?.remaining
                }
            };

            // Format the response using our utility
            const formattedResponse = formatResponse("function", true, "Successfully retrieved transactions");
            formattedResponse.transactions = transformedTransactions;
            formattedResponse.debug = debugInfo;
            formattedResponse.pagination = debugInfo.pagination;

            // Add metadata for consistency with web search responses
            formattedResponse.metadata = {
                source: "bubble",
                timestamp: new Date().toISOString(),
                query: {
                    userId,
                    startDate,
                    endDate
                }
            };

            return res.json(formattedResponse);

        } catch (error) {
            console.error("❌ Error fetching transactions:", error.response?.data || error.message);
            return res.json(formatResponse("function", false, "Error fetching transactions. Please try again later."));
        }
    } catch (error) {
        console.error("❌ Error in /transactions endpoint:", error);
        return res.json(formatResponse("function", false, "An error occurred while processing your request. Please try again later."));
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
            return res.json(formatResponse("function", false, "User ID and question are required."));
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
            return res.json(formatResponse("function", false, "No data found to answer your question."));
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

        // Process the response using our utility
        const formattedResponse = processOpenAIResponse(openAIResponse);
        
        // Add debug info
        formattedResponse.debug = {
            data_used: data.length,
            question: question
        };

        return res.json(formattedResponse);

    } catch (error) {
        console.error("❌ Error processing question:", error);
        return res.json(formatResponse("function", false, "An error occurred while processing your request. Please try again later."));
    }
});

// 🔹 OpenAI Assistant Endpoint
app.post('/assistant', async (req, res) => {
    try {
        const { input } = req.body;
        const userId = req.query.userId?.trim();

        if (!userId || !input) {
            return res.json({
                output: [{
                    type: "text",
                    raw_body_text: "User ID and input are required."
                }]
            });
        }

        // Step 1: Initial call to OpenAI using Responses API
        const initialResponse = await client.responses.create({
            model: "gpt-4o-mini-2024-07-18",
            input: [
                {
                    role: "system",
                    content: `You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. The user's ID is ${userId}. When analyzing transactions, automatically use this ID to fetch their data. Be supportive and non-judgmental while providing insights about spending patterns and financial habits.`
                },
                {
                    role: "user",
                    content: input
                }
            ],
            tools: [
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
                        required: ["userId"],
                        additionalProperties: false
                    },
                    strict: true
                }
            ],
            parallel_tool_calls: false,
            text: {
                format: {
                    type: "text"
                }
            }
        });

        // Step 2: Check if we got a function call
        const functionCall = initialResponse.output?.[0];
        
        // If we got a text response asking for user ID, automatically make the function call
        if (functionCall?.type === "text" && functionCall.text?.toLowerCase().includes("user id")) {
            // Create a synthetic function call
            functionCall = {
                type: "function_call",
                name: "get_user_transactions",
                arguments: JSON.stringify({ userId })
            };
        }

        if (functionCall?.type === "function_call") {
            try {
                // Build constraints array - start with just the user ID
                const constraints = [
                    {"key": "Created By", "constraint_type": "equals", "value": userId}
                ];

                // Add date constraint to get recent transactions
                const today = new Date().toISOString().split('T')[0];
                const ninetyDaysAgo = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];
                constraints.push({"key": "Date", "constraint_type": "greater than", "value": ninetyDaysAgo});
                constraints.push({"key": "Date", "constraint_type": "less than", "value": today});

                const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;

                const response = await axios.get(bubbleURL, {
                    headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
                });

                const transactions = response.data?.response?.results || [];
                
                // Transform transactions to include essential fields plus additional useful information
                const transformedTransactions = transactions.map(tx => {
                    const transactionDate = new Date(tx.Date);
                    const isPending = tx['is_pending?'] === 'true';
                    const isFutureDate = transactionDate > new Date();
                    
                    // Determine category based on description and other fields
                    let category = "Uncategorized";
                    if (tx.Description?.toLowerCase().includes("amazon")) {
                        category = "Shops";
                    } else if (tx.Description?.toLowerCase().includes("insurance") || 
                              tx.Description?.toLowerCase().includes("geico") ||
                              tx.Description?.toLowerCase().includes("hanover")) {
                        category = "Service, Insurance";
                    } else if (tx.Description?.toLowerCase().includes("payment") ||
                              tx.Description?.toLowerCase().includes("transfer")) {
                        category = "Transfer, Debit";
                    } else if (tx.Description?.toLowerCase().includes("service") ||
                              tx.Description?.toLowerCase().includes("subscription")) {
                        category = "Service";
                    }
                    
                    return {
                        date: transactionDate.toLocaleString(),
                        amount: tx.Amount,
                        description: tx.Description,
                        bank: tx.Bank || "",
                        account: tx.Account,
                        category: category,
                        isPending: isPending || isFutureDate ? 'true' : 'false',
                        month: transactionDate.toLocaleString('en-US', { month: 'short' }),
                        year: transactionDate.getFullYear(),
                        transaction_status: isPending ? 'pending' : 
                                          isFutureDate ? 'future' : 
                                          'completed'
                    };
                });

                // Step 4: Send the result back to OpenAI
                const finalResponse = await client.responses.create({
                    model: "gpt-4o-mini-2024-07-18",
                    input: [
                        {
                            role: "system",
                            content: `You are the Bountisphere Money Coach—a friendly, supportive, and expert financial assistant. The user's ID is ${userId}. Be supportive and non-judgmental while providing insights about spending patterns and financial habits.`
                        },
                        {
                            role: "user",
                            content: input
                        },
                        {
                            type: "function_call",
                            name: "get_user_transactions",
                            arguments: JSON.stringify({ userId }),
                            status: "completed"
                        },
                        {
                            type: "function_call_output",
                            output: JSON.stringify(transformedTransactions)
                        }
                    ],
                    tools: [
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
                                required: ["userId"],
                                additionalProperties: false
                            },
                            strict: true
                        }
                    ],
                    parallel_tool_calls: false,
                    text: {
                        format: {
                            type: "text"
                        }
                    }
                });

                // Step 5: Return the final analysis
                return res.json({
                    output: [{
                        type: "text",
                        raw_body_text: finalResponse.output[0].content || "I apologize, but I couldn't generate a proper analysis of your transactions. Please try again."
                    }]
                });

            } catch (error) {
                console.error("❌ Error:", error.response?.data || error.message);
                return res.json({
                    output: [{
                        type: "text",
                        raw_body_text: `Error fetching transaction data: ${error.message}`
                    }]
                });
            }
        }

        // If no function call, return the regular response
        return res.json({
            output: [{
                type: "text",
                raw_body_text: initialResponse.output[0].content
            }]
        });

    } catch (error) {
        console.error("❌ Error in /assistant endpoint:", error.response?.data || error.message);
        return res.json({
            output: [{
                type: "text",
                raw_body_text: `An error occurred: ${error.message}`
            }]
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

// 🔹 OpenAI Tools Endpoint
app.post('/openai-tools', async (req, res) => {
    try {
        const { model, tools, input, instructions } = req.body;
        const userId = req.query.userId?.trim();

        console.log("📥 Received tools request:", { model, tools, input });

        // Initialize response data
        let toolsData = {};
        let toolSource = "function";

        // Process each tool request
        for (const tool of tools) {
            if (tool.type === 'web_search_preview') {
                toolSource = "web";
                toolsData.web_search = {
                    status: "supported",
                    query: input
                };
            }

            if (tool.type === 'function' && tool.name === 'get_user_transactions') {
                try {
                    // Reuse existing transaction fetching logic
                    const constraints = [
                        {"key": "Created By", "constraint_type": "equals", "value": userId},
                        {"key": "is_pending?", "constraint_type": "equals", "value": "false"}
                    ];

                    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}&sort_field=Date&sort_direction=descending&limit=100`;
                    
                    const response = await axios.get(bubbleURL, {
                        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
                    });

                    toolsData.transactions = response.data?.response?.results || [];
                } catch (error) {
                    console.error("❌ Transaction fetch error:", error.message);
                    return res.json(formatResponse(toolSource, false, "Unable to fetch transaction data. Please try again later."));
                }
            }
        }

        // Create OpenAI messages array
        const messages = [
            {
                role: "system",
                content: instructions || "You are the Bountisphere Money Coach. Analyze the available data and provide helpful insights."
            },
            {
                role: "user",
                content: input
            }
        ];

        // Get response from OpenAI
        const openAIResponse = await client.chat.completions.create({
            model: model || "gpt-4",
            messages: messages,
            temperature: 0.7
        });

        // Process the response using our utility
        const formattedResponse = processOpenAIResponse(openAIResponse, toolSource);
        
        // Add debug information
        formattedResponse.debug = {
            model_used: model,
            tools_requested: tools,
            original_input: input,
            web_search_requested: tools.some(t => t.type === 'web_search_preview'),
            transactions_fetched: !!toolsData.transactions,
            tools_data: toolsData
        };

        res.json(formattedResponse);

    } catch (error) {
        console.error("❌ Error in /openai-tools endpoint:", error);
        res.json(formatResponse("function", false, "An error occurred while processing your request. Please try again later."));
    }
});

// 🔹 Start the Server
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});
