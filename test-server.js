import express from 'express';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
app.use(express.json());

// Basic test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running!' });
});

// Test endpoint for environment variables
app.get('/config', (req, res) => {
  res.json({
    bubbleUrl: process.env.BUBBLE_API_URL ? 'Set' : 'Missing',
    bubbleKey: process.env.BUBBLE_API_KEY ? 'Set' : 'Missing',
    openaiKey: process.env.OPENAI_API_KEY ? 'Set' : 'Missing'
  });
});

// Simple echo endpoint
app.post('/echo', (req, res) => {
  res.json({
    received: req.body,
    timestamp: new Date().toISOString()
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
}); 