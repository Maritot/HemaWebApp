import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  AlertTriangle, 
  Mic, 
  Sparkles, 
  Key, 
  Check, 
  X, 
  ExternalLink, 
  Square, 
  Languages, 
  RefreshCw, 
  Trash2, 
  Copy,
  Coins,
  Percent,
  Wallet,
  Gift
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { FormattedChatMessage } from '@/components/FormattedChatMessage';
import { 
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
    return 'నమస్కారం! నేను మీ హేమ (Hema) కుటుంబ ఆర్థిక సహాయకురాలిని. బంగారం ధరలు, ₹2 వడ్డీ లెక్కలు, లేదా గృహ బడ్జెట్ గురించి ఏదైనా అడగండి.';
  }
  if (lang === 'hi') {
    return 'नमस्ते! मैं आपकी पारिवारिक वित्तीय सहायक हेमा (Hema) हूँ। सोने के भाव, ₹2 ब्याज गणना या घरेलू बजट के बारे में कुछ भी पूछें।';
  }
  return 'Namaste! I am Hema, your household financial companion. Ask me anything about gold rates, informal ₹ Vaddi calculations, or family budgeting.';
};

const Assistant: React.FC = () => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport, setText: setVoiceText } = useSpeechToText();

  // Chatbot-specific language selection (independent of global app UI language)
  const [chatLanguage, setChatLanguage] = useState<'en' | 'hi' | 'te'>(() => {
    return (localStorage.getItem('hema_assistant_chat_language') as 'en' | 'hi' | 'te') || 'en';
  });

  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  
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

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Auto-persist messages whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  // Smooth scroll to bottom on new messages or streaming chunks
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

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
    // If only initial greeting exists, refresh it in the new language
    if (messages.length === 1 && messages[0].role === 'assistant') {
      const updatedGreeting = [{ role: 'assistant' as const, text: getInitialGreeting(code) }];
      setMessages(updatedGreeting);
    }
  };

  const handleCopyMessage = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (e) {
      console.warn('Failed to copy to clipboard', e);
    }
  };

  const handleClearChat = () => {
    if (window.confirm('Clear conversation and start fresh?')) {
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

      // Fallback update if streaming was empty
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
    { 
      icon: Coins, 
      title: 'బంగారం ధర & సేవింగ్స్', 
      desc: '24K & 22K ధరలు, SGB vs నగలు', 
      query: 'ఈరోజు బంగారం ధరలు మరియు భౌతిక బంగారం vs SGB పొదుపు గురించి క్లుప్తంగా చెప్పండి.' 
    },
    { 
      icon: Percent, 
      title: '₹2 రూపాయల వడ్డీ లెక్క', 
      desc: '₹50,000 కు 6 నెలల లెక్క', 
      query: '₹50,000 అప్పుకు నెలకు ₹2 వడ్డీ లెక్కన 6 నెలలకు మొత్తం ఎంత అవుతుంది?' 
    },
    { 
      icon: Wallet, 
      title: 'గృహ బడ్జెట్ బ్యాలెన్స్', 
      desc: 'ఆదాయం, ఖర్చులు & పొదుపు', 
      query: 'నా రికార్డు చేసిన లెడ్జర్ ప్రకారం నా ప్రస్తుత నికర బ్యాలెన్స్ మరియు బడ్జెట్ స్థితి ఏమిటి?' 
    },
    { 
      icon: Gift, 
      title: 'చదివింపుల మర్యాద', 
      desc: 'శుభకార్యాల ఆచారం', 
      query: 'వివాహాలలో సాంప్రదాయ చదివింపులు మరియు బహుమతుల ఆచారం గురించి క్లుప్తంగా చెప్పండి.' 
    }
  ] : chatLanguage === 'hi' ? [
    { 
      icon: Coins, 
      title: 'सोने के भाव व बचत', 
      desc: '24K/22K भाव, गहने vs SGB', 
      query: 'आज के सोने के अनुमानित भाव और भारतीय परिवारों के लिए स्वर्ण बचत संक्षेप में समझाएं।' 
    },
    { 
      icon: Percent, 
      title: '₹2 ब्याज की गणना', 
      desc: '₹50,000 पर 6 महीने का ब्याज', 
      query: '₹50,000 की राशि पर 2% प्रति माह ब्याज दर से 6 महीने का कुल कितना बनेगा?' 
    },
    { 
      icon: Wallet, 
      title: 'घरेलू बजट स्थिति', 
      desc: 'आय, व्यय व शुद्ध बचत', 
      query: 'मेरे दर्ज आय-व्यय के अनुसार मेरी वर्तमान वित्तीय स्थिति का संक्षिप्त सारांश क्या है?' 
    },
    { 
      icon: Gift, 
      title: 'शगुन की परंपरा', 
      desc: 'शुभ कार्यों में लिफाफा नियम', 
      query: 'शुभ कार्यों और शादियों में पारंपरिक शगुन के नियम और परंपरा संक्षेप में बताएं।' 
    }
  ] : [
    { 
      icon: Coins, 
      title: 'Gold Rates & SGB Guide', 
      desc: 'Today\'s 24K/22K & pure investment', 
      query: 'What are today\'s estimated 24K and 22K gold rates and how should families invest wisely?' 
    },
    { 
      icon: Percent, 
      title: '₹2 Monthly Vaddi Math', 
      desc: 'Calculation on ₹50,000 for 6 months', 
      query: 'Calculate informal ₹2 monthly Vaddi interest for ₹50,000 borrowed for 6 months.' 
    },
    { 
      icon: Wallet, 
      title: 'Check Ledger Balance', 
      desc: 'Income, expenses & net savings', 
      query: 'Based on my recorded income, expenses, and debts, what is my current net financial status?' 
    },
    { 
      icon: Gift, 
      title: 'Traditional Shagun Rules', 
      desc: 'Reciprocal family etiquette', 
      query: 'What is the traditional etiquette for reciprocal Shagun gifts at Indian family events?' 
    }
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2">
      
      {/* ================= 1. CHATBOT RESPONSE LANGUAGE SLIDER (BOT-ONLY) ================= */}
      <div className="flex items-center justify-between bg-white border border-primary-100 p-1.5 rounded-2xl mb-1.5 shadow-2xs shrink-0">
        <div className="flex items-center space-x-1.5 text-xs font-bold text-primary-950 pl-2">
          <Languages size={15} className="text-primary-600" />
          <span className="text-[11px] font-semibold text-textMuted uppercase tracking-wider">AI Language:</span>
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
      <div className="flex items-center justify-between bg-primary-50/90 border border-primary-200 px-3.5 py-2 rounded-xl mb-2 shrink-0 shadow-2xs">
        <div className="flex items-center space-x-2 text-xs font-semibold text-primary-950">
          <Sparkles size={15} className="text-primary-600" />
          <span>Hema AI</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${hasApiKey ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}`}>
            {hasApiKey ? getActiveModelShortName() : 'Local AI'}
          </span>
          <span className="text-[10px] bg-primary-200/90 text-primary-900 font-extrabold px-1.5 py-0.5 rounded-md">
            v1.8
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
            className="flex items-center space-x-1 text-[11px] font-bold text-primary-700 hover:text-primary-800 bg-white px-2.5 py-1 rounded-lg border border-primary-200 shadow-2xs hover:shadow-xs transition-all"
          >
            <Key size={12} />
            <span>{hasApiKey ? 'Key & Model' : 'Connect Gemini'}</span>
          </button>
        </div>
      </div>

      {/* ================= 3. SEBI COMPLIANCE BANNER ================= */}
      <div className="bg-amber-50/70 border border-amber-200/80 text-amber-900 px-3.5 py-1.5 rounded-xl flex items-start space-x-2.5 mb-2 shadow-2xs shrink-0">
        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-700" />
        <p className="text-[10px] leading-relaxed text-amber-950">
          {t('assistant.compliance')}
        </p>
      </div>

      {/* ================= 4. CHAT HISTORY ================= */}
      <div className="flex-1 overflow-y-auto space-y-3.5 pb-3 px-1 scrollbar-hide">
        {messages.length === 1 && (
          <div className="p-3 bg-primary-50/40 rounded-2xl border border-primary-150 mb-2">
            <p className="text-xs font-bold text-primary-900 mb-2 flex items-center">
              <Sparkles size={13} className="mr-1 text-primary-600" />
              Suggested Queries:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {quickPrompts.map((qp, idx) => {
                const IconComponent = qp.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSend(qp.query)}
                    className="text-left p-2.5 bg-white hover:bg-primary-50/60 rounded-xl border border-primary-200/70 hover:border-primary-400 text-slate-800 transition-all shadow-2xs group flex items-start space-x-2.5"
                  >
                    <div className="w-7 h-7 rounded-lg bg-primary-100/70 text-primary-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary-600 group-hover:text-white transition-colors">
                      <IconComponent size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-slate-900 group-hover:text-primary-900 leading-tight">
                        {qp.title}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {qp.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div 
            key={i} 
            className={cn(
              "flex w-full animate-in fade-in slide-in-from-bottom-2 duration-200",
              msg.role === 'user' ? "justify-end" : "justify-start"
            )}
          >
            {msg.role === 'user' ? (
              <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-xs bg-gradient-to-r from-primary-600 to-primary-700 text-white px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-soft">
                <p className="text-xs sm:text-sm font-medium leading-relaxed whitespace-pre-wrap break-words">
                  {msg.text}
                </p>
              </div>
            ) : (
              <div className="max-w-[95%] sm:max-w-[88%] w-full sm:w-auto rounded-2xl rounded-tl-xs bg-white border border-primary-200/90 shadow-soft p-3 sm:p-4 text-slate-800">
                {/* Assistant Card Header */}
                <div className="flex items-center justify-between border-b border-primary-100/70 pb-1.5 mb-2">
                  <div className="flex items-center space-x-1.5">
                    <div className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shadow-2xs">
                      <Sparkles size={11} />
                    </div>
                    <span className="text-[11px] font-bold text-primary-950 tracking-wide">Hema AI</span>
                    <span className="text-[9px] bg-primary-50 text-primary-800 font-extrabold px-1.5 py-0.2 rounded border border-primary-200/60 uppercase">
                      {chatLanguage}
                    </span>
                    {hasApiKey && (
                      <span className="hidden xs:inline-block text-[9px] text-slate-400 font-medium">
                        · {getActiveModelShortName()}
                      </span>
                    )}
                  </div>

                  {/* Copy Action */}
                  {msg.text && (
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(msg.text, i)}
                      className="flex items-center space-x-1 text-[10px] font-semibold text-slate-500 hover:text-primary-700 hover:bg-primary-50 px-2 py-0.5 rounded-md transition-colors"
                      title="Copy response to clipboard"
                    >
                      {copiedIndex === i ? (
                        <>
                          <Check size={11} className="text-green-600" />
                          <span className="text-green-700 font-bold">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={11} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Formatted Markdown Body */}
                {msg.text ? (
                  <FormattedChatMessage
                    content={msg.text}
                    isStreaming={isTyping && i === messages.length - 1}
                  />
                ) : (
                  <div className="flex items-center space-x-2 py-1 text-slate-500 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce delay-150" />
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce delay-300" />
                    <span className="text-[11px] font-medium text-slate-500 ml-1">Formulating response...</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ================= 5. FLOATING STOP GENERATION BUTTON ================= */}
      {isTyping && (
        <div className="flex justify-center mb-1.5 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full text-xs font-bold shadow-md active:scale-95 transition-all"
          >
            <Square size={11} className="fill-white" />
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
