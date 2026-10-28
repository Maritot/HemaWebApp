import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  IndianRupee, 
  Wand2, 
  CheckCircle2, 
  Mic, 
  Wallet, 
  Search, 
  Calendar, 
  Clock,
  ArrowDownRight, 
  ArrowUpRight, 
  Trash2, 
  Filter, 
  X,
  History,
  RefreshCw,
  PieChart,
  Briefcase,
  HandCoins,
  AlertTriangle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveCategory, ResolvedCategory } from '@/lib/AutoCorrectEngine';
import { 
  addTransaction, 
  getTransactions, 
  deleteTransaction, 
  getDebts,
  recordDebtPayment,
  HemaDB, 
  DebtRecordItem, 
  IncomeClassification 
} from '@/lib/db';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { format, isSameDay } from 'date-fns';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useAuth } from '@/context/AuthContext';

type HistoryFilterType = 'ALL' | 'EXPENSE' | 'INCOME' | 'EARNED_INCOME' | 'DEBT_RECOVERY';

const Expenses: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { text: voiceText, isListening, startListening, hasSupport } = useSpeechToText();

  // Add Form state
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [rawCategory, setRawCategory] = useState('');
  const [resolvedCategory, setResolvedCategory] = useState<ResolvedCategory | null>(null);
  const [notes, setNotes] = useState('');
  const [isSaved, setIsSaved] = useState(false);
  const [balance, setBalance] = useState<number>(0);
  
  // Date and Time (Live Time Default)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState(() => format(new Date(), 'HH:mm'));

  // Income Classification (Regular vs Debt Recovery)
  const [incomeType, setIncomeType] = useState<IncomeClassification>('REGULAR');
  const [debtorDebts, setDebtorDebts] = useState<DebtRecordItem[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [customDebtorName, setCustomDebtorName] = useState<string>('');
  const [syncWithDebtLedger, setSyncWithDebtLedger] = useState<boolean>(true);

  // All Transactions for History Log
  const [allTransactions, setAllTransactions] = useState<HemaDB['transactions']['value'][]>([]);

  // History Filter state (decoupled from top form)
  const [historyTab, setHistoryTab] = useState<HistoryFilterType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL'); // 'ALL' or '0'..'11'
  const [selectedYear, setSelectedYear] = useState<string>('ALL'); // 'ALL' or '2026'..
  const [specificDateFilter, setSpecificDateFilter] = useState<string>(''); // YYYY-MM-DD or empty
  const [deleteTargetTx, setDeleteTargetTx] = useState<HemaDB['transactions']['value'] | null>(null);

  const setLiveTimeToNow = () => {
    setTxDate(new Date().toISOString().split('T')[0]);
    setTxTime(format(new Date(), 'HH:mm'));
  };

  const fetchTransactions = async () => {
    const txs = await getTransactions();
    const sorted = txs.sort((a, b) => b.date - a.date);
    setAllTransactions(sorted);

    const totalInc = sorted.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const totalExp = sorted.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    setBalance(totalInc - totalExp);

    // Fetch active debtors who owe us money
    try {
      const debts = await getDebts();
      const debtors = debts.filter(d => d.type === 'OWED_TO_US' && d.status !== 'SETTLED');
      setDebtorDebts(debtors);
    } catch {
      setDebtorDebts([]);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, [user?.id]);

  // Decoupled: changing top form does NOT change bottom history filter
  const handleTypeChange = (newType: 'EXPENSE' | 'INCOME') => {
    setType(newType);
  };

  // Sync voice input
  useEffect(() => {
    if (voiceText) {
      setRawCategory(voiceText);
    }
  }, [voiceText]);

  // Auto-correct category for expenses
  useEffect(() => {
    if (rawCategory.length > 2 && type === 'EXPENSE') {
      const timer = setTimeout(() => {
        setResolvedCategory(resolveCategory(rawCategory));
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setResolvedCategory(null);
    }
  }, [rawCategory, type]);

  const handleSave = async () => {
    if (!amount || isNaN(Number(amount))) return;
    
    const userInputLabel = rawCategory.trim();
    let finalCategory = userInputLabel || 'Other';
    if (type === 'EXPENSE' && resolvedCategory) {
      finalCategory = resolvedCategory.categoryId;
    }
    
    // Combine Date + Time
    let timestamp = Date.now();
    if (txDate) {
      const [year, month, day] = txDate.split('-').map(Number);
      const [hours, minutes] = (txTime || format(new Date(), 'HH:mm')).split(':').map(Number);
      const dateObj = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0);
      timestamp = dateObj.getTime();
    }

    let debtId: string | undefined = undefined;
    let debtorName: string | undefined = undefined;

    if (type === 'INCOME' && incomeType === 'DEBT_RECOVERY') {
      if (selectedDebtId && selectedDebtId !== '__CUSTOM__') {
        debtId = selectedDebtId;
        const matched = debtorDebts.find(d => d.id === selectedDebtId);
        debtorName = matched ? matched.person : customDebtorName.trim();
      } else {
        debtorName = customDebtorName.trim();
      }
    }

    const defaultLabel = type === 'INCOME' && incomeType === 'DEBT_RECOVERY'
      ? (debtorName ? `Debt Repayment (${debtorName})` : 'Debt Recovery')
      : finalCategory;

    await addTransaction({
      id: crypto.randomUUID(),
      amount: Number(amount),
      categoryId: finalCategory,
      label: userInputLabel || defaultLabel,
      type: type,
      incomeType: type === 'INCOME' ? incomeType : undefined,
      debtId: debtId,
      debtorName: debtorName,
      date: timestamp,
      notes: notes.trim()
    });

    // Auto-record in Debt Tracker if selected and enabled
    if (type === 'INCOME' && incomeType === 'DEBT_RECOVERY' && debtId && syncWithDebtLedger) {
      try {
        await recordDebtPayment(debtId, {
          id: crypto.randomUUID(),
          amount: Number(amount),
          date: timestamp,
          notes: notes.trim() ? `Collected via Income: ${notes.trim()}` : 'Payment collected and recorded via Income'
        });
      } catch (err) {
        console.warn('Could not auto-sync debt payment:', err);
      }
    }

    setIsSaved(true);
    await fetchTransactions();
    setTimeout(() => {
      setIsSaved(false);
      setAmount('');
      setRawCategory('');
      setNotes('');
      setTxDate(todayStr);
      setTxTime(format(new Date(), 'HH:mm'));
      setResolvedCategory(null);
      setSelectedDebtId('');
      setCustomDebtorName('');
    }, 1500);
  };

  const handleDeleteTx = (tx: HemaDB['transactions']['value']) => {
    setDeleteTargetTx(tx);
  };

  // Extract available years from transactions
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    allTransactions.forEach(t => {
      years.add(String(new Date(t.date).getFullYear()));
    });
    return Array.from(years).sort().reverse();
  }, [allTransactions]);

  const monthsList = [
    { value: '0', label: 'January' },
    { value: '1', label: 'February' },
    { value: '2', label: 'March' },
    { value: '3', label: 'April' },
    { value: '4', label: 'May' },
    { value: '5', label: 'June' },
    { value: '6', label: 'July' },
    { value: '7', label: 'August' },
    { value: '8', label: 'September' },
    { value: '9', label: 'October' },
    { value: '10', label: 'November' },
    { value: '11', label: 'December' },
  ];

  // Spending Rate & Financial Health Analysis
  const earnedIncome = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'INCOME' && t.incomeType !== 'DEBT_RECOVERY')
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const debtRecoveryIncome = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'INCOME' && t.incomeType === 'DEBT_RECOVERY')
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const totalExpenses = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const spendRatePercentage = useMemo(() => {
    if (earnedIncome <= 0) {
      return totalExpenses > 0 ? 100 : 0;
    }
    return Math.round((totalExpenses / earnedIncome) * 100);
  }, [earnedIncome, totalExpenses]);

  const operationalSurplus = earnedIncome - totalExpenses;

  // Filtered transactions for the history log
  const filteredHistory = useMemo(() => {
    return allTransactions.filter(tx => {
      // 1. History Tab filter
      if (historyTab === 'EXPENSE' && tx.type !== 'EXPENSE') return false;
      if (historyTab === 'INCOME' && tx.type !== 'INCOME') return false;
      if (historyTab === 'EARNED_INCOME' && (tx.type !== 'INCOME' || tx.incomeType === 'DEBT_RECOVERY')) return false;
      if (historyTab === 'DEBT_RECOVERY' && (tx.type !== 'INCOME' || tx.incomeType !== 'DEBT_RECOVERY')) return false;

      // 2. Specific date filter
      if (specificDateFilter) {
        const targetDate = new Date(specificDateFilter);
        if (!isSameDay(new Date(tx.date), targetDate)) {
          return false;
        }
      }

      const txDateObj = new Date(tx.date);

      // 3. Month filter
      if (selectedMonth !== 'ALL' && txDateObj.getMonth() !== Number(selectedMonth)) {
        return false;
      }

      // 4. Year filter
      if (selectedYear !== 'ALL' && String(txDateObj.getFullYear()) !== selectedYear) {
        return false;
      }

      // 5. Search query (matches label, category, notes, debtorName, or amount)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const label = (tx.label || '').toLowerCase();
        const cat = (tx.categoryId || '').toLowerCase();
        const note = (tx.notes || '').toLowerCase();
        const debtor = (tx.debtorName || '').toLowerCase();
        const amtStr = String(tx.amount);

        if (!label.includes(query) && !cat.includes(query) && !note.includes(query) && !debtor.includes(query) && !amtStr.includes(query)) {
          return false;
        }
      }

      return true;
    });
  }, [allTransactions, historyTab, specificDateFilter, selectedMonth, selectedYear, searchQuery]);

  // Group filtered transactions by Month ("MMMM yyyy")
  const groupedByMonth = useMemo(() => {
    const groups: { monthKey: string; items: HemaDB['transactions']['value'][]; totalIncome: number; totalExpense: number }[] = [];
    const map = new Map<string, HemaDB['transactions']['value'][]>();

    filteredHistory.forEach(tx => {
      const key = format(new Date(tx.date), 'MMMM yyyy');
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(tx);
    });

    map.forEach((items, monthKey) => {
      const totalIncome = items.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0);
      const totalExpense = items.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0);
      groups.push({ monthKey, items, totalIncome, totalExpense });
    });

    return groups;
  }, [filteredHistory]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedMonth('ALL');
    setSelectedYear('ALL');
    setSpecificDateFilter('');
  };

  const hasActiveFilters = searchQuery !== '' || selectedMonth !== 'ALL' || selectedYear !== 'ALL' || specificDateFilter !== '';

  return (
    <div className="space-y-5 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      
      {/* Header & Main Add Mode Switcher */}
      <div className="flex flex-col items-center">
        <h2 className="text-xl font-bold text-textMain mb-3">{t('expenses.title')}</h2>
        <div className="bg-borderLight p-1 rounded-full flex space-x-1 shadow-inner w-full max-w-xs">
          <button 
            type="button"
            onClick={() => handleTypeChange('EXPENSE')}
            className={cn(
              "flex-1 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer",
              type === 'EXPENSE' ? "bg-surface shadow-xs text-red-600 font-bold" : "text-textMuted hover:text-textMain"
            )}
          >
            {t('expenses.expense_tab')}
          </button>
          <button 
            type="button"
            onClick={() => handleTypeChange('INCOME')}
            className={cn(
              "flex-1 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all cursor-pointer",
              type === 'INCOME' ? "bg-surface shadow-xs text-green-700 font-bold" : "text-textMuted hover:text-textMain"
            )}
          >
            {t('expenses.income_tab')}
          </button>
        </div>
      </div>

      {/* Compact Main Add Form Card */}
      <Card className="border border-borderLight shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          
          {/* Available Balance Header */}
          <div className="flex items-center justify-between bg-primary-50/80 px-3.5 py-2.5 rounded-xl border border-primary-100">
            <div className="flex items-center text-primary-900 text-xs font-semibold">
              <Wallet size={15} className="mr-1.5 text-primary-600" />
              <span>{t('expenses.available_balance', 'Available Balance')}</span>
            </div>
            <span className={cn(
              "text-base font-bold",
              balance >= 0 ? "text-primary-700" : "text-red-600"
            )}>
              ₹{balance.toLocaleString('en-IN')}
            </span>
          </div>

          {/* Amount Input */}
          <div className="text-center py-1">
            <p className="text-textMuted text-xs font-medium mb-1">{t('expenses.amount')}</p>
            <div className="flex items-center justify-center text-3xl sm:text-4xl font-bold text-textMain">
              <span className="text-xl sm:text-2xl text-textMuted mr-1">₹</span>
              <input 
                type="number" 
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full max-w-[200px] bg-transparent outline-none text-center placeholder:text-borderLight [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Income Classification Toggle (Only when Income is active) */}
          {type === 'INCOME' && (
            <div className="space-y-2 pt-1 border-t border-borderLight/60">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-textMain flex items-center gap-1">
                  <span>Classification</span>
                  <span className="text-[10px] text-textMuted font-normal">(Spend Rate Tracking)</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIncomeType('REGULAR');
                    setSelectedDebtId('');
                  }}
                  className={cn(
                    "p-2.5 rounded-xl border text-xs font-bold transition-all flex flex-col items-start gap-0.5 cursor-pointer text-left",
                    incomeType === 'REGULAR'
                      ? "bg-green-50 border-green-500 text-green-950 shadow-xs ring-1 ring-green-500"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <Briefcase size={14} className={incomeType === 'REGULAR' ? "text-green-600" : "text-textMuted"} />
                    <span>Regular / Earned</span>
                  </div>
                  <span className="text-[10px] font-normal text-textMuted">Salary, Business, Rent</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIncomeType('DEBT_RECOVERY')}
                  className={cn(
                    "p-2.5 rounded-xl border text-xs font-bold transition-all flex flex-col items-start gap-0.5 cursor-pointer text-left",
                    incomeType === 'DEBT_RECOVERY'
                      ? "bg-amber-50 border-amber-500 text-amber-950 shadow-xs ring-1 ring-amber-500"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold">
                    <HandCoins size={14} className={incomeType === 'DEBT_RECOVERY' ? "text-amber-600" : "text-textMuted"} />
                    <span>Debt Recovery</span>
                  </div>
                  <span className="text-[10px] font-normal text-textMuted">Returned loan principal</span>
                </button>
              </div>

              {/* Debt Recovery Person Selector */}
              {incomeType === 'DEBT_RECOVERY' && (
                <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2 animate-in fade-in">
                  <label className="text-xs font-bold text-amber-900 block">
                    Whom is this repayment from?
                  </label>

                  {debtorDebts.length > 0 ? (
                    <select
                      value={selectedDebtId}
                      onChange={(e) => {
                        setSelectedDebtId(e.target.value);
                        const found = debtorDebts.find(d => d.id === e.target.value);
                        if (found) {
                          setRawCategory(`Loan Repayment: ${found.person}`);
                        }
                      }}
                      className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-semibold text-slate-800 outline-none"
                    >
                      <option value="">-- Select Debtor from Active Loans --</option>
                      {debtorDebts.map(d => (
                        <option key={d.id} value={d.id}>
                          {d.person} (Pending: ₹{d.amount.toLocaleString('en-IN')})
                        </option>
                      ))}
                      <option value="__CUSTOM__">Other / Unlisted Debtor</option>
                    </select>
                  ) : null}

                  {(!selectedDebtId || selectedDebtId === '__CUSTOM__' || debtorDebts.length === 0) && (
                    <input
                      type="text"
                      value={customDebtorName}
                      onChange={(e) => {
                        setCustomDebtorName(e.target.value);
                        setRawCategory(e.target.value ? `Loan Repayment: ${e.target.value}` : '');
                      }}
                      placeholder="Debtor person's name (e.g. Suresh, Family Friend)"
                      className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  )}

                  {selectedDebtId && selectedDebtId !== '__CUSTOM__' && (
                    <label className="flex items-center space-x-2 text-[11px] font-semibold text-amber-950 cursor-pointer pt-0.5">
                      <input
                        type="checkbox"
                        checked={syncWithDebtLedger}
                        onChange={(e) => setSyncWithDebtLedger(e.target.checked)}
                        className="rounded text-amber-600 focus:ring-amber-500"
                      />
                      <span>Auto-record repayment against their loan balance in Debts</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Dynamic Category/Source Input */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-textMain">
              {type === 'EXPENSE' ? "Whom or What was this for?" : t('expenses.income_source', 'Source of Income')}
            </label>
            <div className="relative">
              <input
                type="text"
                value={rawCategory}
                onChange={(e) => setRawCategory(e.target.value)}
                placeholder={type === 'EXPENSE' ? "e.g., Petrol, Swiggy, Kiranam, Milk" : "e.g., Salary, Rent, Dividends"}
                className="w-full p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 focus:ring-1 focus:ring-primary-100 outline-none text-sm transition-all pr-12"
              />
              {hasSupport && (
                <button 
                  type="button"
                  onClick={startListening}
                  className={cn(
                    "absolute right-2.5 top-2.5 p-1.5 rounded-full transition-colors",
                    isListening ? "bg-red-100 text-red-600 animate-pulse" : "text-primary-600 bg-primary-50 hover:bg-primary-100"
                  )}
                  title="Voice input"
                >
                  <Mic size={16} />
                </button>
              )}
            </div>

            {/* Auto-Correct Pill */}
            {type === 'EXPENSE' && resolvedCategory && rawCategory.length > 2 && (
              <div className="flex items-center mt-1.5 p-2 bg-primary-50 text-primary-900 rounded-lg text-xs border border-primary-100 animate-in fade-in">
                <Wand2 size={14} className="mr-1.5 text-primary-600 shrink-0" />
                <span>
                  Grouped category: <strong className="font-bold text-primary-700">{resolvedCategory.categoryId}</strong> (Original label "{rawCategory.trim()}" preserved)
                </span>
              </div>
            )}
          </div>

          {/* Date, Time & Notes Input Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Date & Time Picker */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-textMain flex items-center">
                  <Calendar size={13} className="mr-1 text-primary-600" /> Date
                </label>
                <input
                  type="date"
                  value={txDate}
                  max={todayStr}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="w-full p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-textMain flex items-center">
                    <Clock size={13} className="mr-1 text-primary-600" /> Time
                  </label>
                  <button
                    type="button"
                    onClick={setLiveTimeToNow}
                    className="text-[10px] text-primary-600 hover:text-primary-800 font-bold flex items-center gap-0.5 cursor-pointer"
                    title="Refresh to live time"
                  >
                    <RefreshCw size={10} /> Live
                  </button>
                </div>
                <input
                  type="time"
                  value={txTime}
                  onChange={(e) => setTxTime(e.target.value)}
                  className="w-full p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain font-mono"
                />
              </div>
            </div>

            {/* Notes Input */}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-textMain">{t('expenses.notes')}</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('expenses.notes_ph')}
                className="w-full p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain"
              />
            </div>
          </div>

          {/* Save Button */}
          <button 
            type="button"
            onClick={handleSave}
            disabled={!amount || isSaved}
            className={cn(
              "w-full py-3 rounded-xl font-bold text-white text-sm transition-all shadow-soft flex items-center justify-center cursor-pointer",
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
                <CheckCircle2 className="mr-1.5" size={18} /> {t('expenses.saved')}
              </>
            ) : (
              t('expenses.save')
            )}
          </button>
        </CardContent>
      </Card>

      {/* ================= REAL SPENDING VS EARNED INCOME HEALTH CARD ================= */}
      <Card className="border border-slate-200/90 shadow-2xs bg-gradient-to-br from-white via-slate-50/50 to-primary-50/30 overflow-hidden">
        <CardContent className="p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center">
                <PieChart size={17} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-textMain">Spending Rate vs True Earnings</h3>
                <p className="text-[11px] text-textMuted">Distinguishes earned income from debt recovery</p>
              </div>
            </div>

            {/* Spending Rate Badge */}
            <span className={cn(
              "text-xs font-bold px-2.5 py-1 rounded-full border",
              spendRatePercentage <= 75
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : spendRatePercentage <= 100
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-red-50 text-red-800 border-red-200"
            )}>
              Spend Rate: {earnedIncome > 0 ? `${spendRatePercentage}%` : (totalExpenses > 0 ? '100%+' : '0%')}
            </span>
          </div>

          {/* Metric Grid: Earned Income vs Debt Recovery vs Total Expenses */}
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="p-2.5 rounded-xl bg-white border border-emerald-100 shadow-2xs">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">Earned Income</span>
              <span className="text-xs sm:text-sm font-extrabold text-emerald-900 mt-0.5 block truncate">
                ₹{earnedIncome.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Salary & Profit</span>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-amber-100 shadow-2xs">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Debt Recovered</span>
              <span className="text-xs sm:text-sm font-extrabold text-amber-900 mt-0.5 block truncate">
                ₹{debtRecoveryIncome.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Capital Returned</span>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-red-100 shadow-2xs">
              <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider block">Total Expenses</span>
              <span className="text-xs sm:text-sm font-extrabold text-red-900 mt-0.5 block truncate">
                ₹{totalExpenses.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Spending Outflow</span>
            </div>
          </div>

          {/* Health Status Insight Note */}
          <div className={cn(
            "p-3 rounded-xl border text-xs flex items-start space-x-2.5",
            spendRatePercentage <= 75
              ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
              : spendRatePercentage <= 100
                ? "bg-amber-50/70 border-amber-200 text-amber-950"
                : "bg-red-50/70 border-red-200 text-red-950"
          )}>
            {spendRatePercentage <= 75 ? (
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={16} className={spendRatePercentage <= 100 ? "text-amber-600 shrink-0 mt-0.5" : "text-red-600 shrink-0 mt-0.5"} />
            )}
            <div className="text-[11px] leading-relaxed">
              {earnedIncome === 0 && totalExpenses === 0 ? (
                <span>Log your salary and daily expenses to track whether your household is spending within real earnings.</span>
              ) : spendRatePercentage <= 75 ? (
                <span>
                  <strong>Healthy Household Budget!</strong> You have spent {spendRatePercentage}% of your earned income. Operational surplus: <strong className="text-emerald-700 font-bold">+₹{operationalSurplus.toLocaleString('en-IN')}</strong>. Debt recoveries remain safely in reserve!
                </span>
              ) : spendRatePercentage <= 100 ? (
                <span>
                  <strong>Approaching Budget Limit:</strong> You have spent {spendRatePercentage}% of your earned revenue. Remaining surplus: <strong className="text-amber-700 font-bold">+₹{operationalSurplus.toLocaleString('en-IN')}</strong>. Monitor non-essential spends.
                </span>
              ) : (
                <span>
                  <strong>Deficit Warning ({spendRatePercentage}% spent):</strong> Expenses exceed earned revenue by <strong className="text-red-700 font-bold">₹{Math.abs(operationalSurplus).toLocaleString('en-IN')}</strong>! {debtRecoveryIncome > 0 ? "You are burning through recovered loan capital to fund day-to-day spending." : "You are dipping into reserves or debt."}
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ================= TRANSACTION HISTORY & LOG SECTION ================= */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            <History size={18} className="text-primary-600" />
            <h3 className="font-bold text-base text-textMain tracking-tight">Transaction History</h3>
          </div>
          <span className="text-xs text-textMuted font-semibold">
            {filteredHistory.length} logs
          </span>
        </div>

        {/* 4-Section Slider [ ALL | EXPENSES | EARNED INCOME | DEBT RECOVERY ] */}
        <div className="bg-primary-50/80 p-1 rounded-xl border border-primary-200/60 flex space-x-1 shadow-2xs overflow-x-auto scrollbar-hide">
          <button 
            type="button"
            onClick={() => setHistoryTab('ALL')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'ALL' ? "bg-white shadow text-primary-900 border border-primary-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            All Logs
          </button>
          <button 
            type="button"
            onClick={() => setHistoryTab('EXPENSE')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'EXPENSE' ? "bg-white shadow text-red-600 border border-red-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Expenses
          </button>
          <button 
            type="button"
            onClick={() => setHistoryTab('EARNED_INCOME')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'EARNED_INCOME' ? "bg-white shadow text-green-700 border border-green-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Earned Income
          </button>
          <button 
            type="button"
            onClick={() => setHistoryTab('DEBT_RECOVERY')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'DEBT_RECOVERY' ? "bg-white shadow text-amber-800 border border-amber-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Debt Recovery
          </button>
        </div>

        {/* Search Bar & Date / Month / Year Filter Controls */}
        <div className="space-y-2 bg-surface p-3 rounded-2xl border border-borderLight shadow-2xs">
          {/* Search Bar with Search Icon */}
          <div className="relative">
            <Search size={15} className="absolute left-3 top-3 text-textMuted" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by label (e.g. Petrol), category, debtor name, or notes..."
              className="w-full pl-9 pr-8 py-2 bg-background rounded-xl border border-borderLight text-xs focus:border-primary-400 outline-none"
            />
            {searchQuery && (
              <button 
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-textMuted hover:text-textMain"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Month, Year & Date Specific Dropdowns */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {/* Month Filter */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="p-2 bg-background rounded-xl border border-borderLight text-textMain outline-none text-xs"
            >
              <option value="ALL">All Months</option>
              {monthsList.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>

            {/* Year Filter */}
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="p-2 bg-background rounded-xl border border-borderLight text-textMain outline-none text-xs"
            >
              <option value="ALL">All Years</option>
              {availableYears.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
            </select>

            {/* Specific Day Picker */}
            <input
              type="date"
              value={specificDateFilter}
              max={todayStr}
              onChange={(e) => setSpecificDateFilter(e.target.value)}
              title="Filter by exact day"
              className="p-1.5 bg-background rounded-xl border border-borderLight text-textMain outline-none text-[11px]"
            />
          </div>

          {/* Clear Filters Indicator */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-1 text-[11px]">
              <span className="text-amber-800 font-semibold">Active filters applied</span>
              <button 
                type="button" 
                onClick={clearAllFilters}
                className="text-primary-600 hover:text-primary-700 font-bold hover:underline cursor-pointer"
              >
                Clear all filters
              </button>
            </div>
          )}
        </div>

        {/* Grouped Month History List */}
        <div className="space-y-4 pt-1">
          {groupedByMonth.map(group => (
            <div key={group.monthKey} className="space-y-2">
              {/* Month Header Banner */}
              <div className="flex items-center justify-between bg-slate-100/80 px-3.5 py-1.5 rounded-lg border border-borderLight text-xs font-bold text-slate-800">
                <span>{group.monthKey}</span>
                <div className="flex items-center space-x-3 text-[11px]">
                  {group.totalExpense > 0 && (
                    <span className="text-red-600">Exp: -₹{group.totalExpense.toLocaleString('en-IN')}</span>
                  )}
                  {group.totalIncome > 0 && (
                    <span className="text-green-700">Inc: +₹{group.totalIncome.toLocaleString('en-IN')}</span>
                  )}
                </div>
              </div>

              {/* Transactions in this month */}
              <div className="space-y-2">
                {group.items.map(tx => {
                  const isExpense = tx.type === 'EXPENSE';
                  const displayTitle = tx.label || tx.categoryId;
                  const hasCustomLabel = tx.label && tx.label.trim().toLowerCase() !== tx.categoryId.trim().toLowerCase();

                  return (
                    <div 
                      key={tx.id}
                      className="p-3 bg-surface rounded-xl border border-borderLight shadow-2xs hover:shadow-sm transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        {/* Type Icon */}
                        <div className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                          isExpense 
                            ? "bg-red-50 text-red-600" 
                            : tx.incomeType === 'DEBT_RECOVERY'
                              ? "bg-amber-50 text-amber-700"
                              : "bg-green-50 text-green-600"
                        )}>
                          {isExpense ? (
                            <ArrowDownRight size={18} />
                          ) : tx.incomeType === 'DEBT_RECOVERY' ? (
                            <HandCoins size={17} />
                          ) : (
                            <ArrowUpRight size={18} />
                          )}
                        </div>

                        {/* Title, Category & Timestamp */}
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="font-bold text-sm text-textMain truncate max-w-[130px] sm:max-w-[200px]">
                              {displayTitle}
                            </span>

                            {tx.type === 'INCOME' && tx.incomeType === 'DEBT_RECOVERY' && (
                              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.2 rounded-full border border-amber-200 shrink-0">
                                🤝 Debt Recovery {tx.debtorName ? `(${tx.debtorName})` : ''}
                              </span>
                            )}

                            {tx.type === 'INCOME' && tx.incomeType !== 'DEBT_RECOVERY' && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.2 rounded-full border border-emerald-200 shrink-0">
                                💼 Earned
                              </span>
                            )}

                            {hasCustomLabel && (
                              <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.2 rounded-full border border-slate-200 shrink-0">
                                {tx.categoryId}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center space-x-2 text-[11px] text-textMuted mt-0.5">
                            <span className="flex items-center">
                              <Clock size={11} className="mr-1 text-slate-400" />
                              {format(new Date(tx.date), 'dd MMM yyyy, hh:mm a')}
                            </span>
                            {tx.notes && (
                              <span className="truncate max-w-[110px] sm:max-w-[180px] italic">
                                · "{tx.notes}"
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Amount & Delete */}
                      <div className="flex items-center space-x-2 shrink-0">
                        <span className={cn(
                          "font-bold text-sm sm:text-base",
                          isExpense ? "text-textMain" : "text-green-600"
                        )}>
                          {isExpense ? '-' : '+'}₹{tx.amount.toLocaleString('en-IN')}
                        </span>
                        <button 
                          type="button"
                          onClick={() => handleDeleteTx(tx)}
                          className="text-textMuted hover:text-red-500 p-1.5 transition-colors cursor-pointer"
                          title="Delete transaction log"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {groupedByMonth.length === 0 && (
            <div className="p-8 bg-surface rounded-2xl border border-borderLight text-center space-y-2 shadow-2xs">
              <History size={32} className="mx-auto text-textMuted/50" />
              <p className="text-sm font-semibold text-textMain">No transaction logs found</p>
              <p className="text-xs text-textMuted">
                {hasActiveFilters 
                  ? "Try clearing your search query or month/date filters above." 
                  : "Add your first expense or income using the form above."}
              </p>
              {hasActiveFilters && (
                <button 
                  type="button" 
                  onClick={clearAllFilters}
                  className="mt-2 px-3 py-1 bg-primary-50 text-primary-700 rounded-lg text-xs font-bold hover:bg-primary-100 cursor-pointer"
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Transaction Confirmation Heads-Up Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTargetTx}
        title="Delete Transaction"
        itemName={deleteTargetTx ? `${deleteTargetTx.type === 'EXPENSE' ? '-' : '+'}₹${deleteTargetTx.amount.toLocaleString('en-IN')} (${deleteTargetTx.label || deleteTargetTx.categoryId})` : ''}
        message="Are you sure you want to permanently delete this transaction from your history? This action cannot be undone."
        onConfirm={async () => {
          if (deleteTargetTx) {
            await deleteTransaction(deleteTargetTx.id);
            setDeleteTargetTx(null);
            await fetchTransactions();
          }
        }}
        onCancel={() => setDeleteTargetTx(null)}
      />

    </div>
  );
};

export default Expenses;
