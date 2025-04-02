// 🌐 Bountisphere AI Money Coach Server
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import fetch from "node-fetch";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BUBBLE_URL = "https://app.bountisphere.com/api/1.1/obj/transactions";
const CREDIT_CARD_URL = "https://app.bountisphere.com/api/1.1/obj/credit_card";
const LOANS_URL = "https://app.bountisphere.com/api/1.1/obj/loans";
const INVESTMENTS_URL = "https://app.bountisphere.com/api/1.1/obj/investments";

// 🔄 Generic Bubble fetcher
async function fetchBubbleData(url, constraints) {
  const fullUrl = `${url}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`;
  const response = await fetch(fullUrl, {
    headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` },
  });
  return response.json();
}

// 📊 Transactions
async function fetchTransactions(userId, startDate, endDate) {
  const constraints = [
    { key: "Account Holder", constraint_type: "equals", value: userId },
    { key: "Date", constraint_type: "greater than", value: startDate },
    { key: "Date", constraint_type: "less than", value: endDate },
  ];
  const data = await fetchBubbleData(BUBBLE_URL, constraints);
  return data.response.results.map((tx) => ({
    date: tx.Date,
    amount: tx.Amount,
    merchant: tx["Merchant Name"] || tx.Description || "Unknown",
    category: tx["Category Description"] || tx["Category (Old)"] || "Uncategorized",
    category_details: tx["Category Details"] || null,
    account: tx["Account"] || "Unspecified",
    bank: tx["Bank"] || "Unknown",
  }));
}

// 💳 Credit Cards
async function fetchCreditCards(userId) {
  const constraints = [
    { key: "Created By", constraint_type: "equals", value: userId },
  ];
  const data = await fetchBubbleData(CREDIT_CARD_URL, constraints);
  return data.response.results.map((card) => ({
    account: card.Account,
    current_balance: card["Current Balance"],
    available_credit: card["Available Credit"],
    interest_rate: card["Interest Rate"],
    payment_due_date: card["Payment Due Date"],
    min_payment_due: card["Min Payment Due"],
  }));
}

// 🏦 Loans
async function fetchLoans(userId) {
  const constraints = [
    { key: "Created By", constraint_type: "equals", value: userId },
  ];
  const data = await fetchBubbleData(LOANS_URL, constraints);
  return data.response.results.map((loan) => ({
    account: loan.Account,
    current_loan_balance: loan["Current Loan Balance"],
    loan_type: loan["Loan Type"],
    interest_rate: loan["Interest Rate"],
    origination_date: loan["Loan Origination Date"],
    payoff_date: loan["Payoff Date"],
    ytd_interest_paid: loan["YTD interest paid"],
    ytd_principal_paid: loan["YTD principle paid"],
  }));
}

// 📈 Investments
async function fetchInvestments(userId) {
  const constraints = [
    { key: "Created By", constraint_type: "equals", value: userId },
  ];
  const data = await fetchBubbleData(INVESTMENTS_URL, constraints);
  return data.response.results.map((inv) => ({
    account: inv.Account,
    current_balance: inv["Current Balance"],
    quantity: inv["Quanity of Shares or Units"],
    cost_basis: inv["Cost Basis"],
    ticker_symbol: inv["Ticker Symbol"],
  }));
}

// 🧠 Ask AI Coach Endpoint
app.post("/ask_ai_coach", async (req, res) => {
  const { userId, input } = req.body;
  if (!userId || !input) return res.status(400).json({ error: "Missing userId or input" });

  // ⏱ Default range: last 6 months
  const now = new Date();
  const endDate = now.toISOString();
  const startDate = new Date(now.setMonth(now.getMonth() - 6)).toISOString();

  try {
    const [transactions, creditCards, loans, investments] = await Promise.all([
      fetchTransactions(userId, startDate, endDate),
      fetchCreditCards(userId),
      fetchLoans(userId),
      fetchInvestments(userId),
    ]);

    // ❌ Graceful fallback if no data
    const hasData =
      transactions.length > 0 || creditCards.length > 0 || loans.length > 0 || investments.length > 0;

    if (!hasData) {
      return res.json({
        answer:
          "Hi there! It looks like you haven’t connected any bank accounts yet. To get the most out of the Bountisphere Money Coach — including personalized insights and spending advice — connect your accounts in the 'Manage' tab. I'm here whenever you're ready!",
      });
    }

    // 🧠 Send to OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            "You are the Bountisphere Money Coach. Be compassionate and non-judgmental. Offer personalized financial guidance, budgeting tips, and behavior-based money insights. You have access to the user's spending, credit cards, loans, and investments. Respond in plain language. Suggest realistic improvements.",
        },
        {
          role: "user",
          content: `Here’s some financial data for a user.\n\nTransactions: ${JSON.stringify(
            transactions
          )}\n\nCredit Cards: ${JSON.stringify(creditCards)}\n\nLoans: ${JSON.stringify(
            loans
          )}\n\nInvestments: ${JSON.stringify(investments)}\n\nUser Question: ${input}`,
        },
      ],
    });

    const output = completion.choices[0].message.content;
    res.json({ answer: output });
  } catch (err) {
    console.error("❌ AI Coach error:", err);
    res.status(500).json({ error: "Money Coach failed to process your request." });
  }
});

// 🚀 Launch Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere Money Coach running on port ${PORT}`);
});
