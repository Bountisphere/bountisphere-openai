// server.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import dotenv from "dotenv";
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const BUBBLE_API_KEY = process.env.BUBBLE_API_KEY;
const BASE_URL = "https://app.bountisphere.com/api/1.1/obj";

// 🔐 Helper to fetch data from Bubble
async function fetchFromBubble(endpoint, constraints) {
  const url = `${BASE_URL}/${endpoint}?constraints=${encodeURIComponent(JSON.stringify(constraints))}&limit=1000`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${BUBBLE_API_KEY}` },
  });
  const data = await response.json();
  return data?.response?.results || [];
}

// 🚀 Transactions endpoint
app.post("/get_user_transactions", async (req, res) => {
  const { userId, start_date, end_date } = req.body;
  try {
    const constraints = [
      { key: "Account Holder", constraint_type: "equals", value: userId },
      { key: "Date", constraint_type: "greater than", value: start_date },
      { key: "Date", constraint_type: "less than", value: end_date },
    ];
    const transactions = await fetchFromBubble("transactions", constraints);
    const formatted = transactions.map((tx) => ({
      date: tx.Date,
      amount: tx.Amount,
      merchant: tx["Merchant Name"] || tx.Description || "Unknown",
      category: tx["Category Description"] || tx["Category (Old)"] || "Uncategorized",
      category_details: tx["Category Details"] || null,
      account: tx["Account"] || "Unspecified",
      bank: tx["Bank"] || null,
    }));
    res.json({ totalCount: formatted.length, transactions: formatted });
  } catch (e) {
    console.error("/get_user_transactions error:", e);
    res.status(500).json({ error: "Unable to fetch transactions" });
  }
});

// 💳 Credit Card endpoint
app.post("/get_user_credit_cards", async (req, res) => {
  const { userId } = req.body;
  try {
    const constraints = [
      { key: "Created By", constraint_type: "equals", value: userId },
    ];
    const cards = await fetchFromBubble("credit_card", constraints);
    const formatted = cards.map((cc) => ({
      account: cc.Account,
      available_credit: cc["Available Credit"],
      current_balance: cc["Current Balance"],
      min_payment_due: cc["Min Payment Due"],
      interest_rate: cc["Interest Rate"],
      payment_due_date: cc["Payment Due Date"],
    }));
    res.json({ totalCount: formatted.length, credit_cards: formatted });
  } catch (e) {
    console.error("/get_user_credit_cards error:", e);
    res.status(500).json({ error: "Unable to fetch credit cards" });
  }
});

// 🏦 Loan endpoint
app.post("/get_user_loans", async (req, res) => {
  const { userId } = req.body;
  try {
    const constraints = [
      { key: "Created By", constraint_type: "equals", value: userId },
    ];
    const loans = await fetchFromBubble("loans", constraints);
    const formatted = loans.map((loan) => ({
      account: loan.Account,
      current_balance: loan["Current Loan Balance"],
      escrow_balance: loan["Escrow Balance"],
      interest_rate: loan["Interest Rate"],
      original_loan_amount: loan["Original Loan Amount"],
      ytd_interest_paid: loan["YTD interest paid"],
      ytd_principal_paid: loan["YTD principle paid"],
      due_date: loan["Due Date"],
      payoff_date: loan["Payoff Date"],
      loan_type: loan["Loan Type"],
      loan_origination_date: loan["Loan Origination Date"],
    }));
    res.json({ totalCount: formatted.length, loans: formatted });
  } catch (e) {
    console.error("/get_user_loans error:", e);
    res.status(500).json({ error: "Unable to fetch loans" });
  }
});

// 📈 Investments endpoint
app.post("/get_user_investments", async (req, res) => {
  const { userId } = req.body;
  try {
    const constraints = [
      { key: "Created By", constraint_type: "equals", value: userId },
    ];
    const investments = await fetchFromBubble("investments", constraints);
    const formatted = investments.map((inv) => ({
      account: inv.Account,
      current_balance: inv["Current Balance"],
      cost_basis: inv["Cost Basis"],
      quantity: inv["Quanity of Shares or Units"],
      ticker: inv["Ticker Symbol"],
    }));
    res.json({ totalCount: formatted.length, investments: formatted });
  } catch (e) {
    console.error("/get_user_investments error:", e);
    res.status(500).json({ error: "Unable to fetch investments" });
  }
});

// 🏁 Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bountisphere server running on port ${PORT}`);
});
