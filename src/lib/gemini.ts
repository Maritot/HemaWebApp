import { getTransactions, getDebts, getGifts } from './db';

const GEMINI_KEY_STORAGE = 'hema_gemini_api_key';
const ACTIVE_MODEL_STORAGE = 'hema_active_gemini_model';

export interface AvailableModel {
  name: string;        // e.g. "models/gemini-2.5-flash"
  displayName: string; // e.g. "Gemini 2.5 Flash"
  description?: string;
}

export const getGeminiApiKey = (): string => {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
};

export const setGeminiApiKey = (key: string): void => {
  if (key) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    localStorage.removeItem(ACTIVE_MODEL_STORAGE);
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
  return 'Gemini Live';
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
  // Find first message spoken by the actual user
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

  // Ensure prompt is appended as final user turn
  if (contents.length === 0 || contents[contents.length - 1].role === 'model') {
    contents.push({
      role: 'user',
      parts: [{ text: prompt }]
    });
  } else {
    contents[contents.length - 1].parts[0].text = prompt;
  }

  // Prepend the system instructions to the first user turn so it works universally
  contents[0].parts[0].text = `${systemPrompt}\n\n[User Question]: ${contents[0].parts[0].text}`;

  return contents;
}

/**
 * Query Google Generative Language ModelService directly to retrieve all models
 * permitted for this user's specific API key.
 */
export const fetchAvailableModels = async (apiKey: string): Promise<AvailableModel[]> => {
  if (!apiKey.trim()) return [];

  const cleanKey = apiKey.trim();

  for (const apiVer of ['v1beta', 'v1']) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${apiVer}/models?key=${cleanKey}`);
      if (res.ok) {
        const data = await res.json();
        const models: AvailableModel[] = (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => ({
            name: m.name, // e.g. "models/gemini-2.5-flash"
            displayName: m.displayName || m.name.replace(/^models\//, ''),
            description: m.description
          }));

        if (models.length > 0) {
          return models;
        }
      }
    } catch (e) {
      console.warn(`Failed to list models on ${apiVer}:`, e);
    }
  }

  return [];
};

/**
 * Test the API key by listing Google's active models and sending a test ping.
 */
export const testGeminiConnection = async (
  apiKey: string,
  preferredModel?: string
): Promise<{ success: boolean; model?: string; message: string; availableModels?: AvailableModel[] }> => {
  if (!apiKey.trim()) {
    return { success: false, message: 'Please enter your Google Gemini API key.' };
  }

  const cleanKey = apiKey.trim();

  // 1. Fetch available models from Google's ModelService
  let availableModels: AvailableModel[] = [];
  try {
    availableModels = await fetchAvailableModels(cleanKey);
  } catch (e: any) {
    return { success: false, message: `Could not reach Google API: ${e.message}` };
  }

  if (availableModels.length === 0) {
    // If list returned empty, fetch raw error to report exact reason
    try {
      const testRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`);
      const errJson = await testRes.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${testRes.status}`;
      return { success: false, message: `Google API Error: ${errMsg}` };
    } catch (e: any) {
      return { success: false, message: `Network error: ${e.message}. Check your internet connection.` };
    }
  }

  // 2. Choose target model (preferredModel, or highest flash model, or first available)
  let targetModel = preferredModel 
    ? availableModels.find(m => m.name === preferredModel || m.name.endsWith(preferredModel))
    : null;

  if (!targetModel) {
    targetModel = availableModels.find(m => m.name.toLowerCase().includes('flash')) || availableModels[0];
  }

  // 3. Test generateContent
  try {
    const testPayload = {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Respond with the single word: OK' }]
        }
      ]
    };

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/${targetModel.name}:generateContent?key=${cleanKey}`;
    const genRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testPayload)
    });

    if (genRes.ok) {
      const data = await genRes.json();
      const reply = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        localStorage.setItem(ACTIVE_MODEL_STORAGE, targetModel.name);
        return {
          success: true,
          model: targetModel.displayName || targetModel.name,
          message: `✅ Connected successfully: ${targetModel.displayName || targetModel.name}!`,
          availableModels
        };
      }
    } else {
      const errJson = await genRes.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${genRes.status}`;
      return {
        success: false,
        message: `Model test failed on ${targetModel.name}: ${errMsg}`,
        availableModels
      };
    }
  } catch (err: any) {
    return {
      success: false,
      message: `Request failed: ${err.message}`,
      availableModels
    };
  }

  return { success: false, message: 'Unknown error occurred while verifying.', availableModels };
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

  // Determine active model from cache or dynamically discover
  let activeModel = localStorage.getItem(ACTIVE_MODEL_STORAGE);
  if (!activeModel) {
    const testResult = await testGeminiConnection(apiKey);
    if (testResult.success) {
      activeModel = localStorage.getItem(ACTIVE_MODEL_STORAGE);
    }
  }

  const modelToCall = activeModel || 'models/gemini-2.5-flash';

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
      // Invalidate cached model on failure so it can re-discover
      localStorage.removeItem(ACTIVE_MODEL_STORAGE);
      return `⚠️ Gemini API notice: ${errMsg}. Showing local advice instead:\n\n${generateLocalFinancialAdvice(prompt)}`;
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
