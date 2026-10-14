import React, { useState, useEffect } from 'react';
import { Bot, Send, AlertTriangle, Mic, Sparkles, Key, Check, X, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { queryGemini, getGeminiApiKey, setGeminiApiKey, testGeminiConnection, clearGeminiCache, getActiveModelName, setActiveModelName, fetchAvailableModels, AvailableModel, ChatMessage } from '@/lib/gemini';

const Assistant: React.FC = () => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport, setText: setVoiceText } = useSpeechToText();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    { 
      role: 'assistant', 
      text: 'Namaste! I am Hema, your household financial companion. Ask me anything about your budget, Gold vs FD, Vaddi interest calculations, or household tax planning.' 
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);

  // Gemini Key Modal & Connection Test State
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState(getGeminiApiKey());
  const [hasApiKey, setHasApiKey] = useState(!!getGeminiApiKey());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(getActiveModelName());

  // Sync voice input with text input
  useEffect(() => {
    if (voiceText) {
      setInput(voiceText);
    }
  }, [voiceText]);

  const handleSend = async () => {
    if (!input.trim() || isTyping) return;

    const userText = input.trim();
    const updatedMessages: ChatMessage[] = [...messages, { role: 'user', text: userText }];
    setMessages(updatedMessages);
    setInput('');
    setVoiceText('');
    setIsTyping(true);

    try {
      const response = await queryGemini(userText, updatedMessages);
      setMessages(prev => [...prev, { role: 'assistant', text: response }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'I encountered an issue processing that. Please try again.' }]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSaveApiKey = () => {
    setGeminiApiKey(apiKeyInput.trim());
    setHasApiKey(!!apiKeyInput.trim());
    setShowKeyModal(false);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] animate-in fade-in slide-in-from-bottom-4 duration-500 pb-2">
      
      {/* Top Banner & Gemini API Status Pill */}
      <div className="flex items-center justify-between bg-primary-50 border border-primary-200 px-3.5 py-2 rounded-xl mb-3 shrink-0">
        <div className="flex items-center space-x-2 text-xs font-semibold text-primary-950">
          <Sparkles size={15} className="text-primary-600" />
          <span>Hema AI Engine</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${hasApiKey ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-800'}`}>
            {hasApiKey ? getActiveModelName() : 'Local AI'}
          </span>
          <span className="text-[10px] bg-primary-200/80 text-primary-900 font-extrabold px-1.5 py-0.5 rounded-md">
            v1.3
          </span>
        </div>
        <button
          onClick={async () => {
            setTestResult(null);
            setShowKeyModal(true);
            if (apiKeyInput.trim()) {
              const models = await fetchAvailableModels(apiKeyInput.trim());
              setAvailableModels(models);
            }
          }}
          className="flex items-center space-x-1 text-[11px] font-bold text-primary-700 hover:text-primary-800 bg-white px-2.5 py-1 rounded-lg border border-primary-200 shadow-xs"
        >
          <Key size={12} />
          <span>{hasApiKey ? 'Change Key' : 'Connect Gemini'}</span>
        </button>
      </div>

      {/* SEBI Compliance Banner */}
      <div className="bg-amber-100/70 border border-amber-300 text-amber-900 px-3.5 py-2 rounded-xl flex items-start space-x-2.5 mb-3 shadow-xs shrink-0">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700" />
        <p className="text-[11px] leading-relaxed text-amber-950">
          {t('assistant.compliance')}
        </p>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto space-y-3.5 pb-3 px-1 scrollbar-hide">
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
                  Hema AI
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
                <span className="text-xs text-textMuted font-medium mr-1">Thinking</span>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-bounce"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                <div className="w-1.5 h-1.5 rounded-full bg-primary-600 animate-bounce" style={{ animationDelay: '0.3s' }}></div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="pt-2 shrink-0 bg-background">
        <div className="flex items-center space-x-2">
          {hasSupport && (
            <button 
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
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="absolute right-1.5 top-1.5 bottom-1.5 px-3 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-40 transition-colors flex items-center justify-center"
            >
              <Send size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* ================= MODAL: GEMINI API KEY SETUP ================= */}
      {showKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-sm bg-surface rounded-2xl shadow-2xl p-6 animate-in zoom-in-95 border border-borderLight">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                  <Key size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-textMain text-sm">Google Gemini API</h3>
                  <p className="text-[11px] text-textMuted">Live AI Financial Reasoning</p>
                </div>
              </div>
              <button onClick={() => setShowKeyModal(false)} className="text-textMuted hover:text-textMain p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3.5">
              <p className="text-xs text-textMuted leading-relaxed">
                Connect your free Google Gemini API key to enable live, conversational financial intelligence aware of your household income and expenses.
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

              <div className="flex items-center justify-between text-[11px] pt-1">
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
                    }
                    setIsTesting(false);
                  }}
                  className="text-primary-700 font-bold hover:underline disabled:opacity-50"
                >
                  {isTesting ? 'Testing...' : 'Test Connection'}
                </button>
              </div>

              {availableModels.length > 0 && (
                <div className="pt-2">
                  <label className="text-[11px] font-semibold text-textMuted">Active Gemini Model</label>
                  <select
                    value={selectedModel}
                    onChange={e => {
                      setSelectedModel(e.target.value);
                      setActiveModelName(e.target.value);
                    }}
                    className="w-full mt-1 p-2 bg-background rounded-xl border border-borderLight text-xs font-semibold text-textMain outline-none"
                  >
                    {availableModels.map(m => (
                      <option key={m.name} value={m.name}>
                        {m.displayName} ({m.name.replace(/^models\//, '')})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="flex space-x-2 pt-2">
                <button
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
