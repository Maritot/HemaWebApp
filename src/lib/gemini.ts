import { getTransactions, getDebts, getGifts } from './db';

const GEMINI_KEY_STORAGE = 'hema_gemini_api_key';
const ACTIVE_MODEL_STORAGE = 'hema_active_gemini_model';

// Candidate models in preference order (modern 2.5 / 2.0 down to legacy)
const CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-8b',
  'gemini-1.5-pro',
  'gemini-pro',
  'gemini-1.5-flash'
];

export const getGeminiApiKey = (): string => {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
};

export const setGeminiApiKey = (key: string): void => {
  if (key) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    // Clear previously cached model so it re-discovers for the new key
    localStorage.removeItem(ACTIVE_MODEL_STORAGE);
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(ACTIVE_MODEL_STORAGE);
  }
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Dynamically queries Google Generative Language API to find the best active model
 * supported by the user's specific API key.
 */
export const discoverBestModel = async (apiKey: string): Promise<string> => {
  const cached = localStorage.getItem(ACTIVE_MODEL_STORAGE);
  if (cached) return cached;

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    if (res.ok) {
      const data = await res.json();
      const availableModels: string[] = (data.models || [])
        .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m: any) => m.name.replace(/^models\//, ''));

      // Check preferred models in priority order
      for (const candidate of CANDIDATE_MODELS) {
        if (availableModels.includes(candidate)) {
          localStorage.setItem(ACTIVE_MODEL_STORAGE, candidate);
          return candidate;
        }
      }

      // Check any model containing 'flash'
      const anyFlash = availableModels.find(m => m.toLowerCase().includes('flash'));
      if (anyFlash) {
        localStorage.setItem(ACTIVE_MODEL_STORAGE, anyFlash);
        return anyFlash;
      }

      // Pick the first available model that supports generateContent
      if (availableModels.length > 0) {
        const first = availableModels[0];
        localStorage.setItem(ACTIVE_MODEL_STORAGE, first);
        return first;
      }
    }
  } catch (err) {
    console.warn('Could not list models from Gemini API, falling back to candidates:', err);
  }

  // Default to gemini-2.5-flash
  return 'gemini-2.5-flash';
};

export const queryGemini = async (prompt: string, history: ChatMessage[] = []): Promise<string> => {
  const apiKey = getGeminiApiKey();

  // If no Gemini API Key is configured, use local intelligent financial engine
  if (!apiKey) {
    return generateLocalFinancialAdvice(prompt);
  }

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

  // Format past history turns
  const contents: any[] = [];
  if (history && history.length > 0) {
    const recent = history.slice(-6);
    for (const h of recent) {
      contents.push({
        role: h.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: h.text }]
      });
    }
  }

  // Add the current prompt with system context
  contents.push({
    role: 'user',
    parts: [{ text: `${systemPrompt}\n\nUser Question: ${prompt}` }]
  });

  // Discover best model or build candidate list
  const discoveredModel = await discoverBestModel(apiKey);
  const modelsToTry = Array.from(new Set([discoveredModel, ...CANDIDATE_MODELS]));

  for (const model of modelsToTry) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 800
            }
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (candidateText) {
          // Successfully got response! Save this working model
          localStorage.setItem(ACTIVE_MODEL_STORAGE, model);
          return candidateText.trim();
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const status = response.status;
        const errMsg = errData.error?.message || `HTTP ${status}`;

        // If it's a 404 (model not found / deprecated) or 400 (unsupported), clear cache and try next candidate
        if (status === 404 || status === 400) {
          localStorage.removeItem(ACTIVE_MODEL_STORAGE);
          continue;
        }

        // If it's 401/403 (Invalid API key), don't keep trying models
        if (status === 401 || status === 403) {
          return `Google Gemini API Key error: ${errMsg}. Please verify your API key in the top banner.`;
        }
      }
    } catch (netErr: any) {
      // Continue to next candidate or fallback
    }
  }

  // If all online model attempts failed, fall back to local intelligent guidance
  return generateLocalFinancialAdvice(prompt);
};

export function generateLocalFinancialAdvice(query: string): string {
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
