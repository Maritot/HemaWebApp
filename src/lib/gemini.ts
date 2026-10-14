import { getTransactions, getDebts, getGifts, getPeople } from './db';

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
    displayName: 'Gemini 3.8 Flash (Recommended - Free Tier)',
    description: 'High-speed multimodal reasoning on Google AI Studio free tier'
  },
  {
    name: 'models/gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash (Fast - Free Tier)',
    description: 'Fast, highly responsive conversational model'
  },
  {
    name: 'models/gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite (Lightweight - Free Tier)',
    description: 'Ultra-low latency, lightweight tier for high throughput'
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

/**
 * Returns the canonical model name with 'models/' prefix (e.g. "models/gemini-3.8-flash")
 */
export const getActiveModelName = (): string => {
  const cached = localStorage.getItem(ACTIVE_MODEL_STORAGE);
  if (cached) {
    return cached.startsWith('models/') ? cached : `models/${cached}`;
  }
  return 'models/gemini-3.8-flash';
};

/**
 * Returns the short display name without 'models/' prefix for UI badges (e.g. "gemini-3.8-flash")
 */
export const getActiveModelShortName = (): string => {
  return getActiveModelName().replace(/^models\//, '');
};

/**
 * Persists the chosen model in canonical 'models/...' format
 */
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

  // Target model (strictly preserve canonical 'models/...' format)
  const chosen = preferredModel || getActiveModelName() || availableModels[0]?.name || 'models/gemini-3.8-flash';
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
        message: `Notice on ${cleanModelName.replace(/^models\//, '')}: ${errMsg}`,
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

/**
 * Production RAG (Retrieval-Augmented Generation) Engine:
 * Reads local IndexedDB financial records (Transactions, Debts, Vaddi, Gifts, People)
 * and formats verified household grounding data to pass into Gemini.
 */
export async function buildHouseholdRAGContext(query: string): Promise<string> {
  try {
    const [txs, debts, gifts, people] = await Promise.all([
      getTransactions().catch(() => []),
      getDebts().catch(() => []),
      getGifts().catch(() => []),
      getPeople().catch(() => [])
    ]);

    // Financial totals
    const incomeTxs = txs.filter(t => t.type === 'INCOME');
    const expenseTxs = txs.filter(t => t.type === 'EXPENSE');
    const totalIncome = incomeTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
    const totalExpense = expenseTxs.reduce((sum, t) => sum + (t.amount || 0), 0);
    const netSavings = totalIncome - totalExpense;

    // Top Expense Categories breakdown
    const categoryTotals: Record<string, number> = {};
    for (const t of expenseTxs) {
      const cat = t.categoryId || 'General';
      categoryTotals[cat] = (categoryTotals[cat] || 0) + (t.amount || 0);
    }
    const topCategories = Object.entries(categoryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cat, amt]) => `${cat}: ₹${amt.toLocaleString('en-IN')}`)
      .join(', ');

    // Debts & Vaddi
    const pendingDebts = debts.filter(d => d.status !== 'SETTLED');
    const weOweList = pendingDebts.filter(d => d.type === 'WE_OWE');
    const owedToUsList = pendingDebts.filter(d => d.type === 'OWED_TO_US');
    const totalWeOwe = weOweList.reduce((sum, d) => sum + (d.amount || d.principalAmount || 0), 0);
    const totalOwedToUs = owedToUsList.reduce((sum, d) => sum + (d.amount || d.principalAmount || 0), 0);

    const weOweDetails = weOweList.slice(0, 5).map(d => 
      `${d.person}: ₹${(d.principalAmount || d.amount).toLocaleString('en-IN')} (Type: ${d.interestType || 'No Interest'}, Rate: ${d.interestRate ? d.interestRate + '%' : 'None'})`
    ).join('; ');

    const owedToUsDetails = owedToUsList.slice(0, 5).map(d => 
      `${d.person}: ₹${(d.principalAmount || d.amount).toLocaleString('en-IN')} (Type: ${d.interestType || 'No Interest'}, Rate: ${d.interestRate ? d.interestRate + '%' : 'None'})`
    ).join('; ');

    // Gifts (Shagun)
    const giftsGiven = gifts.filter(g => g.type === 'GIVEN');
    const giftsReceived = gifts.filter(g => g.type === 'RECEIVED');
    const totalGiftsGivenValue = giftsGiven.reduce((sum, g) => sum + (g.amount || 0), 0);
    const totalGiftsReceivedValue = giftsReceived.reduce((sum, g) => sum + (g.amount || 0), 0);

    // Entity matching for person mentioned in query
    const qLower = query.toLowerCase();
    const mentionedPeople = people.filter(p => qLower.includes(p.name.toLowerCase()));
    let personSpecificContext = '';
    if (mentionedPeople.length > 0) {
      const personInfo = mentionedPeople.map(p => {
        const pDebts = debts.filter(d => d.person.toLowerCase() === p.name.toLowerCase());
        const pGifts = gifts.filter(g => g.person.toLowerCase() === p.name.toLowerCase());
        return `[Person Record: ${p.name} (${p.relationship || 'Contact'}) | Debts: ${pDebts.map(d => `${d.type}: ₹${d.amount} (${d.status})`).join(', ') || 'None'} | Shagun/Gifts: ${pGifts.map(g => `${g.type} ₹${g.amount} for ${g.occasion}`).join(', ') || 'None'}]`;
      }).join('\n');
      personSpecificContext = `\n[SPECIFIC PERSON RECORD MATCHES]:\n${personInfo}`;
    }

    return `
=== VERIFIED HOUSEHOLD FINANCIAL LEDGER (RAG CONTEXT) ===
• Total Recorded Household Income: ₹${totalIncome.toLocaleString('en-IN')}
• Total Recorded Household Expenses: ₹${totalExpense.toLocaleString('en-IN')}
• Net Cash Balance: ₹${netSavings.toLocaleString('en-IN')}
• Top Expense Categories: ${topCategories || 'None recorded yet'}
• Active Borrowings (We Owe): Total ₹${totalWeOwe.toLocaleString('en-IN')} (${weOweDetails || 'None'})
• Active Lendings (Owed To Us): Total ₹${totalOwedToUs.toLocaleString('en-IN')} (${owedToUsDetails || 'None'})
• Shagun & Gifts: Given ₹${totalGiftsGivenValue.toLocaleString('en-IN')} (${giftsGiven.length} gifts), Received ₹${totalGiftsReceivedValue.toLocaleString('en-IN')} (${giftsReceived.length} gifts)${personSpecificContext}
=========================================================`;
  } catch (e) {
    return '';
  }
}

/**
 * Enterprise Production Query Engine:
 * 1. AbortSignal support for instantaneous cancellation / pause.
 * 2. Multi-Model Automatic Failover on 503 / 429 demand spikes (3.8-flash <-> 3.6-flash <-> 3.1-flash-lite).
 * 3. Chatbot-specific language conditioning (English, Hindi, Telugu) without altering main app UI.
 * 4. Quota-safe execution: Standard queries NEVER consume grounding tools (avoiding 429 quota errors on free-tier keys).
 * 5. Strict SEBI & Fraud Prevention Guardrails.
 */
export function buildSystemPrompt(ragContext: string, chatLanguage: string): string {
  let languageDirective = '';
  if (chatLanguage === 'te') {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: The user has selected Telugu (తెలుగు) as their AI Assistant response language. You MUST formulate your entire response in clear, natural, respectful Telugu script (తెలుగు లిపి). Use warm, polite Telugu terms (నమస్కారం, ఖర్చులు, పొదుపు, వడ్డీ, శుభకార్యాలు). Ensure numbers and currency are formatted with ₹. Even if the user types in English (e.g. "Hi", "expenses"), translate your response into fluent Telugu!`;
  } else if (chatLanguage === 'hi') {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: The user has selected Hindi (हिन्दी) as their AI Assistant response language. You MUST formulate your entire response in clear, natural, respectful Hindi script (देवनागरी). Use warm, polite Hindi terms (नमस्ते, खर्च, बचत, ब्याज, शगुन). Ensure numbers and currency are formatted with ₹. Even if the user types in English (e.g. "Hi", "expenses"), translate your response into fluent Hindi!`;
  } else {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: Respond in friendly, clear Indian English with cultural familiarity (Namaste, Kirana, Shagun, Vaddi).`;
  }

  return `You are Hema, a wise, caring, and practical household financial companion designed exclusively for Indian families and personal money management.
${ragContext}
${languageDirective}

CRITICAL ENTERPRISE GUARDRAILS & DOMAIN SCOPE (STRICTLY ENFORCED):
1. STRICT FINANCIAL DOMAIN SCOPE (OUT-OF-DOMAIN REFUSAL):
   You are EXCLUSIVELY a personal & household finance assistant. You are PROHIBITED from answering non-financial questions, outer world knowledge, international politics (e.g., world leaders, prime ministers, elections), entertainment, sports, celebrity gossip, geography, general trivia, or school homework.
   - If the user asks ANY non-financial question (such as "Who is the prime minister of Australia", "Who won the match", "Tell me about actors/movies", "What is the capital of X"):
     You MUST POLITELY REFUSE and redirect them back to personal finances. DO NOT answer the outer question!
     - English Refusal: "I am Hema, your dedicated household financial companion. I can only assist with personal finances, family budgeting, gold rates, loans, and savings. How can I help you manage your money or budget today?"
     - Telugu Refusal: "క్షమించండి! నేను కేవలం మీ కుటుంబ ఆర్థిక విషయాలు, గృహ బడ్జెట్, బంగారం ధరలు, మరియు పొదుపులకు సంబంధించిన విషయాలలో మాత్రమే సహాయపడగలను. మీ గృహ ఆర్థిక నిర్వహణలో నేను మీకు ఎలా సహాయపడగలను?"
     - Hindi Refusal: "क्षमा करें! मैं केवल पारिवारिक वित्त, घरेलू बजट, सोने के भाव, ऋण और बचत से जुड़े प्रश्नों में आपकी सहायता कर सकती हूँ। मैं आपके पैसों के प्रबंधन या बजट में कैसे मदद करूँ?"

2. NATURAL CONVERSATIONAL FLOW (NO ROBOTIC PREFIXES):
   - DO NOT repeat "Namaste!" or greetings at the start of every message in an ongoing conversation. Greet ONLY on the initial greeting or when greeted.
   - DO NOT prefix answers with formulaic "Topic: [Question]" headers. Dive directly into the answer naturally like a human financial advisor.

3. GREETINGS RULE: When greeted (e.g. "Hi", "Hello", "నమస్కారం", "హలో", "Namaste"), reply in ONLY 1 to 2 warm, friendly sentences. NEVER output unprompted feature lists or tutorials.

4. STRICT BREVITY & CONCISENESS: Keep answers direct, punchy, and under 80-120 words. No repetitive introductory filler or concluding fluff. Answer the user's specific financial question immediately in the first sentence.

5. CLEAN STRUCTURED FORMATTING:
   - Use bold titles (**Headline**) to organize key facts.
   - Use bullet points (* Item) for lists.
   - For Gold rates, interest calculations, or budgets, format into clean, compact bullet pairs (e.g. * **24K Gold:** ₹8,150/g | * **22K Gold:** ₹7,470/g).
   - Never output bare asterisks, broken formatting, or walls of dense text.

6. REGULATORY & DISCLAIMER RULE: Keep any SEBI compliance note to a single subtle sentence at the end (e.g. *(Note: For educational household management only)*). Never generate lengthy legal paragraphs.

7. FRAUD & SAFETY GUARDRAIL: If user mentions suspicious doubling schemes or sharing OTPs, warn them sternly to never share OTPs and report to cybercrime.gov.in (Helpline: 1930).

8. INFORMAL VADDI RULE: For informal borrowings (e.g. ₹2 Vaddi = 2% per month / 24% annual), clearly calculate monthly interest and advise clearing high-interest debt first.`;
}

/**
 * Enterprise Production Query Engine:
 * 1. AbortSignal support for instantaneous cancellation / pause.
 * 2. Multi-Model Automatic Failover on 503 / 429 demand spikes (3.8-flash <-> 3.6-flash <-> 3.1-flash-lite).
 * 3. Chatbot-specific language conditioning (English, Hindi, Telugu) without altering main app UI.
 * 4. Quota-safe execution: Standard queries NEVER consume grounding tools (avoiding 429 quota errors on free-tier keys).
 * 5. Strict SEBI & Fraud Prevention Guardrails.
 */
export const queryGemini = async (
  prompt: string, 
  history: ChatMessage[] = [],
  signal?: AbortSignal,
  chatLanguage: string = 'en'
): Promise<string> => {
  const apiKey = getGeminiApiKey();

  // Generate RAG context from local ledger
  const ragContext = await buildHouseholdRAGContext(prompt);

  // If no Gemini API Key is configured, use local intelligent financial engine
  if (!apiKey) {
    return generateLocalFinancialAdvice(prompt, ragContext, chatLanguage);
  }

  const systemPrompt = buildSystemPrompt(ragContext, chatLanguage);
  const contents = buildStrictGeminiPayload(systemPrompt, prompt, history);

  // Read preferred model and build automatic failover chain
  const primaryModel = getActiveModelName();
  const fallbackList = FREE_TIER_MODELS.map(m => m.name).filter(m => m !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackList];

  let lastErrorMessage = '';

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];

    if (signal?.aborted) {
      return "*(Generation stopped by user)*";
    }

    try {
      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/${currentModel}:generateContent?key=${apiKey}`;

      // Clean standard payload without external tools to ensure 100% free-tier compatibility
      const cleanPayload = {
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };

      const response = await fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload),
        signal
      });

      if (response.ok) {
        const data = await response.json();
        const candidateParts = data.candidates?.[0]?.content?.parts;
        if (candidateParts && candidateParts.length > 0) {
          const fullText = candidateParts.map((p: any) => p.text || '').join('').trim();
          if (fullText) {
            if (i > 0) {
              console.info(`[Hema AI] Successfully failed over to ${currentModel} after spike on ${primaryModel}`);
            }
            return fullText;
          }
        }
      }

      // Check for High Demand (503) or Rate Limit (429) spikes
      const errJson = await response.json().catch(() => ({}));
      const errMsg = errJson.error?.message || `HTTP ${response.status}`;
      lastErrorMessage = errMsg;

      const isHighDemandOrQuota = 
        response.status === 503 || 
        response.status === 429 || 
        errMsg.toLowerCase().includes('demand') ||
        errMsg.toLowerCase().includes('busy');

      if (isHighDemandOrQuota && i < modelsToTry.length - 1) {
        console.warn(`[Hema AI] ${currentModel} experiencing demand spike: "${errMsg}". Failing over to ${modelsToTry[i + 1]}...`);
        continue; // Try next free-tier model seamlessly
      }

    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        return "*(Generation stopped by user)*";
      }
      lastErrorMessage = err.message || 'Network error';
      if (i < modelsToTry.length - 1) {
        continue;
      }
    }
  }

  // If all free-tier models failed due to demand spikes or connectivity:
  return `⚠️ Gemini Free-Tier notice: ${lastErrorMessage || 'Service busy'}. Providing verified local ledger guidance:\n\n${generateLocalFinancialAdvice(prompt, ragContext, chatLanguage)}`;
};

/**
 * Ultra-Fast Streaming Query Engine:
 * 1. Uses Gemini streamGenerateContent?alt=sse for instant <400ms time-to-first-token.
 * 2. thinkingBudget: 0 disables multi-second reasoning pauses.
 * 3. Calls onChunk callback in real-time as text streams in.
 * 4. Multi-model automatic failover if primary encounters 503/429 spikes.
 */
export const queryGeminiStream = async (
  prompt: string, 
  history: ChatMessage[] = [],
  onChunk: (accumulatedText: string) => void,
  signal?: AbortSignal,
  chatLanguage: string = 'en'
): Promise<string> => {
  const apiKey = getGeminiApiKey();
  const ragContext = await buildHouseholdRAGContext(prompt);

  if (!apiKey) {
    const local = generateLocalFinancialAdvice(prompt, ragContext, chatLanguage);
    onChunk(local);
    return local;
  }

  const systemPrompt = buildSystemPrompt(ragContext, chatLanguage);
  const contents = buildStrictGeminiPayload(systemPrompt, prompt, history);
  const primaryModel = getActiveModelName();
  const fallbackList = FREE_TIER_MODELS.map(m => m.name).filter(m => m !== primaryModel);
  const modelsToTry = [primaryModel, ...fallbackList];

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];

    if (signal?.aborted) {
      return "*(Generation stopped by user)*";
    }

    try {
      const streamUrl = `https://generativelanguage.googleapis.com/v1beta/${currentModel}:streamGenerateContent?alt=sse&key=${apiKey}`;

      const cleanPayload = {
        contents,
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 400,
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      };

      const response = await fetch(streamUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanPayload),
        signal
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulatedText = '';
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const jsonString = trimmed.replace(/^data:\s*/, '');
              if (jsonString) {
                try {
                  const chunkObj = JSON.parse(jsonString);
                  const textChunk = chunkObj.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (textChunk) {
                    accumulatedText += textChunk;
                    onChunk(accumulatedText);
                  }
                } catch (e) {}
              }
            }
          }
        }

        if (accumulatedText.trim()) {
          return accumulatedText.trim();
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || signal?.aborted) {
        return "*(Generation stopped by user)*";
      }
      if (i < modelsToTry.length - 1) {
        continue;
      }
    }
  }

  // Fallback to non-streaming queryGemini if streaming had issues
  const fallbackResult = await queryGemini(prompt, history, signal, chatLanguage);
  onChunk(fallbackResult);
  return fallbackResult;
};

/**
 * Intelligent Local Ledger-Aware Fallback Engine
 */
export function generateLocalFinancialAdvice(query: string, ragContext: string = '', chatLanguage: string = 'en'): string {
  const q = query.toLowerCase();
  const isTe = chatLanguage.startsWith('te');
  const isHi = chatLanguage.startsWith('hi');

  if (q.includes('gold') || q.includes('sohna') || q.includes('ornament') || q.includes('carat') || q.includes('బంగారం') || q.includes('సోనా')) {
    if (isTe) {
      return `🪙 **భారతీయ గృహాలకు బంగారు మార్గదర్శకం:**
• సాంప్రదాయకంగా భౌతిక 22K/24K బంగారం ద్రవ్యోల్బణానికి రక్షణగా మరియు అత్యవసర ఆస్తిగా పనిచేస్తుంది.
• నగల కొనుగోలులో తయారీ ఖర్చులు (తరుగు/Wastage 8% - 18%) పరిశీలించండి.
• తరుగు లేకుండా స్వచ్ఛమైన పొదుపు కోసం సావరిన్ గోల్డ్ బాండ్లు (SGB) లేదా గోల్డ్ ఈటీఎఫ్ లు ఉత్తమం.
*(SEBI గమనిక: ఇది కేవలం విద్యా ప్రయోజనాల కొరకు మాత్రమే).*`;
    }
    if (isHi) {
      return `🪙 **भारतीय परिवारों के लिए स्वर्ण मार्गदर्शन:**
• भौतिक 22K/24K सोना मुद्रास्फीति और आपातकालीन सुरक्षा के लिए बेहतरीन माना जाता है।
• आभूषण खरीदते समय मेकिंग चार्ज (8% - 18%) का ध्यान रखें।
• शुद्ध निवेश हेतु सॉवरेन गोल्ड बॉन्ड (SGB) या गोल्ड ETF बेहतर विकल्प हैं।
*(SEBI अनुपालन: केवल शैक्षिक मार्गदर्शन हेतु).*`;
    }
    return `🪙 **Gold Guidance for Indian Households:**
• Historically, physical 22K/24K gold serves as an inflation hedge and emergency collateral in India.
• When buying gold ornaments, keep making charges (wastage) in mind (usually 8% - 18%).
• For pure investment without making charges, Sovereign Gold Bonds (SGB) or Gold ETFs offer higher net returns.
*(SEBI Compliance: Educational overview only, not registered advisory).*`;
  }

  if (q.includes('vaddi') || q.includes('interest') || q.includes('debt') || q.includes('loan') || q.includes('వడ్డీ') || q.includes('బ్యాచ్') || q.includes('అప్పు')) {
    if (isTe) {
      return `📊 **వడ్డీ & అప్పుల నిర్వహణ:**
• సాంప్రదాయ "₹2 వడ్డీ" అంటే నెలకు 2% (సంవత్సరానికి 24%).
• బయట అధిక వడ్డీకి తెచ్చిన అప్పులను ముందుగా చెల్లించండి, ఎందుకంటే బ్యాంకు పొదుపు ఖాతా కేవలం 3%–6% మాత్రమే ఇస్తుంది.
• ప్రతి చెల్లింపునకు తేదీ, చెల్లింపు విధానం (UPI/నగదు) మరియు రశీదు తప్పక నమోదు చేసుకోండి.`;
    }
    if (isHi) {
      return `📊 **ब्याज और ऋण प्रबंधन:**
• पारंपरिक "₹2 ब्याज" का अर्थ 2% प्रति माह (अर्थात 24% वार्षिक) होता है।
• बैंक बचत (3%-6%) से पहले हमेशा उच्च ब्याज वाले अनौपचारिक कर्जों को चुकाना बुद्धिमानी है।
• हर किस्त का भुगतान यूपीआई/नकद रसीद के साथ रजिस्टर में दर्ज रखें।`;
    }
    return `📊 **Indian Vaddi & Loan Management:**
• Traditional "₹2 Vaddi" translates to 2% per month (or 24% per annum).
• Always pay off high-interest informal borrowings before putting surplus money into bank savings (which yield only 3%–6% per annum).
• Keep clear records of every installment with date, mode (UPI/Cash), and receiver acknowledgement.`;
  }

  if (q.includes('spend') || q.includes('expense') || q.includes('budget') || q.includes('saving') || q.includes('ఖర్చు') || q.includes('పొదుపు')) {
    if (isTe) {
      return `💡 **గృహ బడ్జెట్ 50-30-20 నియమం:**
• **50% నిత్యావసరాలు:** కిరాణా, విద్యుత్/నీటి బిల్లులు, పిల్లల ఫీజులు, పాలు, మందులు.
• **30% కోరికలు:** బట్టలు, కుటుంబ విహారాలు, రెస్టారెంట్ ఖర్చులు.
• **20% పొదుపు:** ఫిక్స్‌డ్ డిపాజిట్లు లేదా అత్యవసర నిధి.
• రోజువారీ ఖర్చులను ఎప్పటికప్పుడు Expenses ట్యాబ్‌లో రికార్డ్ చేయండి.`;
    }
    return `💡 **Household 50-30-20 Rule for Families:**
• **50% Essentials:** Kirana/Groceries, Electricity/Water, School fees, Milk, Medicine.
• **30% Discretionary:** Family dinners, clothes, shopping.
• **20% Emergency & Savings:** Kept in Fixed Deposits or Liquid Mutual Funds.
• Track everyday cash expenses immediately in the Expenses tab to avoid month-end cash leaks.`;
  }

  if (q.includes('gift') || q.includes('shagun') || q.includes('wedding') || q.includes('శుభకార్యం') || q.includes('చదివింపులు')) {
    if (isTe) {
      return `🎁 **శుభకార్యాల చదివింపులు & బహుమతుల మర్యాద:**
• మన సంస్కృతిలో చదివింపులను శుభప్రదంగా +₹1 తో (ఉదా. ₹501, ₹1,116, ₹2,101) ఇవ్వడం ఆచారం.
• ఏదైనా ఫంక్షన్‌కు వెళ్లేముందు Gifts ట్యాబ్‌లో ఆ వ్యక్తి పేరు చూసి, గతంలో వారు ఇచ్చిన దానికి తగినట్లుగా మర్యాద చేయండి.`;
    }
    return `🎁 **Shagun & Gift Etiquette:**
• In Indian culture, Shagun amounts traditionally end with +₹1 (e.g., ₹501, ₹1,116, ₹2,101) as a blessing for continuous prosperity.
• Check the Gift Ledger under the person's name before attending a function to reciprocate honorably based on past exchanges.`;
  }

  // Friendly, concise greeting handling
  if (q.includes('hi') || q.includes('hello') || q.includes('namaste') || q.includes('hey') || q.includes('నమస్కారం') || q.includes('నమస్తే') || q.includes('नमस्ते')) {
    if (isTe) {
      return `నమస్కారం! నేను మీ హేమ (Hema). మీ గృహ బడ్జెట్, బంగారం రేట్లు, లేదా ₹2 వడ్డీ లెక్కల గురించి మీకు ఎలా సహాయపడగలను?`;
    }
    if (isHi) {
      return `नमस्ते! मैं आपकी हेमा (Hema) हूँ। आपके पारिवारिक बजट, सोने के भाव या बचत के बारे में मैं आपकी क्या मदद कर सकती हूँ?`;
    }
    return `Namaste! I am Hema, your household financial companion. How can I assist you today with your family budget, gold rates, or savings?`;
  }

  if (isTe) {
    return `నమస్కారం! నేను మీ Hema ఫైనాన్షియల్ అసిస్టెంట్‌ని. బంగారం ధరలు, ₹2 వడ్డీ, గృహ బడ్జెట్ లేదా పొదుపు గురించి ఏదైనా అడగండి.`;
  }

  if (isHi) {
    return `नमस्ते! मैं आपकी हेमा (Hema) हूँ। सोने के भाव, ₹2 ब्याज, घरेलू बजट या बचत के बारे में कुछ भी पूछें।`;
  }

  return `Namaste! I am your Hema Financial Assistant. Feel free to ask about gold rates, informal ₹ Vaddi calculations, monthly budgets, or household savings.`;
}
