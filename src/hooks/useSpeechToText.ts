import { useState, useEffect, useCallback } from 'react';

export const useSpeechToText = (lang = 'en-IN') => {
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [recognition, setRecognition] = useState<any>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const r = new SpeechRecognition();
        r.continuous = false;
        r.interimResults = false;
        r.lang = lang;
        r.onresult = (e: any) => {
          setText(e.results[0][0].transcript);
          setIsListening(false);
        };
        r.onerror = () => setIsListening(false);
        r.onend = () => setIsListening(false);
        setRecognition(r);
      }
    }
  }, [lang]);

  const startListening = useCallback(() => {
    setText('');
    setIsListening(true);
    recognition?.start();
  }, [recognition]);

  return { text, isListening, startListening, hasSupport: !!recognition, setText };
};
