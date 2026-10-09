import React, { useState } from 'react';
import { Bot, Send, AlertTriangle, Mic, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';

const Assistant: React.FC = () => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport, setText: setVoiceText } = useSpeechToText();

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant', text: string }[]>([
    { role: 'assistant', text: 'Namaste! I am Hema, your financial assistant. How can I help you today?' }
  ]);
  const [isTyping, setIsTyping] = useState(false);

  // Sync voice input with text input
  React.useEffect(() => {
    if (voiceText) {
      setInput(voiceText);
    }
  }, [voiceText]);

  const handleSend = () => {
    if (!input.trim()) return;
    
    // Add User Message
    setMessages(prev => [...prev, { role: 'user', text: input }]);
    setInput('');
    setVoiceText(''); // Clear voice context
    setIsTyping(true);

    // AI Logic placeholder - in reality, you'd fetch from your LLM backend here.
    setTimeout(() => {
      let responseText = 'I have noted that down. Do you need anything else?';
      
      const lowerInput = input.toLowerCase();
      if (lowerInput.includes('spend') || lowerInput.includes('balance') || lowerInput.includes('money')) {
        responseText = 'Based on your recent transactions, your overall monthly budget is looking safe. Keep it up!';
      } else if (lowerInput.includes('invest') || lowerInput.includes('gold')) {
        responseText = 'Gold is historically a safe asset for Indian households. However, please consult the SEBI disclaimer above before making major financial moves.';
      }

      setMessages(prev => [...prev, { role: 'assistant', text: responseText }]);
      setIsTyping(false);
    }, 1500);
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* SEBI Compliance Banner */}
      <div className="bg-amber-100 border border-amber-300 text-amber-900 px-4 py-3 rounded-xl flex items-start space-x-3 mb-4 shadow-sm shrink-0">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
        <p className="text-xs leading-relaxed">
          {t('assistant.compliance')}
        </p>
      </div>

      {/* Chat History */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4 px-1 scrollbar-hide">
        {messages.map((msg, i) => (
          <div key={i} className={cn(
            "flex w-full",
            msg.role === 'user' ? "justify-end" : "justify-start"
          )}>
            <div className={cn(
              "max-w-[80%] rounded-2xl p-3 text-sm leading-relaxed shadow-sm",
              msg.role === 'user' 
                ? "bg-primary-600 text-white rounded-br-none" 
                : "bg-surface border border-borderLight text-textMain rounded-bl-none"
            )}>
              {msg.role === 'assistant' && <Sparkles size={14} className="inline-block mr-1 text-primary-500 mb-0.5" />}
              {msg.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex w-full justify-start">
            <div className="bg-surface border border-borderLight text-textMain rounded-2xl rounded-bl-none p-4 shadow-sm">
              <div className="flex space-x-1.5">
                <div className="w-2 h-2 rounded-full bg-primary-300 animate-bounce"></div>
                <div className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0.15s' }}></div>
                <div className="w-2 h-2 rounded-full bg-primary-500 animate-bounce" style={{ animationDelay: '0.3s' }}></div>
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
                "p-3 border rounded-full shadow-sm active:scale-95 transition-colors",
                isListening ? "bg-red-100 border-red-200 text-red-600 animate-pulse" : "bg-surface border-borderLight text-primary-600"
              )}
            >
              <Mic size={20} />
            </button>
          )}
          <div className="flex-1 relative">
            <input 
              type="text" 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t('assistant.placeholder')}
              className="w-full bg-surface border border-borderLight rounded-full py-3 pl-4 pr-12 text-sm focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 shadow-sm"
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim()}
              className="absolute right-1 top-1 bottom-1 p-2 bg-primary-600 text-white rounded-full hover:bg-primary-700 disabled:opacity-50 transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Assistant;
