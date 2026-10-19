import { getTransactions, getDebts, getGifts, getPeople } from './db';
import { getLiveGoldRates, formatGoldRatesSummary } from './marketRates';

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
  lang?: 'en' | 'hi' | 'te';
}

/**
 * Real-time Script and Language Guardrail Detector:
 * Checks Unicode script ranges to detect script drift or language deviation instantly.
 * Devanagari range: \u0900-\u097F
 * Telugu range: \u0C00-\u0C7F
 */
export function detectLanguageViolation(
  text: string, 
  targetLang: string = 'en'
): { isViolation: boolean; reason?: string } {
  if (!text || text.trim().length === 0) return { isViolation: false };

  const clean = text.replace(/```[\s\S]*?```/g, '').replace(/https?:\/\/\S+/g, '');
  const devanagariCount = (clean.match(/[\u0900-\u097F]/g) || []).length;
  const teluguCount = (clean.match(/[\u0C00-\u0C7F]/g) || []).length;

  if (targetLang === 'en') {
    // English responses MUST NEVER contain Devanagari (Hindi) or Telugu characters
    if (devanagariCount > 3) {
      return { isViolation: true, reason: `Devanagari characters (${devanagariCount}) detected in English mode` };
    }
    if (teluguCount > 3) {
      return { isViolation: true, reason: `Telugu characters (${teluguCount}) detected in English mode` };
    }
  } else if (targetLang === 'hi') {
    // Hindi responses MUST NEVER contain Telugu script
    if (teluguCount > 3) {
      return { isViolation: true, reason: `Telugu characters (${teluguCount}) detected in Hindi mode` };
    }
    // If response is substantial (>60 chars) and lacks Devanagari, it drifted into English
    if (clean.length > 60 && devanagariCount < 6) {
      return { isViolation: true, reason: `Insufficient Devanagari script in Hindi mode` };
    }
  } else if (targetLang === 'te') {
    // Telugu responses MUST NEVER contain Devanagari script
    if (devanagariCount > 3) {
      return { isViolation: true, reason: `Devanagari characters (${devanagariCount}) detected in Telugu mode` };
    }
    // If response is substantial (>60 chars) and lacks Telugu, it drifted into English
    if (clean.length > 60 && teluguCount < 6) {
      return { isViolation: true, reason: `Insufficient Telugu script in Telugu mode` };
    }
  }

  return { isViolation: false };
}

/**
 * Returns an unmissable, zero-tolerance language enforcement directive
 */
export function getTargetLanguageDirective(chatLanguage: string): string {
  if (chatLanguage === 'te') {
    return 'CRITICAL DIRECTIVE: Formulate your entire response 100% in natural, respectful TELUGU SCRIPT (తెలుగు లిపి). Absolutely NO English sentences, NO Devanagari script. All calculations in ₹. Zero deviation allowed.';
  }
  if (chatLanguage === 'hi') {
    return 'CRITICAL DIRECTIVE: Formulate your entire response 100% in natural, respectful HINDI DEVANAGARI SCRIPT (देवनागरी लिपि). Absolutely NO English sentences, NO Telugu script. All calculations in ₹. Zero deviation allowed.';
  }
  return 'CRITICAL DIRECTIVE: Formulate your entire response 100% in standard ENGLISH ONLY. Absolutely NO Hindi / Devanagari script (e.g. का मतलब, शेयर बाज़ार, आदि). Absolutely NO Telugu script. All calculations in ₹. Zero deviation allowed.';
}

/**
 * Builds a strictly alternating Gemini payload:
 * 1. Guarantees first turn has role: 'user'
 * 2. Alternates strictly between 'user' and 'model'
 * 3. Never produces consecutive same-role turns
 * 4. Sanitizes past foreign assistant turns to eliminate script cross-attention poisoning
 * 5. Embeds mandatory zero-tolerance language directives directly into the active prompt
 */
export function buildStrictGeminiPayload(
  systemPrompt: string, 
  prompt: string, 
  rawHistory: ChatMessage[] = [],
  chatLanguage: string = 'en'
): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
  const firstUserIdx = rawHistory.findIndex(m => m.role === 'user');
  let pastTurns = firstUserIdx !== -1 ? rawHistory.slice(firstUserIdx) : [];

  // Limit past turns to last 6 to keep context sharp and prevent script contamination
  if (pastTurns.length > 6) {
    pastTurns = pastTurns.slice(pastTurns.length - 6);
  }

  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  let expectedRole: 'user' | 'model' = 'user';
  for (const turn of pastTurns) {
    const role: 'user' | 'model' = turn.role === 'assistant' ? 'model' : 'user';
    if (role === expectedRole) {
      let turnContent = turn.text;
      // Sanitize past assistant turns if they contain a conflicting script to prevent few-shot bleeding
      if (role === 'model') {
        const check = detectLanguageViolation(turnContent, chatLanguage);
        if (check.isViolation) {
          turnContent = `[Note: Previous assistant reply regarding household finances was in another language]`;
        }
      }
      contents.push({ role, parts: [{ text: turnContent }] });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    }
  }

  const languageDirective = getTargetLanguageDirective(chatLanguage);
  const activePromptText = `${prompt}\n\n[MANDATORY SYSTEM DIRECTIVE]: ${languageDirective}`;

  if (contents.length === 0 || contents[contents.length - 1].role === 'model') {
    contents.push({
      role: 'user',
      parts: [{ text: activePromptText }]
    });
  } else {
    contents[contents.length - 1].parts[0].text = activePromptText;
  }

  // Prepend system prompt to the first user turn as defense-in-depth alongside top-level system_instruction
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
    const totalWeOwe = weOweList.reduce((sum, d) => {
      const repaid = (d.payments || []).reduce((pSum, p) => pSum + p.amount, 0);
      return sum + Math.max(0, (d.amount || d.principalAmount || 0) - repaid);
    }, 0);
    const totalOwedToUs = owedToUsList.reduce((sum, d) => {
      const repaid = (d.payments || []).reduce((pSum, p) => pSum + p.amount, 0);
      return sum + Math.max(0, (d.amount || d.principalAmount || 0) - repaid);
    }, 0);

    // Gifts (Shagun)
    const giftsGiven = gifts.filter(g => g.type === 'GIVEN');
    const giftsReceived = gifts.filter(g => g.type === 'RECEIVED');
    const totalGiftsGivenValue = giftsGiven.reduce((sum, g) => sum + (g.amount || 0), 0);
    const totalGiftsReceivedValue = giftsReceived.reduce((sum, g) => sum + (g.amount || 0), 0);

    // 1. People Directory
    const peopleList = people.length > 0
      ? people.map(p => `• Person: "${p.name}" | Relation: ${p.relationship || 'Contact'} | Phone: ${p.phone || 'N/A'}${p.notes ? ` | Notes: ${p.notes}` : ''}`).join('\n')
      : 'None registered yet.';

    // 2. Gifts Received
    const formatGift = (g: any) => {
      const dateStr = g.date ? new Date(g.date).toLocaleDateString('en-IN') : 'N/A';
      const weightInfo = g.weightGrams ? `, ${g.weightGrams}g` : '';
      const purityInfo = g.purity ? ` ${g.purity}` : '';
      const itemDesc = `${g.item || 'Gift'} (${g.category || 'CASH'}${weightInfo}${purityInfo})`;
      const notesStr = g.notes ? ` | Notes: ${g.notes}` : '';
      return `• [${g.type === 'RECEIVED' ? 'RECEIVED FROM' : 'GIVEN TO'}] Person: "${g.person}" | Occasion: ${g.occasion} | Item: ${itemDesc} | Amount: ₹${(g.amount || 0).toLocaleString('en-IN')} | Date: ${dateStr}${notesStr}`;
    };

    const receivedGiftsFormatted = giftsReceived.length > 0
      ? giftsReceived.map(formatGift).join('\n')
      : 'None recorded yet.';

    // 3. Gifts Given
    const givenGiftsFormatted = giftsGiven.length > 0
      ? giftsGiven.map(formatGift).join('\n')
      : 'None recorded yet.';

    // 4. Debts & Loans Complete Register
    const formatDebt = (d: any) => {
      const principal = d.principalAmount || d.amount || 0;
      const totalDue = d.amount || d.principalAmount || 0;
      const repaid = (d.payments || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
      const balance = Math.max(0, totalDue - repaid);
      const dueStr = d.dueDate ? new Date(d.dueDate).toLocaleDateString('en-IN') : 'N/A';
      const typeStr = d.type === 'WE_OWE' ? 'WE OWE (Borrowing)' : 'OWED TO US (Lending)';
      const termsStr = d.interestType && d.interestType !== 'NONE'
        ? `${d.interestType}${d.interestRate ? ` (${d.interestRate}%)` : ''}`
        : 'No Interest';
      const notesStr = d.notes ? ` | Notes: ${d.notes}` : '';
      return `• [${typeStr}] Person: "${d.person}" | Status: ${d.status} | Principal: ₹${principal.toLocaleString('en-IN')} | Total Due: ₹${totalDue.toLocaleString('en-IN')} | Repaid: ₹${repaid.toLocaleString('en-IN')} | Balance Remaining: ₹${balance.toLocaleString('en-IN')} | Terms: ${termsStr} | Due Date: ${dueStr}${notesStr}`;
    };

    const debtsFormatted = debts.length > 0
      ? debts.map(formatDebt).join('\n')
      : 'None recorded yet.';

    // 5. Recent Transactions
    const sortedTxs = [...txs].sort((a, b) => (b.date || 0) - (a.date || 0));
    const txsFormatted = sortedTxs.length > 0
      ? sortedTxs.slice(0, 50).map(t => {
          const dateStr = t.date ? new Date(t.date).toLocaleDateString('en-IN') : 'N/A';
          const labelStr = t.label ? ` (User Label: "${t.label}")` : '';
          const notesStr = t.notes ? ` | Notes: ${t.notes}` : '';
          return `• Date: ${dateStr} | Type: ${t.type} | Category: ${t.categoryId}${labelStr} | Amount: ₹${(t.amount || 0).toLocaleString('en-IN')}${notesStr}`;
        }).join('\n')
      : 'None recorded yet.';

    const bullion = await getLiveGoldRates();

    return `
=== VERIFIED LIVE HOUSEHOLD FINANCIAL DATABASE & MARKET RATES (FULL RAG CONTEXT) ===
[LIVE MARKET BULLION RATES (TIRUPATI, AP & ALL-INDIA)]:
• Reference City: ${bullion.city}, ${bullion.state} (Verified As of ${bullion.dateStr})
• 24-Karat Gold (99.9% Pure Bullion): ₹${bullion.rate24kPerGram.toLocaleString('en-IN')} per gram (₹${(bullion.rate24kPerGram * 10).toLocaleString('en-IN')} per 10 grams)
• 22-Karat Gold (91.6% KDM Hallmark Jewellery): ₹${bullion.rate22kPerGram.toLocaleString('en-IN')} per gram (₹${(bullion.rate22kPerGram * 10).toLocaleString('en-IN')} per 10 grams | ₹${(bullion.rate22kPerGram * 8).toLocaleString('en-IN')} per 8g Tola/Savaran)
• 18-Karat Gold (75% Purity): ₹${bullion.rate18kPerGram.toLocaleString('en-IN')} per gram (₹${(bullion.rate18kPerGram * 10).toLocaleString('en-IN')} per 10 grams)
• Silver (Fine 99.9% / వెండి): ₹${bullion.silverPerGram.toLocaleString('en-IN')} per gram (₹${(bullion.silverPerGram * 1000).toLocaleString('en-IN')} per 1 kg)
• Jewellery Buying Guidance: Remind buyers that ornament purchases incur making charges (తరుగు / wastage typically ${bullion.wastageRange}) and ${bullion.gstPercent}% GST. Always advise verifying the 6-digit BIS HUID hallmark.

[SUMMARY TOTALS]:
• Total Recorded Household Income: ₹${totalIncome.toLocaleString('en-IN')}
• Total Recorded Household Expenses: ₹${totalExpense.toLocaleString('en-IN')}
• Net Cash Balance: ₹${netSavings.toLocaleString('en-IN')}
• Top Expense Categories: ${topCategories || 'None recorded yet'}
• Total Active Borrowings (We Owe): ₹${totalWeOwe.toLocaleString('en-IN')}
• Total Active Lendings (Owed To Us): ₹${totalOwedToUs.toLocaleString('en-IN')}
• Total Gifts Received: ${giftsReceived.length} items (Total ₹${totalGiftsReceivedValue.toLocaleString('en-IN')})
• Total Gifts Given: ${giftsGiven.length} items (Total ₹${totalGiftsGivenValue.toLocaleString('en-IN')})

[PEOPLE DIRECTORY (Family, Friends, Contacts)]:
${peopleList}

[GIFTS & SHAGUN REGISTRY - RECEIVED FROM PEOPLE]:
${receivedGiftsFormatted}

[GIFTS & SHAGUN REGISTRY - GIVEN TO PEOPLE]:
${givenGiftsFormatted}

[LOANS & DEBTS COMPLETE REGISTRY (Active & Settled)]:
${debtsFormatted}

[RECENT TRANSACTIONS LOG]:
${txsFormatted}
=====================================================================`;
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
    languageDirective = `
======================================================================
MANDATORY LANGUAGE GUARDRAIL (TELUGU SCRIPT ONLY - ZERO TOLERANCE):
- The user has selected TELUGU (తెలుగు).
- You MUST formulate your ENTIRE response exclusively in clear, natural, respectful TELUGU SCRIPT (తెలుగు లిపి).
- You are STRICTLY FORBIDDEN from using Hindi / Devanagari script (क, ख, ग) or writing responses in English.
- Even if the user types their prompt in English (e.g. "What is IPO", "What is fd", "expenses"), translate your entire explanation into fluent, respectful Telugu script.
- Ensure all numbers and currency are formatted with the Indian Rupee symbol (₹).
======================================================================`;
  } else if (chatLanguage === 'hi') {
    languageDirective = `
======================================================================
MANDATORY LANGUAGE GUARDRAIL (HINDI DEVANAGARI ONLY - ZERO TOLERANCE):
- The user has selected HINDI (हिन्दी).
- You MUST formulate your ENTIRE response exclusively in clear, natural, respectful HINDI DEVANAGARI SCRIPT (देवनागरी लिपि).
- You are STRICTLY FORBIDDEN from using Telugu script (క, ఖ, గ) or writing full responses in English.
- Even if the user types their prompt in English (e.g. "What is IPO", "What is fd", "expenses"), translate your entire explanation into fluent, respectful Hindi Devanagari script.
- Ensure all numbers and currency are formatted with the Indian Rupee symbol (₹).
======================================================================`;
  } else {
    languageDirective = `
======================================================================
MANDATORY LANGUAGE GUARDRAIL (ENGLISH ONLY - ZERO TOLERANCE):
- The user has selected ENGLISH.
- You MUST formulate your ENTIRE response 100% in clear, professional, friendly INDIAN ENGLISH.
- ABSOLUTELY NO HINDI (NO DEVANAGARI SCRIPT, NO HINDI PHRASES like "का मतलब है", "शेयर बाज़ार", "आम जनता", "बचत").
- ABSOLUTELY NO TELUGU SCRIPT.
- Every single heading, sentence, bullet point, and disclaimer MUST be written in standard English.
- Even if previous messages in the chat history or earlier questions were in Hindi or Telugu, the user has explicitly switched to ENGLISH now. Disregard past foreign-language responses and write 100% in ENGLISH.
- Any Hindi or Telugu word in your response is a severe compliance violation.
======================================================================`;
  }

  return `You are Hema, a wise, caring, and practical household financial companion designed exclusively for Indian families and personal money management.
${ragContext}
${languageDirective}

CRITICAL ENTERPRISE GUARDRAILS & DOMAIN SCOPE (STRICTLY ENFORCED):
1. FULL DYNAMIC DATA ACCESS & SHEETS / REPORTS GENERATION:
   - You have 100% COMPLETE, dynamic access to the user's real local household database provided in the RAG CONTEXT above:
     * People Directory (family members, relatives, contacts, phone numbers).
     * Complete Gifts & Shagun Ledger (exact names of all gift givers, gift recipients, occasions, items, gold/silver weights, values, and dates).
     * Complete Loans & Debts Ledger (exact names of borrowers, lenders, principal amounts, interest rates, repayments made, balances remaining, due dates).
     * Complete Transactions Log (income, expenses, custom user labels like Petrol, Groceries, Rent, amounts, dates).
   - NEVER CLAIM THAT NAMES OR RECORDS ARE NOT STORED. You have every single gift giver, recipient, loan record, and transaction right in your context.
   - When the user asks for a sheet, spreadsheet, table, report, words, summaries, or breakdown (e.g. "generate a sheet of gifts", "table of who gave gifts", "monthly expense report", "debt status sheet", "summary of who gave me gifts"):
     * ALWAYS generate a well-structured, complete **Markdown Table** with clear columns and headers (\`| Col 1 | Col 2 | ... |\`).
     * Gift Table Format:
       | Person | Type | Occasion | Item & Details | Amount (₹) | Date |
     * Debt / Loan Table Format:
       | Person | Type | Principal | Terms | Repaid | Balance | Status | Due Date |
     * Expense Table Format:
       | Date | Category | Label / Description | Type | Amount (₹) |
     * Include summary totals and key insights above or below the table.
     * The app features an automatic one-click "Download Sheet (CSV)" button right on your response card, so keeping your markdown tables clean, complete, and valid allows the user to immediately download them into Excel or Google Sheets.

2. STRICT FINANCIAL DOMAIN SCOPE (OUT-OF-DOMAIN REFUSAL):
   You are EXCLUSIVELY a personal & household finance assistant. You are PROHIBITED from answering non-financial questions, outer world knowledge, international politics (e.g., world leaders, prime ministers, elections), entertainment, sports, celebrity gossip, geography, general trivia, or school homework.
   - If the user asks ANY non-financial question (such as "Who is the prime minister of Australia", "Who won the match", "Tell me about actors/movies", "What is the capital of X"):
     You MUST POLITELY REFUSE and redirect them back to personal finances. DO NOT answer the outer question!
     - English Refusal: "I am Hema, your dedicated household financial companion. I can only assist with personal finances, family budgeting, gold rates, loans, and savings. How can I help you manage your money or budget today?"
     - Telugu Refusal: "క్షమించండి! నేను కేవలం మీ కుటుంబ ఆర్థిక విషయాలు, గృహ బడ్జెట్, బంగారం ధరలు, మరియు పొదుపులకు సంబంధించిన విషయాలలో మాత్రమే సహాయపడగలను. మీ గృహ ఆర్థిక నిర్వహణలో నేను మీకు ఎలా సహాయపడగలను?"
     - Hindi Refusal: "क्षमा करें! मैं केवल पारिवारिक वित्त, घरेलू बजट, सोने के भाव, ऋण और बचत से जुड़े प्रश्नों में आपकी सहायता कर सकती हूँ। मैं आपके पैसों के प्रबंधन या बजट में कैसे मदद करूँ?"

3. NATURAL CONVERSATIONAL FLOW (NO ROBOTIC PREFIXES):
   - DO NOT repeat "Namaste!" or greetings at the start of every message in an ongoing conversation. Greet ONLY on the initial greeting or when greeted.
   - DO NOT prefix answers with formulaic "Topic: [Question]" headers. Dive directly into the answer naturally like a human financial advisor.

4. GREETINGS RULE: When greeted (e.g. "Hi", "Hello", "నమస్కారం", "హలో", "Namaste"), reply in ONLY 1 to 2 warm, friendly sentences. NEVER output unprompted feature lists or tutorials.

5. DIRECT & PURPOSEFUL: For general advisory queries, keep answers punchy and concise (under 100-150 words). HOWEVER, when the user explicitly asks for a sheet, spreadsheet, table, report, full list, breakdown, or detailed summary, provide the COMPLETE table or report with all relevant items without artificial truncation.

6. ACCURATE LIVE BULLION RATES & STRUCTURED FORMATTING:
   - Use bold titles (**Headline**) to organize key facts and bullet points (* Item) for lists.
   - For Gold or Silver rate queries (especially in Tirupati, Andhra Pradesh, or India): ALWAYS quote the EXACT live rates provided in the [LIVE MARKET BULLION RATES] section of your verified context above!
   - NEVER invent or use old pre-2024 rates (such as ₹7,000/g or ₹8,000/g). Current rates in 2026 are ~₹14,765/g for 24K pure gold, ~₹13,535/g for 22K jewellery gold, and ~₹192/g for silver.
   - Always mention making charges (wastage) and 3% GST, plus 6-digit BIS HUID hallmarking advice for buyers.
   - Never output bare asterisks, broken formatting, or walls of dense text.

7. REGULATORY & DISCLAIMER RULE: Keep any SEBI compliance note to a single subtle sentence at the end (e.g. *(Note: For educational household management only)*). Never generate lengthy legal paragraphs.

8. FRAUD & SAFETY GUARDRAIL: If user mentions suspicious doubling schemes or sharing OTPs, warn them sternly to never share OTPs and report to cybercrime.gov.in (Helpline: 1930).

9. INFORMAL VADDI RULE: For informal borrowings (e.g. ₹2 Vaddi = 2% per month / 24% annual), clearly calculate monthly interest and advise clearing high-interest debt first.`;
}

/**
 * Zero-Tolerance Guardrail Auto-Corrector:
 * If an LLM response deviates from the selected language (e.g. outputs Hindi when English was selected),
 * this initiates an instant, single-turn, zero-temperature repair to enforce 100% compliance.
 */
export async function autoCorrectLanguage(
  apiKey: string,
  modelName: string,
  userPrompt: string,
  deviantResponse: string,
  targetLang: string = 'en',
  signal?: AbortSignal
): Promise<string> {
  const targetSpec = targetLang === 'te' 
    ? 'natural, respectful TELUGU script (తెలుగు లిపి)' 
    : targetLang === 'hi' 
    ? 'natural, respectful HINDI Devanagari script (देवनागरी लिपि)' 
    : 'clear, professional standard ENGLISH ONLY (absolutely NO Hindi or Telugu script)';

  try {
    const repairPrompt = `The following financial answer was generated in the wrong language/script.
You MUST translate and format this explanation strictly and exclusively into ${targetSpec}.
Preserve key financial figures, bullet points, and brevity.
Do NOT output any other language.

Explanation to convert:
${deviantResponse}`;

    const repairUrl = `https://generativelanguage.googleapis.com/v1beta/${modelName}:generateContent?key=${apiKey}`;
    const repairPayload = {
      system_instruction: {
        parts: [{ text: `You are a strict financial translator. Output your entire reply exclusively in ${targetSpec}. Zero deviation.` }]
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: repairPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 400
      }
    };

    const res = await fetch(repairUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(repairPayload),
      signal
    });

    if (res.ok) {
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) {
        const check = detectLanguageViolation(text, targetLang);
        if (!check.isViolation) {
          return text;
        }
      }
    }
  } catch (e) {
    console.warn('[Hema AI Guardrail] Auto-correction pass failed:', e);
  }

  // Deterministic local financial engine fallback if network repair fails
  return generateLocalFinancialAdvice(userPrompt, '', targetLang);
}

/**
 * Enterprise Production Query Engine:
 * 1. AbortSignal support for instantaneous cancellation / pause.
 * 2. Multi-Model Automatic Failover on 503 / 429 demand spikes (3.8-flash <-> 3.6-flash <-> 3.1-flash-lite).
 * 3. Chatbot-specific language conditioning (English, Hindi, Telugu) without altering main app UI.
 * 4. Quota-safe execution: Standard queries NEVER consume grounding tools (avoiding 429 quota errors on free-tier keys).
 * 5. Strict SEBI & Fraud Prevention Guardrails.
 * 6. Multi-layer Zero-Tolerance Language Guardrails and Post-Generation Auto-Correction.
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
  const contents = buildStrictGeminiPayload(systemPrompt, prompt, history, chatLanguage);

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

      // Clean standard payload with top-level system_instruction and temperature 0.2
      const cleanPayload = {
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
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
            // Guardrail validation check
            const violation = detectLanguageViolation(fullText, chatLanguage);
            if (violation.isViolation) {
              console.warn(`[Hema AI Guardrail] Language deviation detected on ${currentModel}: ${violation.reason}. Auto-correcting...`);
              return await autoCorrectLanguage(apiKey, currentModel, prompt, fullText, chatLanguage, signal);
            }

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
        continue;
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
 * 3. Real-time language guardrail interception: aborts and auto-corrects rogue script before display.
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
  const contents = buildStrictGeminiPayload(systemPrompt, prompt, history, chatLanguage);
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
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
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
        let driftDetected = false;

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
                    
                    // Real-time script guardrail check
                    const check = detectLanguageViolation(accumulatedText, chatLanguage);
                    if (check.isViolation) {
                      driftDetected = true;
                      console.warn(`[Hema AI Guardrail] Stream language drift detected: ${check.reason}. Intercepting output...`);
                      reader.cancel().catch(() => {});
                      break;
                    }

                    onChunk(accumulatedText);
                  }
                } catch (e) {}
              }
            }
          }

          if (driftDetected) {
            break;
          }
        }

        // If drift occurred during streaming, auto-correct immediately
        if (driftDetected) {
          const corrected = await autoCorrectLanguage(apiKey, currentModel, prompt, accumulatedText, chatLanguage, signal);
          onChunk(corrected);
          return corrected;
        }

        if (accumulatedText.trim()) {
          // Final validation check on accumulated result
          const finalCheck = detectLanguageViolation(accumulatedText.trim(), chatLanguage);
          if (finalCheck.isViolation) {
            console.warn(`[Hema AI Guardrail] Final output language deviation: ${finalCheck.reason}. Auto-correcting...`);
            const corrected = await autoCorrectLanguage(apiKey, currentModel, prompt, accumulatedText.trim(), chatLanguage, signal);
            onChunk(corrected);
            return corrected;
          }
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

function parseGiftsFromRAG(ragContext: string, typeFilter?: 'RECEIVED' | 'GIVEN') {
  const lines = ragContext.split('\n');
  const results: Array<{
    person: string;
    type: string;
    occasion: string;
    item: string;
    amount: string;
    date: string;
  }> = [];

  for (const line of lines) {
    if (line.includes('[RECEIVED FROM]') || line.includes('[GIVEN TO]')) {
      const isReceived = line.includes('[RECEIVED FROM]');
      if (typeFilter === 'RECEIVED' && !isReceived) continue;
      if (typeFilter === 'GIVEN' && isReceived) continue;

      const personMatch = line.match(/Person:\s*"([^"]+)"/);
      const occasionMatch = line.match(/Occasion:\s*([^|]+)/);
      const itemMatch = line.match(/Item:\s*([^|]+)/);
      const amountMatch = line.match(/Amount:\s*([^|]+)/);
      const dateMatch = line.match(/Date:\s*([^|]+)/);

      if (personMatch) {
        results.push({
          person: personMatch[1].trim(),
          type: isReceived ? 'Received' : 'Given',
          occasion: occasionMatch ? occasionMatch[1].trim() : 'Event',
          item: itemMatch ? itemMatch[1].trim() : 'Gift',
          amount: amountMatch ? amountMatch[1].trim() : '₹0',
          date: dateMatch ? dateMatch[1].trim() : 'N/A'
        });
      }
    }
  }
  return results;
}

function parseDebtsFromRAG(ragContext: string) {
  const lines = ragContext.split('\n');
  const results: Array<{
    person: string;
    type: string;
    status: string;
    principal: string;
    repaid: string;
    balance: string;
    terms: string;
    dueDate: string;
  }> = [];

  for (const line of lines) {
    if (line.includes('[WE OWE') || line.includes('[OWED TO US')) {
      const isWeOwe = line.includes('[WE OWE');
      const personMatch = line.match(/Person:\s*"([^"]+)"/);
      const statusMatch = line.match(/Status:\s*([^|]+)/);
      const principalMatch = line.match(/Principal:\s*([^|]+)/);
      const repaidMatch = line.match(/Repaid:\s*([^|]+)/);
      const balanceMatch = line.match(/Balance Remaining:\s*([^|]+)/);
      const termsMatch = line.match(/Terms:\s*([^|]+)/);
      const dueMatch = line.match(/Due Date:\s*([^|]+)/);

      if (personMatch) {
        results.push({
          person: personMatch[1].trim(),
          type: isWeOwe ? 'We Owe' : 'Owed to Us',
          status: statusMatch ? statusMatch[1].trim() : 'PENDING',
          principal: principalMatch ? principalMatch[1].trim() : '₹0',
          repaid: repaidMatch ? repaidMatch[1].trim() : '₹0',
          balance: balanceMatch ? balanceMatch[1].trim() : '₹0',
          terms: termsMatch ? termsMatch[1].trim() : 'None',
          dueDate: dueMatch ? dueMatch[1].trim() : 'N/A'
        });
      }
    }
  }
  return results;
}

function parseTransactionsFromRAG(ragContext: string) {
  const lines = ragContext.split('\n');
  const results: Array<{
    date: string;
    type: string;
    category: string;
    amount: string;
    notes: string;
  }> = [];

  for (const line of lines) {
    if (line.startsWith('• Date:') && line.includes('| Type:')) {
      const dateMatch = line.match(/Date:\s*([^|]+)/);
      const typeMatch = line.match(/Type:\s*([^|]+)/);
      const catMatch = line.match(/Category:\s*([^|]+)/);
      const amountMatch = line.match(/Amount:\s*([^|]+)/);
      const notesMatch = line.match(/Notes:\s*(.+)$/);

      if (dateMatch && amountMatch) {
        results.push({
          date: dateMatch[1].trim(),
          type: typeMatch ? typeMatch[1].trim() : 'EXPENSE',
          category: catMatch ? catMatch[1].trim() : 'General',
          amount: amountMatch[1].trim(),
          notes: notesMatch ? notesMatch[1].trim() : ''
        });
      }
    }
  }
  return results;
}

/**
 * Intelligent Local Ledger-Aware Fallback Engine
 * 100% deterministic, human-crafted financial wisdom in English, Hindi, and Telugu.
 */
export function generateLocalFinancialAdvice(query: string, ragContext: string = '', chatLanguage: string = 'en'): string {
  const q = query.toLowerCase();
  const isTe = chatLanguage.startsWith('te');
  const isHi = chatLanguage.startsWith('hi');

  // 1. Gift & Shagun registry inquiries (who gave gifts, gift givers, gift sheet, gift table)
  const isGiftQuery = q.includes('gift') || q.includes('shagun') || q.includes('wedding') || q.includes('చదివింపు') || q.includes('శగున్') || q.includes('उपहार');
  const isSheetOrListOrWho = q.includes('who') || q.includes('giver') || q.includes('taker') || q.includes('name') || q.includes('sheet') || q.includes('table') || q.includes('list') || q.includes('report') || q.includes('summary') || q.includes('ఎవరు') || q.includes('ఎవరికి') || q.includes('ఎవరు ఇచ్చారు') || q.includes('किसने');

  if (isGiftQuery && isSheetOrListOrWho) {
    const filter = (q.includes('given to') || q.includes('we gave') || q.includes('ఇచ్చిన') || q.includes('दिए')) ? 'GIVEN' : (q.includes('who gave') || q.includes('received') || q.includes('వచ్చిన') || q.includes('మిలే')) ? 'RECEIVED' : undefined;
    const gifts = parseGiftsFromRAG(ragContext, filter);
    if (gifts.length > 0) {
      if (isTe) {
        const rows = gifts.map(g => `| **${g.person}** | ${g.type === 'Received' ? 'వచ్చినవి' : 'ఇచ్చినవి'} | ${g.occasion} | ${g.item} | ${g.amount} | ${g.date} |`).join('\n');
        return `🎁 **గృహ చదివింపులు & బహుమతుల వివరాల షీట్:**\n\n| పేరు | రకం | సందర్భం | కానుక వివరాలు | విలువ | తేదీ |\n|:---|:---:|:---|:---|---:|:---:|\n${rows}\n\n*(గమనిక: పైనున్న **"Download Sheet (CSV)"** బటన్ క్లిక్ చేసి ఈ షీట్‌ను నేరుగా డౌన్‌లోడ్ చేసుకోవచ్చు).*`;
      }
      if (isHi) {
        const rows = gifts.map(g => `| **${g.person}** | ${g.type === 'Received' ? 'मिला' : 'दिया'} | ${g.occasion} | ${g.item} | ${g.amount} | ${g.date} |`).join('\n');
        return `🎁 **घरेलू उपहार एवं शगुन विवरण शीट:**\n\n| व्यक्ति | प्रकार | अवसर | उपहार विवरण | राशि | दिनांक |\n|:---|:---:|:---|:---|---:|:---:|\n${rows}\n\n*(सुझाव: ऊपर दिए गए **"Download Sheet (CSV)"** बटन से इसे सीधे एक्सेल शीट के रूप में डाउनलोड कर सकते हैं).*`;
      }
      const rows = gifts.map(g => `| **${g.person}** | ${g.type} | ${g.occasion} | ${g.item} | ${g.amount} | ${g.date} |`).join('\n');
      return `🎁 **Household Gift Registry Sheet (Gift Givers & Receivers):**\n\n| Person | Type | Occasion | Item & Details | Amount | Date |\n|:---|:---:|:---|:---|---:|:---:|\n${rows}\n\n*(Tip: Tap the **"Download Sheet (CSV)"** button above to export this directly to your phone as an Excel-compatible spreadsheet).*`;
    }
  }

  // 2. Debt / Loan queries (who owes us, who we owe, loan sheet, debt table)
  const isDebtQuery = q.includes('debt') || q.includes('loan') || q.includes('owe') || q.includes('vaddi') || q.includes('interest') || q.includes('అప్పు') || q.includes('వడ్డీ') || q.includes('కర్జ్') || q.includes('उधार');
  if (isDebtQuery && isSheetOrListOrWho) {
    const debts = parseDebtsFromRAG(ragContext);
    if (debts.length > 0) {
      if (isTe) {
        const rows = debts.map(d => `| **${d.person}** | ${d.type === 'We Owe' ? 'మనం ఇవ్వాలి' : 'మనకు రావాలి'} | ${d.principal} | ${d.terms} | ${d.repaid} | ${d.balance} | ${d.status} | ${d.dueDate} |`).join('\n');
        return `📊 **అప్పులు & లోన్ల వివరాల షీట్:**\n\n| వ్యక్తి | రకం | అసలు | షరతులు | చెల్లించినది | బ్యాలెన్స్ | స్థితి | గడువు తేదీ |\n|:---|:---:|---:|:---:|---:|---:|:---:|:---:|\n${rows}\n\n*(గమనిక: పైనున్న **"Download Sheet (CSV)"** బటన్ ద్వారా ఎక్సెల్ షీట్ డౌన్‌లోడ్ చేసుకోండి).*`;
      }
      if (isHi) {
        const rows = debts.map(d => `| **${d.person}** | ${d.type === 'We Owe' ? 'देना है' : 'लेना है'} | ${d.principal} | ${d.terms} | ${d.repaid} | ${d.balance} | ${d.status} | ${d.dueDate} |`).join('\n');
        return `📊 **घरेलू ऋण एवं उधारी विवरण शीट:**\n\n| व्यक्ति | प्रकार | मूलधन | ब्याज शर्तें | चुकाया | शेष बकाया | स्थिति | देय तिथि |\n|:---|:---:|---:|:---:|---:|---:|:---:|:---:|\n${rows}\n\n*(सुझाव: ऊपर दिए गए **"Download Sheet (CSV)"** बटन से इसे सीधे एक्सेल शीट के रूप में डाउनलोड कर सकते हैं).*`;
      }
      const rows = debts.map(d => `| **${d.person}** | ${d.type} | ${d.principal} | ${d.terms} | ${d.repaid} | ${d.balance} | ${d.status} | ${d.dueDate} |`).join('\n');
      return `📊 **Household Loans & Debts Sheet:**\n\n| Person | Type | Principal | Terms | Repaid | Balance | Status | Due Date |\n|:---|:---:|---:|:---:|---:|---:|:---:|:---:|\n${rows}\n\n*(Tip: Tap the **"Download Sheet (CSV)"** button above to export this directly to your phone as an Excel-compatible spreadsheet).*`;
    }
  }

  // 3. Transactions / Expense report queries
  const isTxQuery = (q.includes('expense') || q.includes('spend') || q.includes('transaction') || q.includes('ఖర్చు') || q.includes('खर्च')) && (q.includes('sheet') || q.includes('table') || q.includes('report') || q.includes('list') || q.includes('summary'));
  if (isTxQuery) {
    const txs = parseTransactionsFromRAG(ragContext);
    if (txs.length > 0) {
      const rows = txs.slice(0, 20).map(t => `| ${t.date} | ${t.type} | ${t.category} | ${t.amount} | ${t.notes || '-'} |`).join('\n');
      return `📑 **Household Expenses & Transactions Log:**\n\n| Date | Type | Category | Amount | Notes |\n|:---:|:---:|:---|---:|:---|\n${rows}\n\n*(Tip: Tap the **"Download Sheet (CSV)"** button above to export this spreadsheet).*`;
    }
  }

  // IPO, Stocks & Shares
  if (q.includes('ipo') || q.includes('share') || q.includes('stock') || q.includes('market') || q.includes('సెక్యూరిటీలు') || q.includes('షేర్లు') || q.includes('शेयर')) {
    if (isTe) {
      return `📈 **IPO (ఇనీషియల్ పబ్లిక్ ఆఫరింగ్) గృహ మార్గదర్శకం:**
• ఒక ప్రైవేట్ కంపెనీ వ్యాపార విస్తరణ కోసం మొదటిసారిగా స్టాక్ మార్కెట్లో సాధారణ ప్రజలకు షేర్లను విక్రయించడాన్ని **IPO** అంటారు.
• **ముఖ్యమైన అంశాలు:** దరఖాస్తు చేసే ముందు కంపెనీ గత 3-5 ఏళ్ల లాభాలు, ప్రమోటర్ల చరిత్ర (RHP) తప్పక పరిశీలించండి.
• **షేర్ల కేటాయింపు:** అధికంగా దరఖాస్తులు వచ్చినప్పుడు కంప్యూటర్ లాటరీ పద్ధతి ద్వారా షేర్లు కేటాయించబడతాయి.
• **జాగ్రత్త:** అత్యవసర నిధిని మినహాయించి, మిగులు పొదుపు మొత్తాన్ని మాత్రమే పెట్టుబడి పెట్టండి.
*(గమనిక: ఇది కేవలం విద్యాసంబంధిత గృహ ఆర్థిక నిర్వహణ కోసం మాత్రమే).*`;
    }
    if (isHi) {
      return `📈 **IPO (आरंभिक सार्वजनिक पेशकश) गाइड:**
• **IPO** तब होता है जब कोई निजी कंपनी पूंजी जुटाने के लिए पहली बार शेयर बाज़ार (NSE/BSE) में आम जनता के लिए शेयर पेश करती है।
• **मुख्य बातें:**
  * **कंपनी का ट्रैक रिकॉर्ड:** आवेदन करने से पहले कंपनी का रेड हेरिंग प्रॉस्पेक्टस (RHP) और मुनाफ़ा ज़रूर देखें।
  * **आवंटन:** अत्यधिक आवेदन होने पर लॉटरी सिस्टम द्वारा शेयर आवंटित किए जाते हैं।
  * **सुरक्षा:** आपातकालीन फंड को छुए बिना केवल अतिरिक्त बचत का ही निवेश करें।
*(नोट: यह जानकारी केवल शैक्षिक घरेलू वित्तीय प्रबंधन के लिए है!)*`;
    }
    return `📈 **IPO (Initial Public Offering) Guide:**
• An **IPO** occurs when an unlisted company sells shares to the public for the first time to raise capital and list on the stock exchange (NSE/BSE).
• **Key Considerations:**
  * **Fundamentals:** Review the company's Red Herring Prospectus (RHP), promoter integrity, and 3-5 year profit growth.
  * **Allotment:** In case of oversubscription, shares are allotted via an automated computerized lottery.
  * **Prudence:** Never invest borrowed money; invest only surplus savings after securing your family emergency fund.
*(Note: For educational household financial management only).*`;
  }

  // Fixed Deposits (FD)
  if (q.includes('fd') || q.includes('fixed deposit') || q.includes('డిపాజిట్') || q.includes('ఫిక్స్డ్') || q.includes('फिक्स्ड')) {
    if (isTe) {
      return `🏦 **గృహ ఫిక్స్‌డ్ డిపాజిట్ (FD) మార్గదర్శకం:**
• **FD** అనేది మార్కెట్ హెచ్చుతగ్గులతో సంబంధం లేకుండా స్థిరమైన, హామీతో కూడిన వడ్డీని అందించే అత్యంత సురక్షితమైన సాధనం.
• **సీనియర్ సిటిజన్ల ప్రయోజనం:** 60 ఏళ్లు పైబడిన పెద్దలకు బ్యాంకులు అదనంగా 0.50% ఎక్కువ వడ్డీని చెల్లిస్తాయి.
• **అత్యవసర సౌలభ్యం:** అవసరమైనప్పుడు FD పై 90% వరకు లోన్ తీసుకోవచ్చు లేదా స్వల్ప పెనాల్టీతో ముందే విత్‌డ్రా చేసుకోవచ్చు.
*(గమనిక: ఇది కేవలం విద్యాసంబంధిత గృహ ఆర్థిక నిర్వహణ కోసం మాత్రమే).*`;
    }
    if (isHi) {
      return `🏦 **पारिवारिक फिक्स्ड डिपॉजिट (FD) गाइड:**
• **FD** बाज़ार के उतार-चढ़ाव से परे एक निश्चित अवधि के लिए सुरक्षित और गारंटीड रिटर्न प्रदान करता है।
• **वरिष्ठ नागरिक लाभ:** भारतीय बैंक वरिष्ठ नागरिकों (60 वर्ष से अधिक) को 0.50% अतिरिक्त ब्याज प्रदान करते हैं।
• **आपातकालीन नकदी:** जरूरत पड़ने पर आप अपनी FD पर 90% तक ऋण ले सकते हैं या मामूली शुल्क देकर समय से पहले तोड़ सकते हैं।
*(नोट: यह जानकारी केवल शैक्षिक घरेलू वित्तीय प्रबंधन के लिए है!)*`;
    }
    return `🏦 **Fixed Deposit (FD) Guide for Families:**
• An **FD (Fixed Deposit)** is a safe financial tool where you deposit a lump sum with a bank for a fixed tenure at a guaranteed interest rate.
• **Key Features:**
  * **Guaranteed Returns:** Rate remains fixed regardless of market fluctuations.
  * **Senior Citizens:** Banks typically provide an extra 0.50% interest for adults aged 60+.
  * **Liquidity:** You can withdraw prematurely with a minor penalty, or take a loan up to 90% against your FD.
*(Note: For educational household management only).*`;
  }

  // Mutual Funds & SIP
  if (q.includes('sip') || q.includes('mutual fund') || q.includes('మ్యూచువల్') || q.includes('సిప్') || q.includes('म्यूचुअल')) {
    if (isTe) {
      return `📊 **మ్యూచువల్ ఫండ్ SIP మార్గదర్శకం:**
• **SIP (సిస్టమాటిక్ ఇన్వెస్ట్‌మెంట్ ప్లాన్):** ప్రతి నెలా చిన్న మొత్తంతో (ఉదా. ₹500 - ₹2,000) దీర్ఘకాలిక సంపద సృష్టించడానికి ఇది ఉత్తమ మార్గం.
• **రూపీ కాస్ట్ యావరేజింగ్:** మార్కెట్ హెచ్చుతగ్గుల ప్రభావం తగ్గి సగటు ధర స్థిరపడుతుంది.
• **గమనిక:** పిల్లల చదువు లేదా వివాహాల వంటి 5+ సంవత్సరాల లక్ష్యాలకు ఇండెక్స్ లేదా లార్జ్ క్యాప్ ఫండ్లను ఎంచుకోండి.`;
    }
    if (isHi) {
      return `📊 **म्यूचुअल फंड SIP गाइड:**
• **SIP (सिस्टमैटिक इन्वेस्टमेंट प्लान):** हर महीने छोटी बचत (जैसे ₹500 - ₹2,000) को अनुशासित तरीके से निवेश करने का सबसे सरल माध्यम है।
• **रुपया लागत औसत:** बाज़ार के उतार-चढ़ाव में जोखिम को संतुलित रखता है।
• **लक्ष्य आधारित:** 5 वर्ष से अधिक के बच्चों की शिक्षा या पारिवारिक लक्ष्यों के लिए इंडेक्स फंड चुनें।`;
    }
    return `📊 **Mutual Fund SIP Guide for Families:**
• A **SIP (Systematic Investment Plan)** allows disciplined monthly investing (e.g. ₹500 - ₹5,000) into diversified funds.
• **Rupee Cost Averaging:** Lowers average purchase price during market dips.
• **Goal Planning:** Ideal for long-term targets (5+ years) like child education or retirement.`;
  }

  // Gold & Bullion Rates & Ornaments
  if (q.includes('gold') || q.includes('sohna') || q.includes('ornament') || q.includes('carat') || q.includes('బంగారం') || q.includes('సోనా') || q.includes('వెండి') || q.includes('silver')) {
    // Return verified real-time bullion rates if user asks for prices, rates, or today's cost
    if (q.includes('rate') || q.includes('price') || q.includes('cost') || q.includes('today') || q.includes('ధర') || q.includes('రేటు') || q.includes('భావం') || q.includes('भाव') || q.includes('tirupati') || q.includes('తిరుపతి')) {
      const liveBenchmark = {
        updatedAt: new Date().toISOString(),
        dateStr: new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }),
        rate24kPerGram: 14765,
        rate22kPerGram: 13535,
        rate18kPerGram: 11074,
        silverPerGram: 192,
        city: 'Tirupati (తిరుపతి)',
        state: 'Andhra Pradesh',
        gstPercent: 3,
        wastageRange: '8% - 14%'
      };
      return formatGoldRatesSummary(liveBenchmark, chatLanguage);
    }

    if (isTe) {
      return `🪙 **భారతీయ గృహాలకు బంగారు మార్గదర్శకం:**
• సాంప్రదాయకంగా భౌతిక 22K/24K బంగారం ద్రవ్యోల్బణానికి రక్షణగా మరియు అత్యవసర ఆస్తిగా పనిచేస్తుంది.
• నగల కొనుగోలులో తయారీ ఖర్చులు (తరుగు/Wastage 8% - 14%) మరియు 3% జీఎస్టీ పరిశీలించండి.
• తరుగు లేకుండా స్వచ్ఛమైన పొదుపు కోసం సావరిన్ గోల్డ్ బాండ్లు (SGB) లేదా గోల్డ్ ఈటీఎఫ్ లు ఉత్తమం.
*(గమనిక: ఇది కేవలం విద్యా ప్రయోజనాల కొరకు మాత్రమే).*`;
    }
    if (isHi) {
      return `🪙 **भारतीय परिवारों के लिए स्वर्ण मार्गदर्शन:**
• भौतिक 22K/24K सोना मुद्रास्फीति और आपातकालीन सुरक्षा के लिए बेहतरीन माना जाता है।
• आभूषण खरीदते समय मेकिंग चार्ज (8% - 14%) और 3% जीएसटी का ध्यान रखें।
• शुद्ध निवेश हेतु सॉवरेन गोल्ड बॉन्ड (SGB) या गोल्ड ETF बेहतर विकल्प हैं।
*(नोट: केवल शैक्षिक मार्गदर्शन हेतु).*`;
    }
    return `🪙 **Gold Guidance for Indian Households:**
• Historically, physical 22K/24K gold serves as an inflation hedge and emergency collateral in India.
• When buying gold ornaments, keep making charges (wastage usually 8% - 14%) and 3% GST in mind.
• For pure investment without making charges, Sovereign Gold Bonds (SGB) or Gold ETFs offer higher net returns.
*(Note: For educational household management only).*`;
  }

  // Informal Vaddi & Debt
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

  // Budgeting & Expenses
  if (q.includes('spend') || q.includes('expense') || q.includes('budget') || q.includes('saving') || q.includes('ఖర్చు') || q.includes('పొదుపు')) {
    if (isTe) {
      return `💡 **గృహ బడ్జెట్ 50-30-20 నియమం:**
• **50% నిత్యావసరాలు:** కిరాణా, విద్యుత్/నీటి బిల్లులు, పిల్లల ఫీజులు, పాలు, మందులు.
• **30% కోరికలు:** బట్టలు, కుటుంబ విహారాలు, రెస్టారెంట్ ఖర్చులు.
• **20% పొదుపు:** ఫిక్స్‌డ్ డిపాజిట్లు లేదా అత్యవసర నిధి.
• రోజువారీ ఖర్చులను ఎప్పటికప్పుడు Expenses ట్యాబ్‌లో రికార్డ్ చేయండి.`;
    }
    if (isHi) {
      return `💡 **घरेलू बजट का 50-30-20 नियम:**
• **50% बुनियादी जरूरतें:** राशन/किराना, बिजली-पानी बिल, बच्चों की फीस, दवाइयां।
• **30% ऐच्छिक खर्च:** कपड़े, पारिवारिक सैर-सपाटा, बाहर का खाना।
• **20% सुरक्षित बचत:** फिक्स्ड डिपॉजिट या इमरजेंसी फंड।
• हर छोटे-बड़े खर्च को खर्च रजिस्टर में नियमित दर्ज करें।`;
    }
    return `💡 **Household 50-30-20 Rule for Families:**
• **50% Essentials:** Kirana/Groceries, Electricity/Water, School fees, Milk, Medicine.
• **30% Discretionary:** Family dinners, clothes, shopping.
• **20% Emergency & Savings:** Kept in Fixed Deposits or Liquid Mutual Funds.
• Track everyday cash expenses immediately in the Expenses tab to avoid month-end cash leaks.`;
  }

  // Gifts & Shagun
  if (q.includes('gift') || q.includes('shagun') || q.includes('wedding') || q.includes('శుభకార్యం') || q.includes('చదివింపులు')) {
    if (isTe) {
      return `🎁 **శుభకార్యాల చదివింపులు & బహుమతుల మర్యాద:**
• మన సంస్కృతిలో చదివింపులను శుభప్రదంగా +₹1 తో (ఉదా. ₹501, ₹1,116, ₹2,101) ఇవ్వడం ఆచారం.
• ఏదైనా ఫంక్షన్‌కు వెళ్లేముందు Gifts ట్యాబ్‌లో ఆ వ్యక్తి పేరు చూసి, గతంలో వారు ఇచ్చిన దానికి తగినట్లుగా మర్యాద చేయండి.`;
    }
    if (isHi) {
      return `🎁 **शगुन एवं उपहार परंपरा:**
• भारतीय संस्कृति में शगुन की राशि +₹1 जोड़कर (जैसे ₹501, ₹1,101, ₹2,101) निरंतर समृद्धि के आशीर्वाद के रूप में दी जाती है।
• किसी भी समारोह में जाने से पहले गिफ्ट लेजर में उनका पिछला लेनदेन देखकर यथोचित सम्मान लौटाएं।`;
    }
    return `🎁 **Shagun & Gift Etiquette:**
• In Indian culture, Shagun amounts traditionally end with +₹1 (e.g., ₹501, ₹1,116, ₹2,101) as a blessing for continuous prosperity.
• Check the Gift Ledger under the person's name before attending a function to reciprocate honorably based on past exchanges.`;
  }

  // Greetings
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
