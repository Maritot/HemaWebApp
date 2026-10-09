import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { IndianRupee, Wand2, CheckCircle2, Mic, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveCategory, ResolvedCategory } from '@/lib/AutoCorrectEngine';
import { addTransaction, getTransactions } from '@/lib/db';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';

const Expenses: React.FC = () => {
  const { t } = useTranslation();
  const { text: voiceText, isListening, startListening, hasSupport } = useSpeechToText();

  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [rawCategory, setRawCategory] = useState('');
  const [resolvedCategory, setResolvedCategory] = useState<ResolvedCategory | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  
  // Date state (defaults to today in YYYY-MM-DD format)
  const [txDate, setTxDate] = useState(new Date().toISOString().split('T')[0]);

  // Fetch current balance
  const fetchBalance = async () => {
    const txs = await getTransactions();
    const totalInc = txs.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const totalExp = txs.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    setBalance(totalInc - totalExp);
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  // When voice text is captured, populate the raw category
  useEffect(() => {
    if (voiceText) {
      setRawCategory(voiceText);
    }
  }, [voiceText]);

  // Run auto-correct when category input changes (mostly relevant for Expenses)
  useEffect(() => {
    if (rawCategory.length > 2 && type === 'EXPENSE') {
      const timer = setTimeout(() => {
        setResolvedCategory(resolveCategory(rawCategory));
      }, 400); // debounce
      return () => clearTimeout(timer);
    } else {
      setResolvedCategory(null);
    }
  }, [rawCategory, type]);

  const handleSave = async () => {
    if (!amount || isNaN(Number(amount))) return;
    
    let finalCategory = rawCategory || 'Other';
    if (type === 'EXPENSE' && resolvedCategory) {
      finalCategory = resolvedCategory.categoryId;
    }
    
    // Parse the date (if empty, fallback to now)
    const timestamp = txDate ? new Date(txDate).getTime() : Date.now();

    await addTransaction({
      id: crypto.randomUUID(),
      amount: Number(amount),
      categoryId: finalCategory,
      type: type,
      date: timestamp,
      notes: notes
    });

    setIsSaved(true);
    fetchBalance(); // Refresh balance immediately
    setTimeout(() => {
      setIsSaved(false);
      setAmount('');
      setRawCategory('');
      setNotes('');
      setTxDate(new Date().toISOString().split('T')[0]);
      setResolvedCategory(null);
    }, 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* Header & Segmented Control */}
      <div className="flex flex-col items-center mb-4">
        <h2 className="text-xl font-bold text-textMain mb-4">{t('expenses.title')}</h2>
        <div className="bg-borderLight p-1 rounded-full flex space-x-1 shadow-inner w-full max-w-xs">
          <button 
            onClick={() => setType('EXPENSE')}
            className={cn(
              "flex-1 py-2 rounded-full text-sm font-semibold transition-all",
              type === 'EXPENSE' ? "bg-surface shadow-sm text-red-600" : "text-textMuted hover:text-textMain"
            )}
          >
            {t('expenses.expense_tab')}
          </button>
          <button 
            onClick={() => setType('INCOME')}
            className={cn(
              "flex-1 py-2 rounded-full text-sm font-semibold transition-all",
              type === 'INCOME' ? "bg-surface shadow-sm text-green-600" : "text-textMuted hover:text-textMain"
            )}
          >
            {t('expenses.income_tab')}
          </button>
        </div>
      </div>

      {/* Main Form Card */}
      <Card className="border-none shadow-xl shadow-primary-900/5">
        <CardContent className="pt-6 space-y-6">
          
          {/* Available Balance Indicator */}
          <div className="flex items-center justify-between bg-primary-50 px-4 py-3 rounded-xl border border-primary-100">
            <div className="flex items-center text-primary-800">
              <Wallet size={16} className="mr-2" />
              <span className="text-sm font-semibold">{t('expenses.available_balance', 'Available Balance')}</span>
            </div>
            <span className={cn(
              "text-lg font-bold",
              balance >= 0 ? "text-primary-700" : "text-red-600"
            )}>
              ₹{balance.toLocaleString('en-IN')}
            </span>
          </div>

          {/* Amount Input */}
          <div className="text-center pt-2">
            <p className="text-textMuted text-sm font-medium mb-2">{t('expenses.amount')}</p>
            <div className="flex items-center justify-center text-5xl font-bold text-textMain">
              <span className="text-3xl text-textMuted mr-1">₹</span>
              <input 
                type="number" 
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-40 bg-transparent outline-none text-center placeholder:text-borderLight"
              />
            </div>
          </div>

          <hr className="border-borderLight" />

          {/* Dynamic Category/Source Input */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-textMain">
              {type === 'EXPENSE' ? t('expenses.what_for') : t('expenses.income_source', 'Source of Income')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={rawCategory}
                onChange={(e) => setRawCategory(e.target.value)}
                placeholder={type === 'EXPENSE' ? t('expenses.what_for_ph') : t('expenses.income_source_ph', 'e.g., Salary, Pension, Rent')}
                className="w-full p-4 bg-background rounded-xl border border-borderLight focus:border-primary-400 focus:ring-2 focus:ring-primary-100 outline-none transition-all placeholder:text-textMuted/50 pr-14"
              />
              {/* Mic Icon for Voice feature */}
              {hasSupport && (
                <button 
                  onClick={startListening}
                  className={cn(
                    "absolute right-3 top-3.5 p-2 rounded-full transition-colors",
                    isListening ? "bg-red-100 text-red-600 animate-pulse" : "text-primary-600 bg-primary-50 hover:bg-primary-100"
                  )}
                >
                  <Mic size={18} />
                </button>
              )}
            </div>

            {/* Auto-Correct Feedback (Only for Expenses) */}
            {type === 'EXPENSE' && resolvedCategory && rawCategory.length > 2 && (
              <div className="flex items-center mt-2 p-3 bg-primary-50 text-primary-800 rounded-lg text-sm border border-primary-100 animate-in fade-in zoom-in-95">
                <Wand2 size={16} className="mr-2 text-primary-600" />
                <span>
                  {t('expenses.categorized_as')} <strong className="font-bold">{resolvedCategory.categoryId}</strong>
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Date Input */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-textMain">Date</label>
              <input
                type="date"
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full p-4 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none transition-all text-textMain"
              />
            </div>

            {/* Notes Input */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-textMain">{t('expenses.notes')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('expenses.notes_ph')}
                className="w-full p-4 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none transition-all"
              />
            </div>
          </div>

          {/* Save Button */}
          <button 
            onClick={handleSave}
            disabled={!amount || isSaved}
            className={cn(
              "w-full py-4 rounded-xl font-bold text-white transition-all shadow-soft flex items-center justify-center",
              isSaved 
                ? "bg-green-500"
                : !amount 
                  ? "bg-textMuted/40 cursor-not-allowed" 
                  : type === 'INCOME' 
                    ? "bg-green-600 hover:bg-green-700 active:scale-[0.98]" 
                    : "bg-primary-600 hover:bg-primary-700 active:scale-[0.98]"
            )}
          >
            {isSaved ? (
              <>
                <CheckCircle2 className="mr-2" size={20} /> {t('expenses.saved')}
              </>
            ) : (
              t('expenses.save')
            )}
          </button>
        </CardContent>
      </Card>
    </div>
  );
};

export default Expenses;
