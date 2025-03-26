// Import necessary modules
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';


// Load environment variables
dotenv.config();


const app = express();
const PORT = process.env.PORT || 3000;


// Initialize OpenAI API with new configuration
const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    defaultQuery: { 'api-version': '2024-02-15' },
    defaultHeaders: { 'api-type': 'openai' }
});


// Vector Store ID for Bountisphere documentation
const BOUNTISPHERE_VECTOR_STORE_ID = 'vs_JScHftFeKAv35y4QHPz9QwMb';


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


// 🔹 OpenAI Assistant Endpoint with new Responses API
app.post('/assistant', async (req, res) => {
    try {
        const { input, startDate, endDate } = req.body;
        const userId = req.query.userId?.trim();

        console.log("📥 Received request with userId:", userId);
        console.log("📅 Date range requested:", { startDate, endDate });

        if (!userId || !input) {
            return res.status(400).json({ error: 'User ID and input are required' });
        }

        // Initialize arrays and tracking variables
        let allTransactions = [];
        let cursor = null;
        let hasMore = true;
        let pageCount = 0;
        const MAX_PAGES = 10;
        const TRANSACTIONS_PER_PAGE = 100;

        // Try to find March transactions specifically
        const marchConstraints = [
            {"key": "Created By", "constraint_type": "equals", "value": userId},
            {"key": "Month", "constraint_type": "equals", "value": "Mar"},
            {"key": "Year", "constraint_type": "equals", "value": "2025"}
        ];

        try {
            console.log("🔍 Searching specifically for March 2025 transactions...");
           
            // First attempt: Search by Month and Year
            while (hasMore && pageCount < MAX_PAGES) {
                const cursorParam = cursor ? `&cursor=${cursor}` : '';
                const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(marchConstraints))}&sort_field=Date&sort_direction=descending&limit=${TRANSACTIONS_PER_PAGE}${cursorParam}`;

                console.log(`🔄 Fetching March transactions page ${pageCount + 1} with cursor:`, cursor || 'initial');

                const response = await axios.get(bubbleURL, {
                    headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` },
                    timeout: 15000
                });

                const pageTransactions = response.data?.response?.results || [];
               
                // Log each transaction's date and Month field
                pageTransactions.forEach(t => {
                    console.log(`📅 Transaction:`, {
                        date: t.Date,
                        month: t.Month,
                        year: t.Year,
                        amount: t.Amount,
                        description: t.Description
                    });
                });

                allTransactions = [...allTransactions, ...pageTransactions];
                cursor = response.data?.response?.cursor;
                hasMore = response.data?.response?.remaining > 0;
                pageCount++;

                console.log(`📈 March Search Progress:`, {
                    page: pageCount,
                    newTransactions: pageTransactions.length,
                    totalSoFar: allTransactions.length,
                    hasMore,
                    nextCursor: cursor
                });
            }

            // If no March transactions found, try with date range as backup
            if (allTransactions.length === 0) {
                console.log("⚠️ No March transactions found using Month field, trying date range...");
               
                const marchStart = new Date('2025-03-01T00:00:00.000Z');
                const marchEnd = new Date('2025-03-31T23:59:59.999Z');
               
                const dateConstraints = [
                    {"key": "Created By", "constraint_type": "equals", "value": userId},
                    {"key": "Date", "constraint_type": "greater than", "value": marchStart.toISOString()},
                    {"key": "Date", "constraint_type": "less than", "value": marchEnd.toISOString()}
                ];

                cursor = null;
                hasMore = true;
                pageCount = 0;

                while (hasMore && pageCount < MAX_PAGES) {
                    const cursorParam = cursor ? `&cursor=${cursor}` : '';
                    const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(dateConstraints))}&sort_field=Date&sort_direction=descending&limit=${TRANSACTIONS_PER_PAGE}${cursorParam}`;

                    console.log(`🔄 Fetching March (by date) page ${pageCount + 1}`);

                    const response = await axios.get(bubbleURL, {
                        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` },
                        timeout: 15000
                    });

                    const pageTransactions = response.data?.response?.results || [];
                    allTransactions = [...allTransactions, ...pageTransactions];
                    cursor = response.data?.response?.cursor;
                    hasMore = response.data?.response?.remaining > 0;
                    pageCount++;

                    console.log(`📈 March Date Range Progress:`, {
                        page: pageCount,
                        newTransactions: pageTransactions.length,
                        totalSoFar: allTransactions.length,
                        hasMore
                    });
                }
            }

            // Sort all transactions by date (newest first)
            const sortedTransactions = allTransactions.sort((a, b) => {
                return new Date(b.Date) - new Date(a.Date);
            });

            // Take the 50 most recent transactions for GPT-4
            const recentTransactions = sortedTransactions.slice(0, 50);

            // Format transactions for GPT-4
            const formattedTransactions = recentTransactions.map(t => ({
                date: new Date(t.Date).toLocaleString(),
                amount: parseFloat(t.Amount).toFixed(2),
                bank: t.Bank || '',
                description: t.Description || 'No description',
                category: t['Category (Old)'] || t.Category || 'Uncategorized',
                is_pending: t['is_pending?'] || 'false',
                month: t.Month,
                year: t.Year
            }));

            // Analyze monthly distribution
            const monthlyStats = sortedTransactions.reduce((acc, t) => {
                const date = new Date(t.Date);
                const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                if (!acc[monthKey]) {
                    acc[monthKey] = {
                        count: 0,
                        total: 0,
                        transactions: []
                    };
                }
                acc[monthKey].count++;
                acc[monthKey].total += parseFloat(t.Amount) || 0;
                if (acc[monthKey].transactions.length < 3) {
                    acc[monthKey].transactions.push({
                        date: t.Date,
                        amount: t.Amount,
                        description: t.Description,
                        month: t.Month,
                        year: t.Year
                    });
                }
                return acc;
            }, {});

            // Send to OpenAI using new Responses API with file search
            const openAIResponse = await client.responses.create({
                model: "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: "You are the Bountisphere Money Coach. You can analyze transactions, provide insights about spending patterns, and help users get the most out of Bountisphere. You have access to both transaction data and Bountisphere documentation to provide comprehensive assistance."
                    },
                    {
                        role: "user",
                        content: `Please analyze these transactions and answer: ${input}\n\nTransactions: ${JSON.stringify(formattedTransactions, null, 2)}`
                    }
                ],
                tools: [
                    {
                        type: "function",
                        function: {
                            name: "search_web",
                            description: "Search the web for current financial information",
                            parameters: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "The search query"
                                    }
                                },
                                required: ["query"]
                            }
                        }
                    },
                    {
                        type: "function",
                        function: {
                            name: "search_bountisphere_docs",
                            description: "Search Bountisphere documentation for help and guidance",
                            parameters: {
                                type: "object",
                                properties: {
                                    query: {
                                        type: "string",
                                        description: "The search query for Bountisphere documentation"
                                    }
                                },
                                required: ["query"]
                            }
                        }
                    }
                ],
                file_search: {
                    vector_store_id: BOUNTISPHERE_VECTOR_STORE_ID,
                    max_results: 5
                },
                temperature: 0.7
            });

            // Process the response and handle any function calls
            let finalResponse = openAIResponse.choices[0].message.content;
            let functionCalls = [];
            let functionResults = [];

            // Check for function calls in the response
            if (openAIResponse.choices[0].message.tool_calls) {
                for (const toolCall of openAIResponse.choices[0].message.tool_calls) {
                    if (toolCall.function.name === 'search_web') {
                        const query = JSON.parse(toolCall.function.arguments).query;
                        console.log("🔍 Web search query:", query);
                        // Here you would implement the actual web search
                        functionCalls.push({
                            type: 'web_search',
                            query: query
                        });
                        // For now, we'll just add a placeholder result
                        functionResults.push({
                            type: 'web_search',
                            query: query,
                            result: "Web search results would be implemented here"
                        });
                    } else if (toolCall.function.name === 'search_bountisphere_docs') {
                        const query = JSON.parse(toolCall.function.arguments).query;
                        console.log("📚 Bountisphere docs search query:", query);
                        // Here you would implement the actual docs search
                        functionCalls.push({
                            type: 'docs_search',
                            query: query
                        });
                        // For now, we'll just add a placeholder result
                        functionResults.push({
                            type: 'docs_search',
                            query: query,
                            result: "Bountisphere documentation search results would be implemented here"
                        });
                    }
                }
            }

            // If we have function results, send them back to OpenAI for a final response
            if (functionResults.length > 0) {
                const finalResponse = await client.responses.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: "You are the Bountisphere Money Coach. You can analyze transactions, provide insights about spending patterns, and help users get the most out of Bountisphere. You have access to both transaction data and Bountisphere documentation to provide comprehensive assistance."
                        },
                        {
                            role: "user",
                            content: `Please analyze these transactions and answer: ${input}\n\nTransactions: ${JSON.stringify(formattedTransactions, null, 2)}\n\nSearch Results: ${JSON.stringify(functionResults, null, 2)}`
                        }
                    ],
                    temperature: 0.7
                });
                finalResponse = finalResponse.choices[0].message.content;
            }

            return res.json({
                success: true,
                answer: finalResponse,
                transactions: formattedTransactions,
                function_calls: functionCalls,
                function_results: functionResults,
                debug: {
                    totalTransactions: allTransactions.length,
                    recentTransactionsUsed: formattedTransactions.length,
                    paginationInfo: {
                        pagesRetrieved: pageCount,
                        hasMorePages: hasMore,
                        transactionsPerPage: TRANSACTIONS_PER_PAGE
                    },
                    dateRange: {
                        requestedRange: {
                            start: startDate,
                            end: endDate,
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
                        byMonthField: allTransactions.filter(t => 
                            t.Month === startDate.toLocaleString('en-US', { month: 'short' }) && 
                            t.Year === startDate.getFullYear().toString()
                        ).length,
                        byDateRange: allTransactions.filter(t => {
                            const date = new Date(t.Date);
                            return date.getMonth() === startDate.getMonth() && 
                                   date.getFullYear() === startDate.getFullYear();
                        }).length
                    },
                    query: {
                        marchConstraints,
                        dateConstraints,
                        userId
                    }
                }
            });

        } catch (error) {
            console.error("❌ Error fetching transactions:", error);
            throw error;
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
