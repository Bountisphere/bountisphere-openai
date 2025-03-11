// 🔹 Assistant API - Handles User Queries and Fetches Past Transactions
app.post('/assistant', async (req, res) => {
    try {
        const { user_unique_id, message } = req.body;  
        if (!user_unique_id || !message) {
            return res.status(400).json({ error: 'Missing user ID or message' });
        }

        console.log("🛠 Received request at /assistant for user:", user_unique_id);
        console.log("💬 User message:", message);

        // Fetch past transactions
        const transactionsResponse = await axios.post('https://bountisphere-openai-617952217530.us-central1.run.app/transactions', {
            userId: user_unique_id
        });

        let transactions = transactionsResponse.data || [];
        console.log("🔍 Retrieved Transactions:", transactions);

        if (transactions.length === 0) {
            return res.json({ message: "No past transactions found for this user." });
        }

        // 🔹 Ensure transactions are always included in OpenAI's request
        let filteredTransactions = transactions.filter(tx => 
            tx.description.toLowerCase().includes(message.toLowerCase()) || 
            tx.merchant.toLowerCase().includes(message.toLowerCase()) || 
            tx.category.toLowerCase().includes(message.toLowerCase())
        );

        let transactionsText = transactions.map(tx => 
            `- $${Math.abs(tx.amount)} at ${tx.merchant} on ${tx.date} (Category: ${tx.category})`
        ).join("\n");

        let filteredText = filteredTransactions.map(tx => 
            `- $${Math.abs(tx.amount)} at ${tx.merchant} on ${tx.date} (Category: ${tx.category})`
        ).join("\n");

        let prompt;
        if (filteredTransactions.length > 0) {
            prompt = `Today's date is ${new Date().toISOString().split("T")[0]}. 
            The user asked: "${message}". Here are the relevant transactions:\n\n
            ${filteredText}

            Provide a detailed analysis based on these transactions.`;
        } else {
            prompt = `Today's date is ${new Date().toISOString().split("T")[0]}. 
            The user asked: "${message}". No exact matches were found, but here are **all** past transactions:\n\n
            ${transactionsText}

            Analyze these transactions and provide financial insights.`;
        }

        // 🔥 Call OpenAI API
        const openAIResponse = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: process.env.OPENAI_MODEL || 'gpt-4o',
            messages: [
                { role: 'system', content: "You are a financial assistant providing transaction insights." },
                { role: 'user', content: prompt }
            ]
        }, {
            headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' }
        });

        console.log("🤖 OpenAI Response:", JSON.stringify(openAIResponse.data, null, 2));

        res.json(openAIResponse.data);

    } catch (error) {
        console.error("❌ Error processing /assistant:", error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
