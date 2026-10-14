import React, { useState, useEffect, useRef } from 'react';
import { Bot, Send, AlertTriangle, Mic, Sparkles, Key, Check, X, ExternalLink, Square, Languages, RefreshCw, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { 
  queryGemini, 
  queryGeminiStream,
  getGeminiApiKey, 
  setGeminiApiKey, 
  testGeminiConnection, 
  clearGeminiCache, 
  getActiveModelName, 
  getActiveModelShortName,
  setActiveModelName, 
  fetchAvailableModels, 
  AvailableModel, 
  ChatMessage,
  FREE_TIER_MODELS
} from '@/lib/gemini';

const CHAT_HISTORY_STORAGE_KEY = 'hema_assistant_chat_history';

const getInitialGreeting = (lang: string): string => {
  if (lang === 'te') {
    return 'నమస్కారం! నేను మీ హేమ (Hema) కుటుంబ ఆర్థిక సహాయకురాలిని. మీ గృహ బడ్జెట్, బంగారం రేట్లు, ₹2 వడ్డీ లెక్కలు లేదా పొదుపు గురించి ఏదైనా అడగండి.';
  }
  if (lang === 'hi') {
    return 'नमस्ते! मैं आपकी पारिवारिक वित्तीय सहायक हेमा (Hema) हूँ। आप मुझसे घरेलू बजट, सोने के भाव, ₹2 ब्याज या बचत के बारे में कुछ भी पूछ सकते हैं।';
  }
  return 'Namaste! I am Hema, your household financial companion. Ask me anything about your family budget, Gold investments, Vaddi interest calculations, or household tax planning.';
};

const Assistant: React.FC = () => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport, setText: setVoiceText } = useSpeechToText();

  // Chatbot-specific language selection (independent of global app UI language)
  const [chatLanguage, setChatLanguage] = useState<'en' | 'hi' | 'te'>(() => {
    return (localStorage.getItem('hema_assistant_chat_language') as 'en' | 'hi' | 'te') || 'en';
  });

  const [input, setInput] = useState('');
  
  // Persisted chat history across tabs and app navigation
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}

    const lang = localStorage.getItem('hema_assistant_chat_language') || 'en';
    return [{ role: 'assistant', text: getInitialGreeting(lang) }];
  });
  const [isTyping, setIsTyping] = useState(false);

  // Auto-persist messages whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  // AbortController ref for instantaneous generation cancellation
  const abortControllerRef = useRef<AbortController | null>(null);

  // Gemini Key Modal & Connection Test State
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getGeminiApiKey());
  const [hasApiKey, setHasApiKey] = useState(!!getGeminiApiKey());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>(FREE_TIER_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(getActiveModelName());

  // Chatbot response languages
  const chatLanguages = [
    { code: 'en' as const, label: 'English', short: 'EN' },
    { code: 'hi' as const, label: 'हिन्दी', short: 'HI' },
    { code: 'te' as const, label: 'తెలుగు', short: 'TE' },
  ];

  // Sync voice input with text input
  useEffect(() => {
    if (voiceText) {
      setInput(voiceText);
    }
  }, [voiceText]);

  // Keep selectedModel synced with storage on mount
  useEffect(() => {
    setSelectedModel(getActiveModelName());
  }, []);

  const handleLanguageSelect = (code: 'en' | 'hi' | 'te') => {
    setChatLanguage(code);
    localStorage.setItem('hema_assistant_chat_language', code);
    // Explicitly do NOT change the global app i18n language, preserving the main app's layout
  };

  const handleClearChat = () => {
    if (window.confirm('Clear chat history and start fresh?')) {
      const reset = [{ role: 'assistant' as const, text: getInitialGreeting(chatLanguage) }];
      setMessages(reset);
      try {
        localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(reset));
      } catch (e) {}
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim();
    if (!textToSend || isTyping) return;

    const userMsg: ChatMessage = { role: 'user', text: textToSend };
    const emptyAssistantMsg: ChatMessage = { role: 'assistant', text: '' };
    const historySnapshot = [...messages, userMsg];
    const assistantMsgIndex = historySnapshot.length;

    setMessages([...historySnapshot, emptyAssistantMsg]);
    setInput('');
    setVoiceText('');
    setIsTyping(true);

    // Initialize AbortController for cancel / stop capability
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      let streamedBuffer = '';
      const finalResponse = await queryGeminiStream(
        textToSend, 
        historySnapshot, 
        (chunkText) => {
          streamedBuffer = chunkText;
          setMessages(prev => {
            const copy = [...prev];
            if (copy[assistantMsgIndex]) {
              copy[assistantMsgIndex] = { role: 'assistant', text: chunkText };
            }
            return copy;
          });
        },
        controller.signal, 
        chatLanguage
      );

      // If streaming wasn't supported, use final response
      if (!streamedBuffer && finalResponse) {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex]) {
            copy[assistantMsgIndex] = { role: 'assistant', text: finalResponse };
          }
          return copy;
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || controller.signal.aborted) {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex] && !copy[assistantMsgIndex].text) {
            copy[assistantMsgIndex] = { role: 'assistant', text: '⏹ Response stopped by user.' };
          }
          return copy;
        });
      } else {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex]) {
            copy[assistantMsgIndex] = { role: 'assistant', text: 'I encountered an issue processing that. Please try again.' };
          }
          return copy;
        });
      }
    } finally {
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTyping(false);
  };

  const handleOpenSettingsModal = async () => {
    setTestResult(null);
    setShowKeyModal(true);
    const currentModel = getActiveModelName();
    setSelectedModel(currentModel);
    const models = await fetchAvailableModels(apiKeyInput.trim());
    setAvailableModels(models);
  };

  const handleSaveApiKey = () => {
    const cleanKey = apiKeyInput.trim();
    setGeminiApiKey(cleanKey);
    if (selectedModel) {
      setActiveModelName(selectedModel);
    }
    setHasApiKey(!!cleanKey);
    setShowKeyModal(false);
  };

  const quickPrompts = chatLanguage === 'te' ? [
    { label: '🪙 బంగారం ధర & పెట్టుబడి సలహా', query: 'భారతీయ గృహాలకు బంగారం vs ఫిక్స్‌డ్ డిపాజిట్ పొదుపు గురించి వివరించండి.' },
    { label: '📊 ₹2 రూపాయల వడ్డీ లెక్కింపు', query: '₹50,000 అప్పుకు నెలకు ₹2 వడ్డీ లెక్కన 6 నెలలకు ఎంత అవుతుంది?' },
    { label: '💰 నా ఖర్చులు & బడ్జెట్ బ్యాలెన్స్', query: 'నా రికార్డు చేసిన ఆదాయం, ఖర్చులు మరియు అప్పుల ఆధారంగా నా ప్రస్తుత నికర బ్యాలెన్స్ ఎంత?' },
    { label: '🎁 శుభకార్యాల చదివింపుల మర్యాద', query: 'తెలుగు సాంప్రదాయ వివాహాలలో చదివింపులు, బహుమతుల ఆచారం మరియు మర్యాద ఏమిటి?' }
  ] : chatLanguage === 'hi' ? [
    { label: '🪙 सोने में निवेश और मार्गदर्शन', query: 'भारतीय परिवारों के लिए सोने में बचत बनाम बैंक एफडी की तुलना समझाएं।' },
    { label: '📊 ₹2 ब्याज की सटीक गणना', query: '₹50,000 की राशि पर 2% प्रति माह ब्याज की दर से 6 महीने का कुल कितना बनेगा?' },
    { label: '💰 मेरे बजट और खर्चों का विवरण', query: 'मेरी आय, खर्च और कर्जों के अनुसार मेरा वर्तमान वित्तीय विवरण क्या है?' },
    { label: '🎁 शगुन के नियम और परंपरा', query: 'पारंपरिक भारतीय शादी और शुभ कार्यों में शगुन देने और निभाने की परंपरा क्या है?' }
  ] : [
    { label: '🪙 Gold vs FD Investment Guide', query: 'Explain physical gold vs sovereign gold bonds vs Fixed Deposits for Indian families.' },
    { label: '📊 Calculate ₹2 Monthly Vaddi', query: 'How does informal ₹2 monthly Vaddi interest work for ₹50,000 borrowed for 6 months?' },
    { label: '💰 Check My Ledger Balance', query: 'Based on my recorded income, expenses, and debts, what is my current net financial status?' },
    { label: '🎁 Traditional Shagun Etiquette', query: 'What is the traditional etiquette for reciprocal Shagun gifts at Indian family events?' }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2">
      
      {/* ================= 1. CHATBOT RESPONSE LANGUAGE SLIDER (BOT-ONLY) ================= */}
      <div className="flex items-center justify-between bg-white border border-primary-100 p-1.5 rounded-2xl mb-1.5 shadow-xs shrink-0">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-primary-950 pl-2">
          <Languages size={15} className="text-primary-600" />
          <span className="text-[11px] font-semibold text-textMuted uppercase tracking-wider">AI Chatbot Language:</span>
        </div>
        <div className="flex items-center space-x-1 bg-primary-50/70 p-0.5 rounded-xl border border-primary-200/50">
          {chatLanguages.map(lang => {
            const isActive = chatLanguage === lang.code;
            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleLanguageSelect(lang.code)}
                className={cn(
                  "px-3 py-1 rounded-lg text-xs font-extrabold transition-all flex items-center space-x-1",
                  isActive
                    ? "bg-primary-600 text-white shadow-xs"
                    : "text-textMuted hover:text-textMain hover:bg-white/60"
                )}
                title={`Translate chatbot answers into ${lang.label}`}
              >
                <span>{lang.short}</span>
                <span className="text-[10px] opacity-85 font-normal">({lang.label})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ================= 2. TOP BANNER & GEMINI STATUS PILL ================= */}
      <div className="flex items-center justify-between bg-primary-50 border border-primary-200 px-3.5 py-2 rounded-xl mb-2 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-semibold text-primary-950">
          <Sparkles size={15} className="text-primary-600" />
          <span>Hema AI Engine</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${hasApiKey ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
            {hasApiKey ? getActiveModelShortName() : 'Local AI'}
          </span>
          <span className="text-[10px] bg-primary-200/80 text-primary-900 font-extrabold px-1.5 py-0.5 rounded-md">
            v1.7
          </span>
        </div>
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={handleClearChat}
            className="flex items-center space-x-1 text-[11px] font-bold text-textMuted hover:text-red-600 bg-white px-2 py-1 rounded-lg border border-primary-200 shadow-2xs transition-colors"
            title="Clear conversation history"
          >
            <Trash2 size={11} />
            <span className="hidden xs:inline">Clear</span>
          </button>
          <button
            type="button"
            onClick={handleOpenSettingsModal}
            className="flex items-center space-x-1 text-[11px] font-bold text-primary-700 hover:text-primary-800 bg-white px-2.5 py-1 rounded-lg border border-primary-200 shadow-xs"
          >
            <Key size={12} />
            <span>{hasApiKey ? 'Change Key / Model' : 'Connect Gemini'}</span>
          </button>
        </div>
      </div>

      {/* ================= 3. SEBI COMPLIANCE BANNER ================= */}
      <div className="bg-amber-50/80 border border-amber-200 text-amber-900 px-3.5 py-1.5 rounded-xl flex items-start space-x-2.5 mb-2 shadow-xs shrink-0">
        <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700" />
        <p className="text-[10px] leading-relaxed text-amber-950">
          {t('assistant.compliance')}
        </p>
      </div>

      {/* ================= 4. CHAT HISTORY ================= */}
      <div className="flex-1 overflow-y-auto space-y-3 pb-3 px-1 scrollbar-hide">
        {messages.length === 1 && (
          <div className="p-3 bg-primary-50/50 rounded-2xl border border-primary-100 mb-2">
            <p className="text-xs font-bold text-primary-900 mb-2 flex items-center">
              <Sparkles size={13} className="mr-1 text-primary-600" />
              Suggested Queries:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {quickPrompts.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(qp.query)}
                  className="text-left text-[11px] p-2 bg-white rounded-xl border border-primary-200/60 hover:border-primary-400 text-textMain hover:text-primary-700 transition-colors shadow-2xs"
                >
                  {qp.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn(
            "flex w-full",
            msg.role === 'user' ? "justify-end" : "justify-start"
          )}>
            <div className={cn(
              "max-w-[85%] rounded-2xl p-3.5 text-xs sm:text-sm leading-relaxed shadow-xs whitespace-pre-line",
              msg.role === 'user' 
                ? "bg-primary-600 text-white rounded-br-none font-medium" 
                : "bg-surface border border-borderLight text-textMain rounded-bl-none"
            )}>
              {msg.role === 'assistant' && (
                <div className="flex items-center text-[10px] font-bold text-primary-700 uppercase tracking-wider mb-1">
                  <Sparkles size={11} className="mr-1 text-primary-600" />
                  Hema AI ({chatLanguage.toUpperCase()})
                </div>
              )}
              {msg.text}
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="flex w-full justify-start">
            <div className="bg-surface border border-borderLight text-textMain rounded-2xl rounded-bl-none p-3.5 shadow-xs">
              <div className="flex items-center space-x-1.5">
                <span className="text-xs text-textMuted font-medium mr-1">Hema is formulating response</span>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce" style={{ animationDelay: '0.3s' }}></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ================= 5. FLOATING STOP GENERATION BUTTON ================= */}
      {isTyping && (
        <div className="flex justify-center mb-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center space-x-1.5 px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Square size={12} className="fill-white" />
            <span>Stop Generating</span>
          </button>
        </div>
      )}

      {/* ================= 6. INPUT AREA ================= */}
      <div className="pt-1 shrink-0 bg-background">
        <div className="flex items-center space-x-2">
          {hasSupport && (
            <button 
              type="button"
              onClick={startListening}
              className={cn(
                "p-3 border rounded-full shadow-xs active:scale-95 transition-colors",
                isListening ? "bg-red-100 border-red-200 text-red-600 animate-pulse" : "bg-surface border-borderLight text-primary-600"
              )}
              title="Speak in your language"
            >
              <Mic size={18} />
            </button>
          )}
          <div className="flex-1 relative">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t('assistant.placeholder')}
              className="w-full bg-surface border border-borderLight rounded-full py-3 pl-4 pr-12 text-xs sm:text-sm focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 shadow-xs"
            />
            {isTyping ? (
              <button 
                type="button"
                onClick={handleStop}
                className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors flex items-center justify-center shadow-xs"
                title="Stop Generating"
              >
                <Square size={13} className="fill-white" />
              </button>
            ) : (
              <button 
                type="button"
                onClick={() => handleSend()}
                disabled={!input.trim()}
                className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-40 transition-colors flex items-center justify-center shadow-xs"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ================= 7. MODAL: GEMINI API KEY & MODEL SETTINGS ================= */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 border border-borderLight">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                  <Key size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-textMain text-sm">Google Gemini AI Engine</h3>
                  <p className="text-[11px] text-textMuted">Free Tier & Ledger Grounding</p>
                </div>
              </div>
              <button onClick={() => setShowKeyModal(false)} className="text-textMuted hover:text-textMain p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              <p className="text-xs text-textMuted leading-relaxed">
                Connect your Google Gemini API key to enable live, conversational intelligence grounded in your household finances.
              </p>

              <div>
                <label className="text-xs font-semibold text-textMuted">Gemini API Key</label>
                <input 
                  type="password"
                  value={apiKeyInput}
                  onChange={e => {
                    setApiKeyInput(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="AIzaSy..."
                  className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs font-mono"
                />
              </div>

              {testResult && (
                <div className={cn(
                  "p-2.5 rounded-xl text-[11px] leading-relaxed border",
                  testResult.success 
                    ? "bg-green-50 border-green-200 text-green-800 font-semibold" 
                    : "bg-amber-50 border-amber-200 text-amber-900"
                )}>
                  {testResult.message}
                </div>
              )}

              <div className="flex items-center justify-between text-[11px] pt-0.5">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-primary-600 font-bold hover:underline flex items-center"
                >
                  <span>Get Free Key at Google AI Studio</span>
                  <ExternalLink size={10} className="ml-1" />
                </a>

                <button
                  type="button"
                  disabled={!apiKeyInput.trim() || isTesting}
                  onClick={async () => {
                    setIsTesting(true);
                    setTestResult(null);
                    clearGeminiCache();
                    const res = await testGeminiConnection(apiKeyInput, selectedModel);
                    setTestResult(res);
                    if (res.availableModels && res.availableModels.length > 0) {
                      setAvailableModels(res.availableModels);
                    }
                    if (res.model) {
                      setSelectedModel(res.model);
                      setActiveModelName(res.model);
                    }
                    setIsTesting(false);
                  }}
                  className="text-primary-700 font-bold hover:underline disabled:opacity-50 flex items-center space-x-1"
                >
                  {isTesting ? (
                    <>
                      <RefreshCw size={11} className="animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <span>Test Connection</span>
                  )}
                </button>
              </div>

              {/* Verified Free-Tier Model Dropdown */}
              <div className="pt-2">
                <div className="flex justify-between items-center">
                  <label className="text-[11px] font-bold text-textMain">Active Free-Tier Model</label>
                  <span className="text-[10px] text-green-700 font-semibold bg-green-50 px-1.5 py-0.5 rounded-md border border-green-200">
                    Auto-Failover Enabled
                  </span>
                </div>
                <select
                  value={selectedModel}
                  onChange={e => {
                    const newModel = e.target.value;
                    setSelectedModel(newModel);
                    setActiveModelName(newModel);
                  }}
                  className="w-full mt-1.5 p-2.5 bg-background rounded-xl border border-borderLight text-xs font-semibold text-textMain outline-none focus:border-primary-400"
                >
                  {availableModels.map(m => (
                    <option key={m.name} value={m.name}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-textMuted mt-1">
                  💡 If Google experiences temporary high demand, Hema automatically fails over across free-tier models to keep responding.
                </p>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setApiKeyInput('');
                    setGeminiApiKey('');
                    setHasApiKey(false);
                    setShowKeyModal(false);
                  }}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-textMuted font-bold rounded-xl text-xs transition-colors"
                >
                  Clear Key
                </button>
                <button
                  type="button"
                  onClick={handleSaveApiKey}
                  className="flex-1 py-2.5 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl text-xs transition-colors shadow-soft"
                >
                  Save & Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Assistant;
