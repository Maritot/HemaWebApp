import { getTransactions, getDebts, getGifts } from './db';

const GEMINI_KEY_STORAGE = 'hema_gemini_api_key';
const ACTIVE_MODEL_STORAGE = 'hema_active_gemini_model';

export interface AvailableModel {
  name: string;        // e.g. "models/gemini-3.8-flash"
  displayName: string; // e.g. "Gemini 3.8 Flash (Recommended - Free Tier)"
  description?: string;
}

// Strictly curated models supported on Google AI Studio Free Tier
export const FREE_TIER_MODELS: AvailableModel[] = [
  {
    name: 'models/gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash (Recommended - Free Tier)'
  },
  {
    name: 'models/gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash (Fast - Free Tier)'
  },
  {
    name: 'models/gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite (Lightweight - Free Tier)'
  }
];

export const getGeminiApiKey = (): string => {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
};

export const setGeminiApiKey = (key: string): void => {
  if (key) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(ACTIVE_MODEL_STORAGE);
  }
};

export const clearGeminiCache = (): void => {
  localStorage.removeItem(ACTIVE_MODEL_STORAGE);
};

export const getActiveModelName = (): string => {
  const cached = localStorage.getItem(ACTIVE_MODEL_STORAGE);
  if (cached) {
    return cached.replace(/^models\//, '');
  }
  return 'gemini-3.8-flash';
};

export const setActiveModelName = (modelName: string): void => {
  if (modelName) {
    const formatted = modelName.startsWith('models/') ? modelName : `models/${modelName}`;
    localStorage.setItem(ACTIVE_MODEL_STORAGE, formatted);
  }
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Builds a strictly alternating Gemini payload:
 * 1. Guarantees first turn has role: 'user'
 * 2. Alternates strictly between 'user' and 'model'
 * 3. Never produces consecutive same-role turns
 * 4. Injects household system context cleanly into the conversation
 */
export function buildStrictGeminiPayload(
  systemPrompt: string, 
  prompt: string, 
  rawHistory: ChatMessage[] = []
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const firstUserIdx = rawHistory.findIndex(m => m.role === 'user');
  const pastTurns = firstUserIdx !== -1 ? rawHistory.slice(firstUserIdx) : [];

  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  let expectedRole: 'user' | 'model' = 'user';
  for (const turn of pastTurns) {
    const role: 'user' | 'model' = turn.role === 'assistant' ? 'model' : 'user';
    if (role === expectedRole) {
      contents.push({ role, parts: [{ text: turn.text }] });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }

  if (contents.length === 0 || contents[contents.length - 1].role === 'model') {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  } else {
    contents[contents.length - 1].parts[0].text = prompt;
  }

  // Prepend system prompt to the first user turn
  contents[0].parts[0].text = `${systemPrompt}\n\n[User Question]: ${contents[0].parts[0].text}`;

  return contents;
}

/**
 * Query Google Generative Language ModelService directly and return ONLY active free-tier Flash models.
 */
export const fetchAvailableModels = async (apiKey: string): Promise<AvailableModel[]> => {
  if (!apiKey.trim()) return FREE_TIER_MODELS;

  const cleanKey = apiKey.trim();

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
    if (res.ok) {
      const data = await res.json();
      const rawModels = data.models || [];

      // Filter down strictly to free-tier Flash models
      const matched = FREE_TIER_MODELS.filter(ft =>
        rawModels.some((m: any) => m.name === ft.name || m.name.endsWith(ft.name.replace(/^models\//, '')))
      );

      if (matched.length > 0) {
        return matched;
      }
    }
  } catch (e) {
    console.warn('Could not list models from Google:', e);
  }

  return FREE_TIER_MODELS;
};

/**
 * Test the API key against the selected Free Tier model.
 */
export const testGeminiConnection = async (
  apiKey: string,
  preferredModel?: string
): Promise<{ success: boolean; model?: string; message: string; availableModels: AvailableModel[] }> => {
  if (!apiKey.trim()) {
    return { success: false, message: 'Please enter your Google Gemini API key.', availableModels: FREE_TIER_MODELS };
  }

  const cleanKey = apiKey.trim();
  const availableModels = await fetchAvailableModels(cleanKey);

  // Target model (default to gemini-3.8-flash)
  const chosen = preferredModel || availableModels[0]?.name || 'models/gemini-3.8-flash';
  const cleanModelName = chosen.startsWith('models/') ? chosen : `models/${chosen}`;

  try {
    const testPayload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with: READY' }]
        }
      ]
    };

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/${cleanModelName}:generateContent?key=${cleanKey}`;
    const genRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    if (genRes.ok) {
      const data = await genRes.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        localStorage.setItem(ACTIVE_MODEL_STORAGE, cleanModelName);
        return {
          success: true,
          model: cleanModelName,
          message: `✅ Connected successfully: ${cleanModelName.replace(/^models\//, '')}!`,
          availableModels
        };
      }
    } else {
      const errJson = await genRes.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${genRes.status}`;
      return {
        success: false,
        message: `Error on ${cleanModelName.replace(/^models\//, '')}: ${errMsg}`,
        availableModels
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Network error: ${err.message}`,
      availableModels
    };
  }

  return { success: false, message: 'Could not connect.', availableModels };
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

    contextSnippet = `\n[Household Finances: Recorded Income: ₹${totalIncome}, Expenses: ₹${totalExpense}, Net: ₹${totalIncome - totalExpense}, We Owe: ₹${weOwe}, Owed to Us: ₹${owedToUs}, Gifts Logged: ${gifts.length}]`;
  } catch (e) {}

  const systemPrompt = `You are Hema, a wise, caring, and practical financial assistant designed for Indian households and parents.
Guidance:
1. Provide warm, accessible, culturally accurate household guidance (Gold, Indian bank savings, informal monthly Vaddi interest, Shagun gift etiquette, grocery budgets).
2. Use respectful, warm phrasing ("Namaste", "Sure", etc.).
3. When discussing investments, add brief disclaimer: "(Provided for educational purposes only; not SEBI investment advice)."
4. Keep answers concise, readable, and structured with bullet points.${contextSnippet}`;

  const contents = buildStrictGeminiPayload(systemPrompt, prompt, history);

  // Read saved model or default to gemini-3.8-flash
  let activeModel = localStorage.getItem(ACTIVE_MODEL_STORAGE);
  const modelToCall = activeModel || 'models/gemini-3.8-flash';

  try {
    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/${modelToCall}:generateContent?key=${apiKey}`;
    const response = await fetch(generateUrl, {
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
    });

    if (response.ok) {
      const data = await response.json();
      const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (candidateText) {
        return candidateText.trim();
      }
    } else {
      const errData = await response.json().catch(() => ({}));
      const errMsg = errData.error?.message || `HTTP ${response.status}`;
      return `⚠️ Gemini notice: ${errMsg}. Local advice:\n\n${generateLocalFinancialAdvice(prompt)}`;
    }
  } catch (netErr: any) {
    return `⚠️ Network notice: ${netErr.message}. Local advice:\n\n${generateLocalFinancialAdvice(prompt)}`;
  }

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
