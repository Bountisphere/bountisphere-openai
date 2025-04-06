// ✅ Bountisphere AI Server — Improved /voice error handling + validation
import express from 'express';
import bodyParser from 'body-parser';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

dotenv.config();

const app = express();
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = 'gpt-4o-mini';
const DEFAULT_USER_ID = '1735159562002x959413891769328900';

app.post('/voice', async (req, res) => {
  const { audioUrl, userId } = req.body;
  const targetUserId = userId || DEFAULT_USER_ID;

  console.log('📩 Incoming /voice request body:', req.body);

  if (!audioUrl || typeof audioUrl !== 'string' || !audioUrl.startsWith('http')) {
    console.error('❌ Invalid or missing audioUrl:', audioUrl);
    return res.status(400).json({ error: 'Invalid or missing audioUrl.' });
  }

  const tempPath = `/tmp/${uuidv4()}.mp3`;

  try {
    console.log('🔗 Downloading audio from URL:', audioUrl);
    const audioRes = await axios.get(audioUrl, { responseType: 'arraybuffer' });

    const contentType = audioRes.headers['content-type'] || '';
    console.log('📦 Received Content-Type:', contentType);
    if (!contentType.includes('audio')) {
      throw new Error(`Invalid content-type received: ${contentType}`);
    }

    fs.writeFileSync(tempPath, Buffer.from(audioRes.data), 'binary');
    console.log('📁 File saved at:', tempPath);

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
    console.log('🔊 TTS complete — audioBase64 generated');

    fs.unlinkSync(tempPath);

    return res.json({ transcription, reply, audioBase64 });

  } catch (err) {
    console.error('❌ Voice processing error:', err.message);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    return res.status(500).json({ error: err.message || 'Something went wrong processing the voice input.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('✅ Server booting...');
  console.log(`🚀 Bountisphere AI server running on port ${PORT}`);
});
