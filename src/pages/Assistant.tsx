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
  Gift,
  FileSpreadsheet,
  Download
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { FormattedChatMessage } from '@/components/FormattedChatMessage';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { exportAndSaveFile } from '@/lib/nativeFiles';
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

/**
 * Converts Markdown table(s) embedded in text into clean, Excel-compatible CSV.
 */
export function extractMarkdownTablesAsCSV(markdown: string): string | null {
  if (!markdown || !markdown.includes('|')) return null;

  const lines = markdown.split('\n');
  const csvTables: string[] = [];
  let currentTableLines: string[] = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const isDelimiter = /^\|[\s\-:|]+\|$/.test(trimmed);
      if (!isDelimiter) {
        currentTableLines.push(trimmed);
      }
      inTable = true;
    } else {
      if (inTable && currentTableLines.length > 0) {
        const rows = currentTableLines.map(row => {
          const cells = row.split('|').slice(1, -1).map(c => {
            let clean = c.trim()
              .replace(/\*\*([^*]+)\*\*/g, '$1')
              .replace(/\*([^*]+)\*/g, '$1')
              .replace(/`([^`]+)`/g, '$1');
            clean = clean.replace(/"/g, '""');
            return `"${clean}"`;
          });
          return cells.join(',');
        });
        csvTables.push(rows.join('\r\n'));
        currentTableLines = [];
      }
      inTable = false;
    }
  }

  if (inTable && currentTableLines.length > 0) {
    const rows = currentTableLines.map(row => {
      const cells = row.split('|').slice(1, -1).map(c => {
        let clean = c.trim()
          .replace(/\*\*([^*]+)\*\*/g, '$1')
          .replace(/\*([^*]+)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        clean = clean.replace(/"/g, '""');
        return `"${clean}"`;
      });
      return cells.join(',');
    });
    csvTables.push(rows.join('\r\n'));
  }

  return csvTables.length > 0 ? csvTables.join('\r\n\r\n') : null;
}

interface AssistantProps {
  isKeyboardOpen?: boolean;
}

const Assistant: React.FC<AssistantProps> = ({ isKeyboardOpen = false }) => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport, setText: setVoiceText } = useSpeechToText();

  // Chatbot-specific language selection (independent of global app UI language)
  const [chatLanguage, setChatLanguage] = useState<'en' | 'hi' | 'te'>(() => {
    return (localStorage.getItem('hema_assistant_chat_language') as 'en' | 'hi' | 'te') || 'en';
  });

  const [input, setInput] = useState('');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<{ index: number; type: 'sheet' | 'report'; message: string } | null>(null);
  const [showCompliance, setShowCompliance] = useState(true);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  
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

    const lang = (localStorage.getItem('hema_assistant_chat_language') as 'en' | 'hi' | 'te') || 'en';
    return [{ role: 'assistant', text: getInitialGreeting(lang), lang }];
  });
  const [isTyping, setIsTyping] = useState(false);

  // Auto-scroll ref and input ref
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  };

  // Auto-persist messages whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(messages));
    } catch (e) {}
  }, [messages]);

  // Smooth scroll to bottom on new messages or streaming chunks
  useEffect(() => {
    scrollToBottom('smooth');
  }, [messages, isTyping]);

  // When keyboard opens or closes, ensure scroll to latest message
  useEffect(() => {
    if (isKeyboardOpen) {
      scrollToBottom('smooth');
      const t1 = setTimeout(() => scrollToBottom('smooth'), 120);
      const t2 = setTimeout(() => scrollToBottom('smooth'), 300);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [isKeyboardOpen]);

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
      const updatedGreeting = [{ role: 'assistant' as const, text: getInitialGreeting(code), lang: code }];
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

  const handleDownloadSheet = async (text: string, index: number) => {
    const csv = extractMarkdownTablesAsCSV(text);
    if (!csv) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `hema_sheet_${dateStr}_${index + 1}.csv`;

    const res = await exportAndSaveFile({
      filename,
      content: csv,
      mimeType: 'text/csv',
      title: 'Hema Financial Sheet'
    });

    setDownloadStatus({ index, type: 'sheet', message: res.success ? 'Saved Sheet!' : 'Failed' });
    setTimeout(() => setDownloadStatus(null), 2500);
  };

  const handleDownloadReport = async (text: string, index: number) => {
    if (!text) return;

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `hema_report_${dateStr}_${index + 1}.txt`;

    const res = await exportAndSaveFile({
      filename,
      content: text,
      mimeType: 'text/plain',
      title: 'Hema Financial Report'
    });

    setDownloadStatus({ index, type: 'report', message: res.success ? 'Saved Doc!' : 'Failed' });
    setTimeout(() => setDownloadStatus(null), 2500);
  };

  const handleConfirmClearChat = () => {
    const reset = [{ role: 'assistant' as const, text: getInitialGreeting(chatLanguage), lang: chatLanguage }];
    setMessages(reset);
    try {
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(reset));
    } catch (e) {}
    setShowClearConfirm(false);
  };

  const handleInputFocus = () => {
    scrollToBottom('smooth');
    setTimeout(() => scrollToBottom('smooth'), 120);
    setTimeout(() => scrollToBottom('smooth'), 300);
  };

  const handleSend = async (customPrompt?: string) => {
    const textToSend = (customPrompt || input).trim();
    if (!textToSend || isTyping) return;

    const currentLang = chatLanguage;
    const userMsg: ChatMessage = { role: 'user', text: textToSend, lang: currentLang };
    const emptyAssistantMsg: ChatMessage = { role: 'assistant', text: '', lang: currentLang };
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
              copy[assistantMsgIndex] = { role: 'assistant', text: chunkText, lang: currentLang };
            }
            return copy;
          });
        },
        controller.signal, 
        currentLang
      );

      if (!streamedBuffer && finalResponse) {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex]) {
            copy[assistantMsgIndex] = { role: 'assistant', text: finalResponse, lang: currentLang };
          }
          return copy;
        });
      }
    } catch (e: any) {
      if (e.name === 'AbortError' || controller.signal.aborted) {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex] && !copy[assistantMsgIndex].text) {
            copy[assistantMsgIndex] = { role: 'assistant', text: '⏹ Response stopped by user.', lang: currentLang };
          }
          return copy;
        });
      } else {
        setMessages(prev => {
          const copy = [...prev];
          if (copy[assistantMsgIndex]) {
            copy[assistantMsgIndex] = { role: 'assistant', text: 'I encountered an issue processing that. Please try again.', lang: currentLang };
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
      title: 'చదివింపుల వివరాల షీట్', 
      desc: 'బహుమతులు, పేర్లు & డౌన్‌లోడ్', 
      query: 'నా గృహ చదివింపులు మరియు బహుమతుల వివరాలన్నింటినీ వ్యక్తుల పేర్లు, సందర్భం మరియు మొత్తాలతో కూడిన పట్టికగా రూపొందించండి.' 
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
      title: 'शगुन एवं उपहार शीट', 
      desc: 'नामों व उपहारों की पूर्ण तालिका', 
      query: 'मेरे सभी उपहारों और शगुन के लेन-देन को व्यक्तियों के नाम, अवसर और राशि सहित एक पूर्ण तालिका (शीट) के रूप में तैयार करें।' 
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
      title: 'Gifts & Shagun Sheet', 
      desc: 'Download sheet of gifts & givers', 
      query: 'Generate a complete table sheet of all gifts given and received with names, occasions, items, and amounts so I can download it.' 
    }
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full w-full overflow-hidden select-none">
      
      {/* ================= 1. COMPACT UNIFIED TOP CONTROL BAR ================= */}
      <div className="bg-white border border-primary-100 rounded-2xl p-1.5 sm:p-2 mb-1.5 shadow-2xs shrink-0 flex flex-col gap-1">
        {/* Main Header Row */}
        <div className="flex items-center justify-between">
          {/* Language Switcher */}
          <div className="flex items-center space-x-1.5">
            <Languages size={13} className="text-primary-600 shrink-0" />
            <div className="flex items-center space-x-0.5 bg-primary-50/80 p-0.5 rounded-lg border border-primary-200/50">
              {chatLanguages.map(lang => {
                const isActive = chatLanguage === lang.code;
                return (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => handleLanguageSelect(lang.code)}
                    className={cn(
                      "px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-extrabold transition-all",
                      isActive
                        ? "bg-primary-600 text-white shadow-2xs"
                        : "text-textMuted hover:text-textMain hover:bg-white/60"
                    )}
                    title={`AI replies in ${lang.label}`}
                  >
                    {lang.short}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center space-x-1.5">
            <button
              type="button"
              onClick={handleOpenSettingsModal}
              className="flex items-center space-x-1 text-[10px] sm:text-[11px] font-bold text-primary-700 bg-primary-50/90 hover:bg-primary-100 px-2 py-0.5 rounded-lg border border-primary-200/60 shadow-2xs transition-colors"
              title="Change model or API key"
            >
              <Sparkles size={11} className="text-primary-600 shrink-0" />
              <span className="max-w-[100px] truncate">
                {hasApiKey ? getActiveModelShortName() : 'Local AI'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setShowClearConfirm(true)}
              className="p-1 text-textMuted hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-200"
              title="Clear conversation"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Dismissible SEBI Compliance Pill */}
        {showCompliance && (
          <div className="flex items-center justify-between bg-amber-50/70 border border-amber-200/60 px-2 py-0.5 rounded-lg text-amber-950 text-[10px]">
            <div className="flex items-center space-x-1 truncate mr-1.5">
              <AlertTriangle size={11} className="shrink-0 text-amber-700" />
              <span className="truncate">{t('assistant.compliance')}</span>
            </div>
            <button 
              type="button" 
              onClick={() => setShowCompliance(false)}
              className="text-amber-800 hover:text-amber-950 font-bold shrink-0 text-xs px-1 leading-none"
              title="Dismiss note"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* ================= 2. CHAT MESSAGE LIST (AUTO-SCROLLING, RESIZABLE) ================= */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-2 px-1 scrollbar-hide select-text">
        {messages.length === 1 && (
          <div className="p-2.5 bg-primary-50/40 rounded-2xl border border-primary-150 mb-2">
            <p className="text-xs font-bold text-primary-900 mb-2 flex items-center">
              <Sparkles size={12} className="mr-1 text-primary-600" />
              Suggested Queries:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {quickPrompts.map((qp, idx) => {
                const IconComponent = qp.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSend(qp.query)}
                    className="text-left p-2 bg-white hover:bg-primary-50/60 rounded-xl border border-primary-200/70 hover:border-primary-400 text-slate-800 transition-all shadow-2xs group flex items-start space-x-2"
                  >
                    <div className="w-6 h-6 rounded-lg bg-primary-100/70 text-primary-700 flex items-center justify-center shrink-0 mt-0.5 group-hover:bg-primary-600 group-hover:text-white transition-colors">
                      <IconComponent size={13} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-slate-900 group-hover:text-primary-900 leading-tight">
                        {qp.title}
                      </p>
                      <p className="text-[9px] text-slate-500 mt-0.5 truncate">
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
              <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tr-xs bg-gradient-to-r from-primary-600 to-primary-700 text-white px-3.5 py-2 sm:px-4 sm:py-2.5 shadow-soft">
                <p className="text-xs sm:text-sm font-medium leading-relaxed whitespace-pre-wrap break-words">
                  {msg.text}
                </p>
              </div>
            ) : (
              (() => {
                const hasTable = msg.text ? !!extractMarkdownTablesAsCSV(msg.text) : false;
                return (
                  <div className="max-w-[95%] sm:max-w-[88%] w-full sm:w-auto rounded-2xl rounded-tl-xs bg-white border border-primary-200/90 shadow-soft p-3 sm:p-3.5 text-slate-800">
                    {/* Assistant Card Header */}
                    <div className="flex items-center justify-between border-b border-primary-100/70 pb-1.5 mb-2 gap-2">
                      <div className="flex items-center space-x-1.5 shrink-0">
                        <div className="w-4 h-4 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center shadow-2xs">
                          <Sparkles size={10} />
                        </div>
                        <span className="text-[11px] font-bold text-primary-950 tracking-wide">Hema AI</span>
                      </div>

                      {/* Actions: Download Sheet (CSV), Download Report (Doc), Copy */}
                      {msg.text && (
                        <div className="flex items-center space-x-1 flex-wrap justify-end">
                          {hasTable && (
                            <button
                              type="button"
                              onClick={() => handleDownloadSheet(msg.text, i)}
                              className="flex items-center space-x-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300/80 px-2 py-0.5 rounded-md shadow-2xs transition-colors cursor-pointer"
                              title="Download table as CSV spreadsheet (opens in Excel/Sheets)"
                            >
                              {downloadStatus?.index === i && downloadStatus?.type === 'sheet' ? (
                                <>
                                  <Check size={11} className="text-emerald-700" />
                                  <span className="text-emerald-800 font-bold">{downloadStatus.message}</span>
                                </>
                              ) : (
                                <>
                                  <FileSpreadsheet size={11} className="text-emerald-700" />
                                  <span>Download Sheet (CSV)</span>
                                </>
                              )}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDownloadReport(msg.text, i)}
                            className="flex items-center space-x-1 text-[10px] font-semibold text-slate-600 hover:text-primary-700 hover:bg-primary-50 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer"
                            title="Download complete report or document"
                          >
                            {downloadStatus?.index === i && downloadStatus?.type === 'report' ? (
                              <>
                                <Check size={11} className="text-primary-700" />
                                <span className="text-primary-800 font-bold">{downloadStatus.message}</span>
                              </>
                            ) : (
                              <>
                                <Download size={11} />
                                <span>Save Doc</span>
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyMessage(msg.text, i)}
                            className="flex items-center space-x-1 text-[10px] font-semibold text-slate-500 hover:text-primary-700 hover:bg-primary-50 px-1.5 py-0.5 rounded-md transition-colors cursor-pointer"
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
                        </div>
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
                );
              })()
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ================= 3. FLOATING STOP GENERATION BUTTON ================= */}
      {isTyping && (
        <div className="flex justify-center mb-1 animate-in fade-in slide-in-from-bottom-2 duration-200 shrink-0">
          <button
            type="button"
            onClick={handleStop}
            className="flex items-center space-x-1.5 px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-full text-[11px] font-bold shadow-md active:scale-95 transition-all"
          >
            <Square size={10} className="fill-white" />
            <span>Stop Generating</span>
          </button>
        </div>
      )}

      {/* ================= 4. COMPACT SEAMLESS INPUT BAR ================= */}
      <div className="shrink-0 pt-1 pb-1 px-0.5 bg-background">
        <div className="flex items-center space-x-1.5 bg-white border border-primary-200/90 rounded-full px-2 py-1 shadow-2xs focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-400 transition-all">
          {hasSupport && (
            <button 
              type="button"
              onClick={startListening}
              className={cn(
                "p-1.5 rounded-full transition-colors shrink-0",
                isListening ? "bg-red-100 text-red-600 animate-pulse" : "text-primary-600 hover:bg-primary-50"
              )}
              title="Speak in your language"
            >
              <Mic size={16} />
            </button>
          )}

          <input 
            ref={inputRef}
            type="text" 
            value={input}
            onFocus={handleInputFocus}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={
              chatLanguage === 'te' 
                ? 'హేమను ఏదైనా అడగండి...' 
                : chatLanguage === 'hi' 
                  ? 'हेमा से कुछ भी पूछें...' 
                  : 'Ask Hema anything...'
            }
            className="flex-1 bg-transparent py-1 px-1.5 text-xs sm:text-sm text-slate-800 focus:outline-none placeholder:text-slate-400 min-w-0"
          />

          {isTyping ? (
            <button 
              type="button"
              onClick={handleStop}
              className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors flex items-center justify-center shrink-0 shadow-2xs"
              title="Stop Generating"
            >
              <Square size={12} className="fill-white" />
            </button>
          ) : (
            <button 
              type="button"
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-1.5 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-40 transition-colors flex items-center justify-center shrink-0 shadow-2xs"
            >
              <Send size={13} />
            </button>
          )}
        </div>
      </div>

      {/* ================= 5. MODAL: GEMINI API KEY & MODEL SETTINGS ================= */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl p-5 animate-in zoom-in-95 border border-borderLight">
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center space-x-2">
                <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                  <Key size={14} />
                </div>
                <div>
                  <h3 className="font-bold text-textMain text-xs sm:text-sm">Google Gemini AI Engine</h3>
                  <p className="text-[10px] text-textMuted">Free Tier & Ledger Grounding</p>
                </div>
              </div>
              <button onClick={() => setShowKeyModal(false)} className="text-textMuted hover:text-textMain p-1">
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-textMuted">Gemini API Key</label>
                <input 
                  type="password"
                  value={apiKeyInput}
                  onChange={e => {
                    setApiKeyInput(e.target.value);
                    setTestResult(null);
                  }}
                  placeholder="AIzaSy..."
                  className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs font-mono"
                />
              </div>

              {testResult && (
                <div className={cn(
                  "p-2 rounded-xl text-[10px] leading-relaxed border",
                  testResult.success 
                    ? "bg-green-50 border-green-200 text-green-800 font-semibold" 
                    : "bg-amber-50 border-amber-200 text-amber-900"
                )}>
                  {testResult.message}
                </div>
              )}

              <div className="flex items-center justify-between text-[10px] pt-0.5">
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noreferrer"
                  className="text-primary-600 font-bold hover:underline flex items-center"
                >
                  <span>Google AI Studio Key</span>
                  <ExternalLink size={9} className="ml-1" />
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
                      <RefreshCw size={10} className="animate-spin" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <span>Test Connection</span>
                  )}
                </button>
              </div>

              {/* Verified Free-Tier Model Dropdown */}
              <div className="pt-1">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-textMain">Active Free-Tier Model</label>
                  <span className="text-[9px] text-green-700 font-semibold bg-green-50 px-1 py-0.2 rounded border border-green-200">
                    Auto-Failover
                  </span>
                </div>
                <select
                  value={selectedModel}
                  onChange={e => {
                    const newModel = e.target.value;
                    setSelectedModel(newModel);
                    setActiveModelName(newModel);
                  }}
                  className="w-full mt-1 p-2 bg-background rounded-xl border border-borderLight text-xs font-semibold text-textMain outline-none focus:border-primary-400"
                >
                  {availableModels.map(m => (
                    <option key={m.name} value={m.name}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
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
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-textMuted font-bold rounded-xl text-xs transition-colors"
                >
                  Clear Key
                </button>
                <button
                  type="button"
                  onClick={handleSaveApiKey}
                  className="flex-1 py-2 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl text-xs transition-colors shadow-soft"
                >
                  Save & Connect
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Clear Chat Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={showClearConfirm}
        title="Clear Conversation?"
        message="Are you sure you want to clear the conversation history and start fresh?"
        itemName="All Assistant Messages"
        onConfirm={handleConfirmClearChat}
        onCancel={() => setShowClearConfirm(false)}
      />

    </div>
  );
};

export default Assistant;
