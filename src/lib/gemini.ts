import { getTransactions, getDebts, getGifts } from './db';

const GEMINI_KEY_STORAGE = 'hema_gemini_api_key';
const ACTIVE_TARGET_STORAGE = 'hema_active_gemini_target';

export interface EndpointTarget {
  apiVersion: 'v1' | 'v1beta';
  model: string;
}

// Priority target list (stable GA v1 first, then v1beta next-gen)
export const ENDPOINT_TARGETS: EndpointTarget[] = [
  { apiVersion: 'v1', model: 'gemini-1.5-flash' },
  { apiVersion: 'v1beta', model: 'gemini-2.5-flash' },
  { apiVersion: 'v1beta', model: 'gemini-2.0-flash' },
  { apiVersion: 'v1', model: 'gemini-1.5-pro' },
  { apiVersion: 'v1beta', model: 'gemini-2.5-flash-lite' },
  { apiVersion: 'v1beta', model: 'gemini-1.5-flash-latest' },
  { apiVersion: 'v1', model: 'gemini-pro' }
];

export const getGeminiApiKey = (): string => {
  return localStorage.getItem(GEMINI_KEY_STORAGE) || import.meta.env.VITE_GEMINI_API_KEY || '';
};

export const setGeminiApiKey = (key: string): void => {
  if (key) {
    localStorage.setItem(GEMINI_KEY_STORAGE, key.trim());
    localStorage.removeItem(ACTIVE_TARGET_STORAGE);
  } else {
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(ACTIVE_TARGET_STORAGE);
  }
};

export const clearGeminiCache = (): void => {
  localStorage.removeItem(ACTIVE_TARGET_STORAGE);
};

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

/**
 * Discover working models by querying both v1 and v1beta ModelService endpoints
 */
export const discoverWorkingTarget = async (apiKey: string): Promise<EndpointTarget> => {
  // Check cached target
  try {
    const cached = localStorage.getItem(ACTIVE_TARGET_STORAGE);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed.apiVersion && parsed.model) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignore cache parse error
  }

  // Try checking available models from v1 and v1beta
  for (const apiVer of ['v1', 'v1beta'] as const) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/${apiVer}/models?key=${apiKey}`);
      if (res.ok) {
        const data = await res.json();
        const available: string[] = (data.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
          .map((m: any) => m.name.replace(/^models\//, ''));

        // Match against prioritized models
        for (const target of ENDPOINT_TARGETS) {
          if (target.apiVersion === apiVer && available.includes(target.model)) {
            localStorage.setItem(ACTIVE_TARGET_STORAGE, JSON.stringify(target));
            return target;
          }
        }

        // Match any flash model
        const anyFlash = available.find(m => m.toLowerCase().includes('flash'));
        if (anyFlash) {
          const matched: EndpointTarget = { apiVersion: apiVer, model: anyFlash };
          localStorage.setItem(ACTIVE_TARGET_STORAGE, JSON.stringify(matched));
          return matched;
        }

        if (available.length > 0) {
          const matched: EndpointTarget = { apiVersion: apiVer, model: available[0] };
          localStorage.setItem(ACTIVE_TARGET_STORAGE, JSON.stringify(matched));
          return matched;
        }
      }
    } catch (e) {
      // Continue to next version
    }
  }

  // Default to v1 with gemini-1.5-flash
  return { apiVersion: 'v1', model: 'gemini-1.5-flash' };
};

/**
 * Test the API key and return exact status and working model
 */
export const testGeminiConnection = async (apiKey: string): Promise<{ success: boolean; model?: string; message: string }> => {
  if (!apiKey.trim()) {
    return { success: false, message: 'Please enter an API key.' };
  }

  const cleanKey = apiKey.trim();
  const testPrompt = [{ role: 'user', parts: [{ text: 'Respond with the single word: READY' }] }];

  for (const target of ENDPOINT_TARGETS) {
    try {
      const url = `https://generativelanguage.googleapis.com/${target.apiVersion}/models/${target.model}:generateContent?key=${cleanKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: testPrompt })
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          localStorage.setItem(ACTIVE_TARGET_STORAGE, JSON.stringify(target));
          return {
            success: true,
            model: `${target.model} (${target.apiVersion})`,
            message: `Connected successfully to Google Gemini (${target.model} on ${target.apiVersion})!`
          };
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        const errMsg = errJson.error?.message || `HTTP ${res.status}`;
        if (res.status === 400 && errMsg.includes('API key not valid')) {
          return { success: false, message: 'Invalid API key. Please check your Google AI Studio key.' };
        }
      }
    } catch (e: any) {
      // Continue checking next candidate
    }
  }

  return { 
    success: false, 
    message: 'Could not connect to Gemini models. Falling back to local offline financial assistant.' 
  };
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

  // Get discovered target and candidate targets
  const bestTarget = await discoverWorkingTarget(apiKey);
  const targetsToTry: EndpointTarget[] = [
    bestTarget,
    ...ENDPOINT_TARGETS.filter(t => !(t.apiVersion === bestTarget.apiVersion && t.model === bestTarget.model))
  ];

  for (const target of targetsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/${target.apiVersion}/models/${target.model}:generateContent?key=${apiKey}`;
      const response = await fetch(url, {
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
          // Successfully got response! Save this working target
          localStorage.setItem(ACTIVE_TARGET_STORAGE, JSON.stringify(target));
          return candidateText.trim();
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const status = response.status;
        const errMsg = errData.error?.message || `HTTP ${status}`;

        // If invalid key, return clear guidance
        if (status === 400 && errMsg.includes('API key not valid')) {
          return `Google Gemini notice: The entered API key is invalid. Please tap "Change Key" in the top banner and paste your key from Google AI Studio.`;
        }

        // If 404 or unsupported, continue trying next endpoint target silently
        if (status === 404 || status === 400) {
          continue;
        }
      }
    } catch (netErr: any) {
      // Network error, try next or fallback
    }
  }

  // If all online attempts failed, fall back to local guidance gracefully
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
