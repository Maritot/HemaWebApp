import { getTransactions, getDebts, getGifts } from './db';

const GEMINI_KEY_STORAGE = 'hema_gemini_api_key';

export const getGeminiApiKey = (): string => {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
};

export const setGeminiApiKey = (key: string): void => {
  if (key) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
  }
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export const queryGemini = async (prompt: string, history: ChatMessage[]): Promise<string> => {
  const apiKey = getGeminiApiKey();

  // Fetch current household financial context to pass to Gemini
  let contextSnippet = '';
  try {
    const [txs, debts, gifts] = await Promise.all([
      getTransactions(),
      getDebts(),
      getGifts()
    ]);

    const totalIncome = txs.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
    const totalExpense = txs.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
    const pendingDebts = debts.filter(d => d.status !== 'SETTLED');
    const weOwe = pendingDebts.filter(d => d.type === 'WE_OWE').reduce((s, d) => s + (d.amount || d.principalAmount || 0), 0);
    const owedToUs = pendingDebts.filter(d => d.type === 'OWED_TO_US').reduce((s, d) => s + (d.amount || d.principalAmount || 0), 0);

    contextSnippet = `\n[Current User Household Context: Total Income Recorded: ₹${totalIncome}, Total Expenses: ₹${totalExpense}, Current Net: ₹${totalIncome - totalExpense}, Outstanding Borrowed (We Owe): ₹${weOwe}, Outstanding Lent (Owed to Us): ₹${owedToUs}, Total Gifts Logged: ${gifts.length}]`;
  } catch (e) {
    // Context fallback
  }

  const systemPrompt = `You are Hema, a wise, caring, and practical financial assistant designed for Indian households and parents.
Your goals:
1. Provide warm, accessible, culturally accurate household financial guidance (Gold vs FDs, Indian bank savings, traditional monthly Vaddi interest, Shagun gift etiquette, monthly grocery/kirana budgeting, SEBI-compliant general guidance).
2. Use respectful, warm phrasing ("Namaste", "Sure", etc.).
3. When discussing investments, always include a brief disclaimer: "(Disclaimer: Provided for educational purposes only; not SEBI investment advice)."
4. Keep answers concise, readable, and well-structured with bullet points where appropriate.${contextSnippet}`;

  // If no Gemini API Key is configured, use local intelligent financial engine
  if (!apiKey) {
    return generateLocalFinancialAdvice(prompt);
  }

  try {
    // Call Google Gemini API
    const contents = [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\nUser Question: ${prompt}` }]
      }
    ];

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 600
          }
        })
      }
    );

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `API error (${response.status})`;
      return `Gemini API returned an error: ${errMsg}. Showing local response instead:\n\n${generateLocalFinancialAdvice(prompt)}`;
    }

    const data = await response.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (candidate) {
      return candidate.trim();
    }
    return generateLocalFinancialAdvice(prompt);
  } catch (err: any) {
    return `Network notice: Could not reach Gemini online (${err.message}). Here is local guidance:\n\n${generateLocalFinancialAdvice(prompt)}`;
  }
};

function generateLocalFinancialAdvice(query: string): string {
  const q = query.toLowerCase();

  if (q.includes('gold') || q.includes('sohna') || q.includes('ornament') || q.includes('carat')) {
    return `🪙 **Gold Guidance for Indian Households:**
• Historically, physical 22K/24K gold serves as an inflation hedge and emergency collateral in India.
• When buying gold ornaments, keep making charges (wastage) in mind (usually 8% - 18%).
• For pure investment without making charges, Sovereign Gold Bonds (SGB) or Gold ETFs offer higher net returns.
*(SEBI Compliance: Educational overview only, not registered advisory).*`;
  }

  if (q.includes('vaddi') || q.includes('interest') || q.includes('debt') || q.includes('loan')) {
    return `📊 **Indian Vaddi & Loan Management:**
• Traditional "₹2 Vaddi" translates to 2% per month (or 24% per annum).
• Always pay off high-interest informal borrowings before putting surplus money into bank savings (which yield only 3%–6% per annum).
• Keep clear records of every installment with date, mode (UPI/Cash), and receiver acknowledgement.`;
  }

  if (q.includes('spend') || q.includes('expense') || q.includes('budget') || q.includes('saving')) {
    return `💡 **Household 50-30-20 Rule for Families:**
• **50% Essentials:** Kirana/Groceries, Electricity/Water, School fees, Milk, Medicine.
• **30% Discretionary:** Family dinners, clothes, shopping.
• **20% Emergency & Savings:** Kept in Fixed Deposits or Liquid Mutual Funds.
• Track everyday cash expenses immediately in the Expenses tab to avoid month-end cash leaks.`;
  }

  if (q.includes('gift') || q.includes('shagun') || q.includes('wedding')) {
    return `🎁 **Shagun & Gift Etiquette:**
• In Indian culture, Shagun amounts traditionally end with +₹1 (e.g., ₹501, ₹1,116, ₹2,101) as a blessing for continuous prosperity.
• Check the Gift Ledger under the person's name before attending a function to reciprocate honorably based on past exchanges.`;
  }

  return `Namaste! I am your Hema Financial Assistant. You can ask me about:
• Comparing Fixed Deposits vs Gold
• Calculating informal ₹ Vaddi interest
• Setting a monthly Kirana/Grocery budget
• Tax savings under Indian New vs Old Tax regime
*(Tip: Add your Google Gemini API Key in the settings top banner for full live AI reasoning!)*`;
}
