// ✅ Bountisphere AI Server — Updated with full /voice support and error handling
import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = 'gpt-4o-mini';
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = process.env.BUBBLE_API_URL;
const ACCOUNT_URL = 'https://app.bountisphere.com/api/1.1/obj/account';
const CREDIT_CARD_URL = 'https://app.bountisphere.com/api/1.1/obj/credit_card';
const LOAN_URL = 'https://app.bountisphere.com/api/1.1/obj/loan';
const INVESTMENT_URL = 'https://app.bountisphere.com/api/1.1/obj/investment';
const DEFAULT_USER_ID = '1735159562002x959413891769328900';
const FILE_VECTOR_STORE_ID = 'vs_JScHftFeKAv35y4QHPz9QwMb';

const tools = [
  {
    type: 'function',
    name: 'get_user_transactions',
    description: "Return the user's recent financial transactions, including date, amount, category, merchant, account, and bank.",
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        start_date: { type: 'string' },
        end_date: { type: 'string' }
      },
      required: ['userId', 'start_date', 'end_date']
    }
  },
  {
    type: 'function',
    name: 'get_full_account_data',
    description: 'Return user’s credit card, loan, and investment balances (with card names)',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' }
      },
      required: ['userId']
    }
  },
  { type: 'file_search', vector_store_ids: [FILE_VECTOR_STORE_ID] },
  { type: 'web_search' }
];

app.post('/voice', async (req, res) => {
  const { audioUrl, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  console.log('📩 Incoming /voice request body:', req.body);

  if (!audioUrl || typeof audioUrl !== 'string') {
    console.error('❌ No valid audio URL provided.');
    return res.status(400).json({ error: 'Invalid or missing audioUrl.' });
  }

  const tempPath = `/tmp/${uuidv4()}.mp3`;

  try {
    console.log('🔗 Downloading audio from URL:', audioUrl);
    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });

    // Content-type validation
    const contentType = audioRes.headers['content-type'];
    if (!contentType || !contentType.includes('audio')) {
      throw new Error(`Invalid content-type received: ${contentType}`);
    }

    fs.writeFileSync(tempPath, Buffer.from(audioRes.data), 'binary');

    console.log('🧠 Transcribing...');
    const transcriptionResp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: 'whisper-1'
    });

    const transcription = transcriptionResp.text;
    console.log('✅ Transcription:', transcription);

    const instructions = `You are the Bountisphere Money Coach — a smart, supportive, and expert financial assistant and behavioral coach.
Your mission is to help people understand their money with insight, compassion, and clarity. 
Today is ${new Date().toDateString()}. Current user ID: ${targetUserId}`;

    const chat = await openai.responses.create({
      model: MODEL,
      input: [{ role: 'user', content: transcription }],
      instructions,
      tools,
      tool_choice: 'auto'
    });

    const reply = chat.output?.find(m => m.type === 'message')?.content?.[0]?.text || 'Sorry, I had trouble generating a response.';
    console.log('💬 AI reply:', reply);

    const speech = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: reply
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());
    const audioBase64 = audioBuffer.toString('base64');

    // Clean up temp file
    fs.unlinkSync(tempPath);

    return res.json({
      transcription,
      reply,
      audioBase64
    });

  } catch (err) {
    console.error('❌ Voice processing error:', err.message);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return res.status(500).json({ error: err.message || 'Something went wrong processing the voice input.' });
  }
});

// All other endpoints remain unchanged
// — /ask, fetchTransactionsFromBubble, fetchCreditLoanInvestmentData, etc...

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ Server booting...');
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
