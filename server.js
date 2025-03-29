import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Define the function (tool) schema
const tools = [
  {
    type: "function",
    name: "get_user_transactions",
    description: "Fetch a user's transactions from the Bountisphere Bubble API",
    parameters: {
      type: "object",
      properties: {
        userId: {
          type: "string",
          description: "The user ID whose transactions we need to fetch"
        },
        startDate: {
          type: "string",
          description: "Optional start date in YYYY-MM-DD format"
        },
        endDate: {
          type: "string",
          description: "Optional end date in YYYY-MM-DD format"
        }
      },
      required: ["userId"]
    }
  }
];

// Rate limiting middleware
const rateLimit = {
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  current: 0,
  resetTime: Date.now() + 60 * 1000
};

function rateLimiter(req, res, next) {
  const now = Date.now();
  if (now > rateLimit.resetTime) {
    rateLimit.current = 0;
    rateLimit.resetTime = now + rateLimit.windowMs;
  }

  if (rateLimit.current >= rateLimit.maxRequests) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Please try again in a minute.',
      details: 'Too many requests in this time window.'
    });
  }

  rateLimit.current++;
  next();
}

// Apply rate limiting to all routes
app.use(rateLimiter);

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Bountisphere AI server is running!',
    environment: {
      bubbleApiConfigured: !!process.env.BUBBLE_API_URL && !!process.env.BUBBLE_API_KEY,
      openaiApiConfigured: !!process.env.OPENAI_API_KEY
    }
  });
});

// Helper function to compute default date range (last 12 months)
function getDefaultDateRange() {
  const today = new Date();
  const effectiveEndDate = today.toISOString().split('T')[0];
  const lastYear = new Date(today);
  lastYear.setFullYear(today.getFullYear() - 1);
  const effectiveStartDate = lastYear.toISOString().split('T')[0];
  return { effectiveStartDate, effectiveEndDate };
}

// Assistant endpoint
app.post('/assistant', async (req, res) => {
  try {
    const { input, userId } = req.body;
    if (!input || !userId) {
      return res.status(400).json({ error: 'Missing "input" or "userId".' });
    }

    // Create initial response
    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content: "You are the Bountisphere Money Coach. Help users understand their transactions and financial patterns."
        },
        {
          role: "user",
          content: input
        }
      ],
      functions: tools,
      function_call: "auto"
    });

    const responseMessage = response.choices[0].message;

    // Check if the model wants to call a function
    if (responseMessage.function_call) {
      // Get the function arguments
      const functionArgs = JSON.parse(responseMessage.function_call.arguments);
      
      // Add userId if not provided in the function call
      functionArgs.userId = functionArgs.userId || userId;

      // Prepare Bubble API request
      const constraints = [
        { "key": "Created By", "constraint_type": "equals", "value": functionArgs.userId }
      ];

      if (functionArgs.startDate) {
        constraints.push({ 
          "key": "Date", 
          "constraint_type": "greater than", 
          "value": functionArgs.startDate 
        });
      }

      if (functionArgs.endDate) {
        constraints.push({ 
          "key": "Date", 
          "constraint_type": "less than", 
          "value": functionArgs.endDate 
        });
      }

      // Call Bubble API
      const bubbleURL = `${process.env.BUBBLE_API_URL}/transactions?constraints=${encodeURIComponent(JSON.stringify(constraints))}`;
      const bubbleResponse = await axios.get(bubbleURL, {
        headers: { 'Authorization': `Bearer ${process.env.BUBBLE_API_KEY}` }
      });

      const transactions = bubbleResponse.data?.response?.results || [];

      // Get final response with transaction data
      const finalResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content: "You are the Bountisphere Money Coach. Help users understand their transactions and financial patterns."
          },
          {
            role: "user",
            content: input
          },
          {
            role: "assistant",
            content: responseMessage.content,
            function_call: responseMessage.function_call
          },
          {
            role: "function",
            name: "get_user_transactions",
            content: JSON.stringify(transactions)
          }
        ]
      });

      return res.json({
        success: true,
        answer: finalResponse.choices[0].message.content
      });
    }

    // If no function call was needed, return the direct response
    return res.json({
      success: true,
      answer: responseMessage.content
    });

  } catch (err) {
    console.error("❌ /assistant error:", err?.response?.data || err.message);
    return res.status(500).json({
      error: "Assistant failed",
      details: err?.response?.data || err.message
    });
  }
});

// Start server with proper error handling
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', (error) => {
  if (error) {
    console.error('❌ Error starting server:', error);
    process.exit(1);
  }
  console.log(`🚀 Bountisphere AI server running at http://localhost:${PORT}`);
  
  // Log environment configuration
  console.log('Environment Configuration:');
  console.log('- BUBBLE_API_URL:', process.env.BUBBLE_API_URL);
  console.log('- OpenAI API Key:', process.env.OPENAI_API_KEY ? '✓ Set' : '✗ Missing');
  console.log('- Bubble API Key:', process.env.BUBBLE_API_KEY ? '✓ Set' : '✗ Missing');
});

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Please try a different port or kill the process using this port.`);
  } else {
    console.error('❌ Server error:', error);
  }
  process.exit(1);
});

// Handle process termination
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('👋 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});
