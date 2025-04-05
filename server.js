// ✅ Bountisphere AI Server — Added /voice endpoint for end-to-end voice flow
import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import FormData from 'form-data';
import axios from 'axios';

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

app.post('/ask', async (req, res) => {
  const { userMessage, userId, userLocalDate } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;
  const today = userLocalDate || new Date().toDateString();

  try {
    const input = [{ role: 'user', content: userMessage }];
    const instructions = `You are the Bountisphere Money Coach — a smart, supportive, and expert financial assistant and behavioral coach.\nYour mission is to help people understand their money with insight, compassion, and clarity. You read their real transactions and account balances, identify patterns, and help them build better habits using principles from psychology, behavioral science, and financial planning.\nAlways be on the user's side — non-judgmental, clear, warm, and helpful.\n• For spending and transactions, call \`get_user_transactions\`\n• For credit card, loan, or investment questions, call \`get_full_account_data\`\n• Do not refer to the files in the vector store. And never mention files like in \"the files you uploaded\" as user's cannot upload files. \nToday is ${today}. Current user ID: ${targetUserId}`;

    const initialResponse = await openai.responses.create({
      model: MODEL,
      input,
      instructions,
      tools,
      tool_choice: 'auto'
    });

    const toolCall = initialResponse.output?.find(i => i.type === 'function_call');
    if (!toolCall) {
      const fallback = initialResponse.output?.find(i => i.type === 'message')?.content?.[0]?.text;
      return res.json({ message: fallback || 'Sorry, I couldn’t generate a response.' });
    }

    const args = JSON.parse(toolCall.arguments);
    let toolOutput;

    if (toolCall.name === 'get_user_transactions') {
      toolOutput = await fetchTransactionsFromBubble(args.start_date, args.end_date, args.userId);
    } else if (toolCall.name === 'get_full_account_data') {
      toolOutput = await fetchCreditLoanInvestmentData(args.userId);
    } else {
      throw new Error('Unrecognized tool call');
    }

    const followUp = await openai.responses.create({
      model: MODEL,
      input: [
        ...input,
        toolCall,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: JSON.stringify(toolOutput)
        }
      ],
      instructions,
      tools
    });

    const reply = followUp.output?.find(item => item.type === 'message');
    const text = reply?.content?.find(c => c.type === 'output_text')?.text ||
                 reply?.content?.find(c => c.type === 'text')?.text;

    return res.json({ message: text || `No results found.` });
  } catch (err) {
    console.error('❌ Error in /ask handler:', err);
    return res.status(500).json({ error: err.message || 'Unexpected server error' });
  }
});

app.post('/voice', async (req, res) => {
  try {
    const { audioUrl } = req.body;
    if (!audioUrl) return res.status(400).json({ error: 'Missing audioUrl' });

    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });
    const tempFilePath = path.join('/tmp', `${uuidv4()}.mp3`);
    fs.writeFileSync(tempFilePath, audioRes.data);

    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath));
    formData.append('model', 'whisper-1');

    const whisperRes = await axios.post('https://api.openai.com/v1/audio/transcriptions', formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    });

    const userInput = whisperRes.data.text;

    const gptRes = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a helpful and compassionate money coach.' },
        { role: 'user', content: userInput },
      ],
    }, {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });

    const gptOutput = gptRes.data.choices[0].message.content;

    const speechRes = await axios.post('https://api.openai.com/v1/audio/speech', {
      model: 'tts-1',
      voice: 'nova',
      input: gptOutput,
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
    });

    const base64Audio = Buffer.from(speechRes.data).toString('base64');
    fs.unlinkSync(tempFilePath);

    res.json({ transcription: userInput, reply: gptOutput, audioBase64 });
  } catch (err) {
    console.error('❌ Voice processing error:', err.message || err);
    res.status(500).json({ error: 'Something went wrong processing the voice input.' });
  }
});

async function fetchTransactionsFromBubble(startDate, endDate, userId) {
  const all = [];
  let cursor = 0;
  let hasMore = true;

  while (hasMore) {
    const constraints = [
      { key: 'Account Holder', constraint_type: 'equals', value: userId },
      { key: 'Date', constraint_type: 'greater than', value: startDate },
      { key: 'Date', constraint_type: 'less than', value: endDate }
    ];
    const url = `${BUBBLE_URL}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&cursor=${cursor}`;
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` } });
    const data = await resp.json();
    if (!data?.response?.results) throw new Error('No transaction data returned');

    all.push(...data.response.results.map(tx => ({
      date: tx.Date,
      amount: tx.Amount,
      merchant: tx['Merchant Name'] || tx.Description || 'Unknown',
      category: tx['Category Description'] || tx['Category (Old)'] || 'Uncategorized',
      category_details: tx['Category Details'] || null,
      account: tx['Account'] || 'Unspecified',
      bank: tx['Bank'] || null
    })));

    if (!data.response.remaining) hasMore = false;
    else cursor += data.response.count || 100;
  }

  return { totalCount: all.length, transactions: all };
}

async function fetchCreditLoanInvestmentData(userId) {
  const creditCardConstraints = [
    { key: 'Created By', constraint_type: 'equals', value: userId }
  ];
  const defaultConstraints = [
    { key: 'Account Holder', constraint_type: 'equals', value: userId }
  ];

  async function fetchData(url, constraints) {
    const resp = await fetch(`${url}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`, {
      headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` }
    });
    const data = await resp.json();
    return data.response?.results || [];
  }

  const [creditCards, loans, investments, accounts] = await Promise.all([
    fetchData(CREDIT_CARD_URL, creditCardConstraints),
    fetchData(LOAN_URL, defaultConstraints),
    fetchData(INVESTMENT_URL, defaultConstraints),
    fetchData(ACCOUNT_URL, defaultConstraints)
  ]);

  const accountMap = {};
  for (const a of accounts) {
    accountMap[a._id] = a['Account Name'] || 'Unnamed Card';
  }

  const cards = creditCards.map(card => ({
    id: card._id,
    name: accountMap[card.Account] || 'Unnamed Card',
    availableCredit: card['Available Credit'],
    currentBalance: card['Current Balance']
  }));

  return { creditCards: cards, loans, investments };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
