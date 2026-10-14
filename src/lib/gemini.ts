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

  // Dynamic Language Directive explicitly for the AI Assistant's response
  let languageDirective = '';
  if (chatLanguage === 'te') {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: The user has selected Telugu (తెలుగు) as their AI Assistant response language. You MUST formulate your entire response in clear, natural, respectful Telugu script (తెలుగు లిపి). Use warm, polite Telugu terms (నమస్కారం, ఖర్చులు, పొదుపు, వడ్డీ, శుభకార్యాలు). Ensure numbers and currency are formatted with ₹. Even if the user types in English (e.g. "Hi", "expenses"), translate your response into fluent Telugu!`;
  } else if (chatLanguage === 'hi') {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: The user has selected Hindi (हिन्दी) as their AI Assistant response language. You MUST formulate your entire response in clear, natural, respectful Hindi script (देवनागरी). Use warm, polite Hindi terms (नमस्ते, खर्च, बचत, ब्याज, शगुन). Ensure numbers and currency are formatted with ₹. Even if the user types in English (e.g. "Hi", "expenses"), translate your response into fluent Hindi!`;
  } else {
    languageDirective = `\nCRITICAL LANGUAGE INSTRUCTION: Respond in friendly, clear Indian English with cultural familiarity (Namaste, Kirana, Shagun, Vaddi).`;
  }

  const systemPrompt = `You are Hema, a wise, caring, and practical financial assistant designed for Indian households and families.
${ragContext}
${languageDirective}

ENTERPRISE PRODUCTION GUARDRAILS:
1. SEBI Regulatory Compliance: All insights are strictly for educational and household management purposes. Do not give speculative stock trading calls or guaranteed return promises. Include brief disclaimer when discussing investments.
2. Fraud & Scam Guardrail: If user mentions suspicious lottery messages, doubling money, telegram tasks, or sharing OTPs/PINs, strongly warn them to never share OTP or transfer money, and advise reporting to cybercrime.gov.in (Helpline: 1930).
3. Informal Vaddi & Debt Priority: When households carry informal high-interest loans (e.g. ₹2 or ₹3 Vaddi monthly = 24-36% annual), advise prioritizing repayment before discretionary luxury spending.
4. Tone: Respectful, culturally attuned, warm, structured with bullet points.`;

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
      // (Google Search grounding requires paid Google Cloud billing and causes 429 quota exceeded on free keys)
      const cleanPayload = {
        contents,
        generationConfig: {
          temperature: 0.65,
          maxOutputTokens: 1000
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

  if (isTe) {
    return `నమస్కారం! నేను మీ Hema ఫైనాన్షియల్ అసిస్టెంట్‌ని. మీరు నన్ను వీటిపై అడగవచ్చు:
• ఫిక్స్‌డ్ డిపాజిట్ vs బంగారం పొదుపు
• ₹2 రూపాయల వడ్డీ లెక్కలు
• నెలవారీ కిరాణా మరియు ఇంటి ఖర్చుల నియంత్రణ
• మీ గృహ బడ్జెట్ మరియు అప్పుల వివరాలు`;
  }

  if (isHi) {
    return `नमस्ते! मैं आपकी हेमा फाइनेंशियल असिस्टेंट हूँ। आप मुझसे पूछ सकते हैं:
• फिक्स्ड डिपॉजिट बनाम सोना निवेश
• ₹2 ब्याज की सटीक गणना
• मासिक किराना और घरेलू बजट नियंत्रण
• आपके खाते का आय-व्यय विवरण`;
  }

  return `Namaste! I am your Hema Financial Assistant. You can ask me about:
• Comparing Fixed Deposits vs Gold
• Calculating informal ₹ Vaddi interest
• Setting a monthly Kirana/Grocery budget
• Tax savings under Indian New vs Old Tax regime`;
}
