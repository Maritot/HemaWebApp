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
  AlertTriangle,
  Landmark,
  CreditCard,
  Send,
  Zap
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveCategory, ResolvedCategory } from '@/lib/AutoCorrectEngine';
import { 
  addTransaction, 
  getTransactions, 
  deleteTransaction, 
  getDebts,
  addDebt,
  recordAtomicDebtPaymentAndCashflow,
  validateTimestampInvariant,
  HemaDB, 
  DebtRecordItem, 
  CashflowClassification 
} from '@/lib/db';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { format, isSameDay, subDays } from 'date-fns';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useAuth } from '@/context/AuthContext';

type HistoryFilterType = 'ALL' | 'LIVING_EXPENSE' | 'EARNED_INCOME' | 'DEBT_MOVEMENTS';

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
  
  // Temporal Invariants (Past & Now Only - No Future Dating)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState(() => format(new Date(), 'HH:mm'));

  // Detailed Cashflow Classification
  const [cashflowCategory, setCashflowCategory] = useState<CashflowClassification>('LIVING_EXPENSE');
  
  // Debts linking state
  const [activeDebts, setActiveDebts] = useState<DebtRecordItem[]>([]);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [peerPersonName, setPeerPersonName] = useState<string>('');

  // All Transactions for History Log
  const [allTransactions, setAllTransactions] = useState<HemaDB['transactions']['value'][]>([]);

  // History Filter state
  const [historyTab, setHistoryTab] = useState<HistoryFilterType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [specificDateFilter, setSpecificDateFilter] = useState<string>('');
  const [deleteTargetTx, setDeleteTargetTx] = useState<HemaDB['transactions']['value'] | null>(null);

  // Quick Timestamp Presets
  const setQuickTime = (preset: 'now' | 'earlier' | 'yesterday') => {
    const now = new Date();
    if (preset === 'now') {
      setTxDate(todayStr);
      setTxTime(format(now, 'HH:mm'));
    } else if (preset === 'earlier') {
      setTxDate(todayStr);
      const earlierHour = Math.max(0, now.getHours() - 3);
      setTxTime(`${String(earlierHour).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
    } else if (preset === 'yesterday') {
      const yesterday = subDays(now, 1);
      setTxDate(yesterday.toISOString().split('T')[0]);
      setTxTime('18:00');
    }
  };

  // Enforce no future time when date is today
  useEffect(() => {
    if (txDate === todayStr) {
      const currentLiveTime = format(new Date(), 'HH:mm');
      if (txTime > currentLiveTime) {
        setTxTime(currentLiveTime);
      }
    }
  }, [txDate, txTime, todayStr]);

  const fetchTransactions = async () => {
    const [txs, debts] = await Promise.all([
      getTransactions(),
      getDebts()
    ]);
    const sorted = txs.sort((a, b) => b.date - a.date);
    setAllTransactions(sorted);
    setActiveDebts(debts);

    const totalInc = sorted.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const totalExp = sorted.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    setBalance(totalInc - totalExp);
  };

  useEffect(() => {
    fetchTransactions();
  }, [user?.id]);

  const handleTypeChange = (newType: 'EXPENSE' | 'INCOME') => {
    setType(newType);
    setSelectedDebtId('');
    setPeerPersonName('');
    if (newType === 'INCOME') {
      setCashflowCategory('EARNED_INCOME');
    } else {
      setCashflowCategory('LIVING_EXPENSE');
    }
  };

  // Sync voice input
  useEffect(() => {
    if (voiceText) {
      setRawCategory(voiceText);
    }
  }, [voiceText]);

  // Auto-correct category for expenses
  useEffect(() => {
    if (rawCategory.length > 2 && type === 'EXPENSE' && cashflowCategory === 'LIVING_EXPENSE') {
      const timer = setTimeout(() => {
        setResolvedCategory(resolveCategory(rawCategory));
      }, 350);
      return () => clearTimeout(timer);
    } else {
      setResolvedCategory(null);
    }
  }, [rawCategory, type, cashflowCategory]);

  const handleSave = async () => {
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
    
    // Combine Date + Time
    let timestamp = Date.now();
    if (txDate) {
      const [year, month, day] = txDate.split('-').map(Number);
      const [hours, minutes] = (txTime || format(new Date(), 'HH:mm')).split(':').map(Number);
      const dateObj = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0);
      timestamp = validateTimestampInvariant(dateObj.getTime());
    }

    const amt = Number(amount);
    let finalLabel = rawCategory.trim();
    let finalCategory = 'General';
    let debtId: string | undefined = undefined;
    let debtorName: string | undefined = undefined;

    // --- CASE 1: Income -> Friend Repaid (Debt Recovery) ---
    if (type === 'INCOME' && cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL') {
      finalCategory = 'Debt Recovery';
      if (selectedDebtId && selectedDebtId !== '__CUSTOM__') {
        const found = activeDebts.find(d => d.id === selectedDebtId);
        debtorName = found ? found.person : peerPersonName.trim();
        debtId = selectedDebtId;
      } else {
        debtorName = peerPersonName.trim() || 'Debtor';
      }
      finalLabel = finalLabel || `Repayment from ${debtorName}`;

      // Use atomic sync helper if linked to active debt
      if (debtId) {
        await recordAtomicDebtPaymentAndCashflow({
          debtId,
          amount: amt,
          date: timestamp,
          notes: notes.trim() || undefined,
          syncToCashflow: true
        });
        setIsSaved(true);
        await fetchTransactions();
        resetForm();
        return;
      }
    }

    // --- CASE 2: Income -> Borrowed Loan Taken ---
    else if (type === 'INCOME' && cashflowCategory === 'DEBT_INFLOW_BORROWED') {
      finalCategory = 'Loan Borrowed';
      debtorName = peerPersonName.trim() || 'Creditor';
      finalLabel = finalLabel || `Borrowed from ${debtorName}`;

      // Auto-create debt record (WE_OWE) in Debts module
      try {
        const createdDebt = await addDebt({
          person: debtorName,
          amount: amt,
          principalAmount: amt,
          type: 'WE_OWE',
          status: 'PENDING',
          dueDate: Date.now() + 30 * 86400000,
          dateCreated: timestamp,
          notes: notes.trim() ? `Borrowed: ${notes.trim()}` : 'Hand loan taken',
          payments: []
        } as any);
        debtId = (createdDebt as any)?.id;
      } catch (err) {
        console.warn('Could not auto-create debt record:', err);
      }
    }

    // --- CASE 3: Expense -> Money Lent to Someone ---
    else if (type === 'EXPENSE' && cashflowCategory === 'LOAN_GIVEN_OUTFLOW') {
      finalCategory = 'Loan Given';
      debtorName = peerPersonName.trim() || 'Borrower';
      finalLabel = finalLabel || `Lent to ${debtorName}`;

      // Auto-create debt record (OWED_TO_US) in Debts module
      try {
        const createdDebt = await addDebt({
          person: debtorName,
          amount: amt,
          principalAmount: amt,
          type: 'OWED_TO_US',
          status: 'PENDING',
          dueDate: Date.now() + 30 * 86400000,
          dateCreated: timestamp,
          notes: notes.trim() ? `Lent: ${notes.trim()}` : 'Hand loan given out',
          payments: []
        } as any);
        debtId = (createdDebt as any)?.id;
      } catch (err) {
        console.warn('Could not auto-create debt record:', err);
      }
    }

    // --- CASE 4: Expense -> Repaying Borrowed Loan ---
    else if (type === 'EXPENSE' && cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW') {
      finalCategory = 'Loan Repayment';
      if (selectedDebtId && selectedDebtId !== '__CUSTOM__') {
        const found = activeDebts.find(d => d.id === selectedDebtId);
        debtorName = found ? found.person : peerPersonName.trim();
        debtId = selectedDebtId;
      } else {
        debtorName = peerPersonName.trim() || 'Creditor';
      }
      finalLabel = finalLabel || `Repayment to ${debtorName}`;

      if (debtId) {
        await recordAtomicDebtPaymentAndCashflow({
          debtId,
          amount: amt,
          date: timestamp,
          notes: notes.trim() || undefined,
          syncToCashflow: true
        });
        setIsSaved(true);
        await fetchTransactions();
        resetForm();
        return;
      }
    }

    // --- CASE 5: Standard Operating Income or Living Expense ---
    else {
      if (type === 'EXPENSE') {
        finalCategory = resolvedCategory ? resolvedCategory.categoryId : (finalLabel || 'Living Expense');
      } else {
        finalCategory = finalLabel || 'Salary';
      }
    }

    await addTransaction({
      id: crypto.randomUUID(),
      amount: amt,
      categoryId: finalCategory,
      label: finalLabel || finalCategory,
      type: type,
      cashflowCategory: cashflowCategory,
      incomeType: (type === 'INCOME' && cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL') ? 'DEBT_RECOVERY' : 'REGULAR',
      debtId: debtId,
      debtorName: debtorName,
      date: timestamp,
      notes: notes.trim()
    });

    setIsSaved(true);
    await fetchTransactions();
    resetForm();
  };

  const resetForm = () => {
    setTimeout(() => {
      setIsSaved(false);
      setAmount('');
      setRawCategory('');
      setNotes('');
      setTxDate(todayStr);
      setTxTime(format(new Date(), 'HH:mm'));
      setResolvedCategory(null);
      setSelectedDebtId('');
      setPeerPersonName('');
    }, 1200);
  };

  const handleDeleteTx = (tx: HemaDB['transactions']['value']) => {
    setDeleteTargetTx(tx);
  };

  // Spending Rate & Financial Health Analysis (True P&L)
  const earnedIncome = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'INCOME' && (
        t.cashflowCategory === 'EARNED_INCOME' || 
        t.cashflowCategory === 'ASSET_PROFIT' || 
        (!t.cashflowCategory && t.incomeType !== 'DEBT_RECOVERY')
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const debtInflow = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'INCOME' && (
        t.cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' || 
        t.cashflowCategory === 'DEBT_INFLOW_BORROWED' ||
        (!t.cashflowCategory && t.incomeType === 'DEBT_RECOVERY')
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const livingExpenses = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'EXPENSE' && (
        t.cashflowCategory === 'LIVING_EXPENSE' || 
        !t.cashflowCategory
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  const debtOutflow = useMemo(() => {
    return allTransactions
      .filter(t => t.type === 'EXPENSE' && (
        t.cashflowCategory === 'LOAN_GIVEN_OUTFLOW' || 
        t.cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW'
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [allTransactions]);

  // True Spending Rate: Living Spends / Earned Income * 100
  const spendRatePercentage = useMemo(() => {
    if (earnedIncome <= 0) {
      return livingExpenses > 0 ? 100 : 0;
    }
    return Math.round((livingExpenses / earnedIncome) * 100);
  }, [earnedIncome, livingExpenses]);

  const trueNetSavings = earnedIncome - livingExpenses;

  // Filtered transactions for the history log
  const filteredHistory = useMemo(() => {
    return allTransactions.filter(tx => {
      // 1. History Tab filter
      if (historyTab === 'LIVING_EXPENSE' && (tx.type !== 'EXPENSE' || tx.cashflowCategory === 'LOAN_GIVEN_OUTFLOW' || tx.cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW')) return false;
      if (historyTab === 'EARNED_INCOME' && (tx.type !== 'INCOME' || tx.incomeType === 'DEBT_RECOVERY' || tx.cashflowCategory === 'DEBT_INFLOW_BORROWED')) return false;
      if (historyTab === 'DEBT_MOVEMENTS' && (!tx.debtId && tx.incomeType !== 'DEBT_RECOVERY' && !['DEBT_RECOVERY_PRINCIPAL', 'DEBT_INFLOW_BORROWED', 'LOAN_GIVEN_OUTFLOW', 'DEBT_REPAYMENT_OUTFLOW'].includes(tx.cashflowCategory as any))) return false;

      // 2. Specific date filter
      if (specificDateFilter) {
        const targetDate = new Date(specificDateFilter);
        if (!isSameDay(new Date(tx.date), targetDate)) return false;
      }

      const txDateObj = new Date(tx.date);

      // 3. Month filter
      if (selectedMonth !== 'ALL' && txDateObj.getMonth() !== Number(selectedMonth)) return false;

      // 4. Year filter
      if (selectedYear !== 'ALL' && String(txDateObj.getFullYear()) !== selectedYear) return false;

      // 5. Search query
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
      if (!map.has(key)) map.set(key, []);
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
      
      {/* Header & Main Mode Switcher */}
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

      {/* Main Add Form Card */}
      <Card className="border border-borderLight shadow-sm">
        <CardContent className="p-4 sm:p-5 space-y-4">
          
          {/* Available Cash Balance Header */}
          <div className="flex items-center justify-between bg-primary-50/80 px-3.5 py-2.5 rounded-xl border border-primary-100">
            <div className="flex items-center text-primary-900 text-xs font-semibold">
              <Wallet size={15} className="mr-1.5 text-primary-600" />
              <span>Available Wallet Liquidity</span>
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

          {/* Dynamic Classification Category Selector */}
          <div className="space-y-2 pt-1 border-t border-borderLight/60">
            <label className="text-xs font-bold text-textMain flex items-center justify-between">
              <span>{type === 'INCOME' ? 'Inflow Classification' : 'Outflow Nature'}</span>
              <span className="text-[10px] text-textMuted font-normal">Isolates Salary from Debts</span>
            </label>

            {/* Income 3-Way Classification */}
            {type === 'INCOME' ? (
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <button
                  type="button"
                  onClick={() => setCashflowCategory('EARNED_INCOME')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'EARNED_INCOME'
                      ? "bg-green-50 border-green-500 text-green-950 ring-1 ring-green-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <Briefcase size={14} className={cashflowCategory === 'EARNED_INCOME' ? "text-green-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Salary & Profits</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCashflowCategory('DEBT_RECOVERY_PRINCIPAL')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL'
                      ? "bg-amber-50 border-amber-500 text-amber-950 ring-1 ring-amber-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <HandCoins size={14} className={cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' ? "text-amber-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Friend Repaid Me</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCashflowCategory('DEBT_INFLOW_BORROWED')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'DEBT_INFLOW_BORROWED'
                      ? "bg-blue-50 border-blue-500 text-blue-950 ring-1 ring-blue-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <Landmark size={14} className={cashflowCategory === 'DEBT_INFLOW_BORROWED' ? "text-blue-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Loan Taken by Me</span>
                </button>
              </div>
            ) : (
              /* Expense 3-Way Classification */
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <button
                  type="button"
                  onClick={() => setCashflowCategory('LIVING_EXPENSE')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'LIVING_EXPENSE'
                      ? "bg-red-50 border-red-500 text-red-950 ring-1 ring-red-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <IndianRupee size={14} className={cashflowCategory === 'LIVING_EXPENSE' ? "text-red-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Living Expense</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCashflowCategory('LOAN_GIVEN_OUTFLOW')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'LOAN_GIVEN_OUTFLOW'
                      ? "bg-amber-50 border-amber-500 text-amber-950 ring-1 ring-amber-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <Send size={14} className={cashflowCategory === 'LOAN_GIVEN_OUTFLOW' ? "text-amber-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Money I Lent</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCashflowCategory('DEBT_REPAYMENT_OUTFLOW')}
                  className={cn(
                    "p-2 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 cursor-pointer",
                    cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW'
                      ? "bg-purple-50 border-purple-500 text-purple-950 ring-1 ring-purple-500 shadow-2xs"
                      : "bg-surface border-borderLight text-textMuted hover:border-slate-300"
                  )}
                >
                  <CreditCard size={14} className={cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW' ? "text-purple-600" : "text-textMuted"} />
                  <span className="text-[11px] leading-tight">Loan Repaid by Me</span>
                </button>
              </div>
            )}

            {/* Debt Selection Drawer if linked category is chosen */}
            {(cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' || cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW') && (
              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2 animate-in fade-in">
                <label className="text-xs font-bold text-amber-950 block">
                  {cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' ? 'Select Debtor Who Repaid:' : 'Select Creditor You Repaid:'}
                </label>
                
                <select
                  value={selectedDebtId}
                  onChange={(e) => {
                    setSelectedDebtId(e.target.value);
                    const found = activeDebts.find(d => d.id === e.target.value);
                    if (found) setRawCategory(`${found.person} Repayment`);
                  }}
                  className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-semibold text-slate-800 outline-none"
                >
                  <option value="">-- Choose from Active Khata Loans --</option>
                  {activeDebts
                    .filter(d => cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' ? d.type === 'OWED_TO_US' : d.type === 'WE_OWE')
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.person} (Pending: ₹{d.amount.toLocaleString('en-IN')})
                      </option>
                    ))}
                  <option value="__CUSTOM__">Other / Unlisted Person</option>
                </select>

                {(!selectedDebtId || selectedDebtId === '__CUSTOM__') && (
                  <input
                    type="text"
                    value={peerPersonName}
                    onChange={(e) => setPeerPersonName(e.target.value)}
                    placeholder="Enter person's name (e.g. Suresh, Relative)"
                    className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400"
                  />
                )}
              </div>
            )}

            {(cashflowCategory === 'DEBT_INFLOW_BORROWED' || cashflowCategory === 'LOAN_GIVEN_OUTFLOW') && (
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-xl space-y-2 animate-in fade-in">
                <label className="text-xs font-bold text-blue-950 block">
                  {cashflowCategory === 'DEBT_INFLOW_BORROWED' ? 'Who gave you this loan?' : 'To whom did you lend this money?'}
                </label>
                <input
                  type="text"
                  value={peerPersonName}
                  onChange={(e) => setPeerPersonName(e.target.value)}
                  placeholder="Enter person or bank name (e.g. Bank Gold Loan, Ramesh)"
                  className="w-full p-2 bg-white rounded-lg border border-blue-300 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400"
                />
                <p className="text-[10px] text-blue-800">
                  ⚡ Auto-creates a new record in your Debts & Khata module automatically.
                </p>
              </div>
            )}
          </div>

          {/* Dynamic Category/Source Input for Living Spends / Salary */}
          {(cashflowCategory === 'LIVING_EXPENSE' || cashflowCategory === 'EARNED_INCOME') && (
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
                  className="w-full p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm pr-12"
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

              {type === 'EXPENSE' && resolvedCategory && rawCategory.length > 2 && (
                <div className="flex items-center mt-1.5 p-2 bg-primary-50 text-primary-900 rounded-lg text-xs border border-primary-100 animate-in fade-in">
                  <Wand2 size={14} className="mr-1.5 text-primary-600 shrink-0" />
                  <span>
                    Grouped category: <strong className="font-bold text-primary-700">{resolvedCategory.categoryId}</strong>
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Quick Date/Time Chips (Past & Now Only) */}
          <div className="space-y-1.5 pt-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-textMuted uppercase tracking-wider">Quick Presets</span>
              <span className="text-[10px] text-textMuted">Past & Present Only</span>
            </div>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setQuickTime('now')}
                className="flex-1 py-1 px-2 rounded-lg bg-primary-50 hover:bg-primary-100 text-primary-800 text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer border border-primary-200"
              >
                <Zap size={11} className="text-amber-500" />
                <span>Just Now</span>
              </button>
              <button
                type="button"
                onClick={() => setQuickTime('earlier')}
                className="flex-1 py-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
              >
                Earlier Today
              </button>
              <button
                type="button"
                onClick={() => setQuickTime('yesterday')}
                className="flex-1 py-1 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-bold cursor-pointer"
              >
                Yesterday
              </button>
            </div>
          </div>

          {/* Date, Time & Notes Input Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <label className="text-xs font-semibold text-textMain flex items-center">
                  <Clock size={13} className="mr-1 text-primary-600" /> Time
                </label>
                <input
                  type="time"
                  value={txTime}
                  max={txDate === todayStr ? format(new Date(), 'HH:mm') : undefined}
                  onChange={(e) => setTxTime(e.target.value)}
                  className="w-full p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain font-mono"
                />
              </div>
            </div>

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

      {/* REAL SPENDING VS TRUE EARNED INCOME (P&L HEALTH CARD) */}
      <Card className="border border-slate-200/90 shadow-2xs bg-gradient-to-br from-white via-slate-50/50 to-primary-50/30 overflow-hidden">
        <CardContent className="p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-xl bg-primary-100 text-primary-700 flex items-center justify-center">
                <PieChart size={17} />
              </div>
              <div>
                <h3 className="font-bold text-sm text-textMain">True Household P&L Scorecard</h3>
                <p className="text-[11px] text-textMuted">Salary vs Living Spends (Excludes Loans)</p>
              </div>
            </div>

            {/* Spend Rate Badge */}
            <span className={cn(
              "text-xs font-bold px-2.5 py-1 rounded-full border",
              spendRatePercentage <= 75
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : spendRatePercentage <= 100
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-red-50 text-red-800 border-red-200"
            )}>
              Spend Rate: {earnedIncome > 0 ? `${spendRatePercentage}%` : (livingExpenses > 0 ? '100%+' : '0%')}
            </span>
          </div>

          {/* Metric Grid */}
          <div className="grid grid-cols-3 gap-2 text-center pt-1">
            <div className="p-2.5 rounded-xl bg-white border border-emerald-100 shadow-2xs">
              <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider block">True Earnings</span>
              <span className="text-xs sm:text-sm font-extrabold text-emerald-900 mt-0.5 block truncate">
                ₹{earnedIncome.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Salary & Yields</span>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-red-100 shadow-2xs">
              <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider block">Living Expenses</span>
              <span className="text-xs sm:text-sm font-extrabold text-red-900 mt-0.5 block truncate">
                ₹{livingExpenses.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Lifestyle Outflow</span>
            </div>

            <div className="p-2.5 rounded-xl bg-white border border-blue-100 shadow-2xs">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Debt Inflows</span>
              <span className="text-xs sm:text-sm font-extrabold text-blue-900 mt-0.5 block truncate">
                ₹{debtInflow.toLocaleString('en-IN')}
              </span>
              <span className="text-[9px] text-textMuted">Recovered/Borrowed</span>
            </div>
          </div>

          {/* Net Household Savings Summary */}
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
              {earnedIncome === 0 && livingExpenses === 0 ? (
                <span>Log your monthly salary and daily expenses to track whether your household is spending within real earnings.</span>
              ) : spendRatePercentage <= 75 ? (
                <span>
                  <strong>Healthy Surplus!</strong> You have spent {spendRatePercentage}% of your real earnings. True Net Savings: <strong className="text-emerald-700 font-bold">+₹{trueNetSavings.toLocaleString('en-IN')}</strong>. Debt recoveries remain safely in reserve!
                </span>
              ) : spendRatePercentage <= 100 ? (
                <span>
                  <strong>Caution (Break-Even Zone):</strong> You have spent {spendRatePercentage}% of your earned revenue. Net Surplus: <strong className="text-amber-700 font-bold">+₹{trueNetSavings.toLocaleString('en-IN')}</strong>.
                </span>
              ) : (
                <span>
                  <strong>Deficit Warning ({spendRatePercentage}% spent):</strong> Expenses exceed earned revenue by <strong className="text-red-700 font-bold">₹{Math.abs(trueNetSavings).toLocaleString('en-IN')}</strong>! You are spending borrowed money or dipping into capital reserves.
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TRANSACTION HISTORY & LOG SECTION */}
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

        {/* 4-Section Slider */}
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
            onClick={() => setHistoryTab('LIVING_EXPENSE')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'LIVING_EXPENSE' ? "bg-white shadow text-red-600 border border-red-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Living Expenses
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
            onClick={() => setHistoryTab('DEBT_MOVEMENTS')}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
              historyTab === 'DEBT_MOVEMENTS' ? "bg-white shadow text-amber-800 border border-amber-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Debt Movements
          </button>
        </div>

        {/* Search Bar & Filters */}
        <div className="space-y-2 bg-surface p-3 rounded-2xl border border-borderLight shadow-2xs">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-3 text-textMuted" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by label (e.g. Petrol), category, person, or notes..."
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

          <div className="grid grid-cols-3 gap-2 text-xs">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="p-2 bg-background rounded-xl border border-borderLight text-textMain outline-none text-xs"
            >
              <option value="ALL">All Months</option>
              {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, idx) => (
                <option key={m} value={String(idx)}>{m}</option>
              ))}
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="p-2 bg-background rounded-xl border border-borderLight text-textMain outline-none text-xs"
            >
              <option value="ALL">All Years</option>
              {Array.from(new Set(allTransactions.map(t => new Date(t.date).getFullYear()))).map(yr => (
                <option key={yr} value={String(yr)}>{yr}</option>
              ))}
            </select>

            <input
              type="date"
              value={specificDateFilter}
              max={todayStr}
              onChange={(e) => setSpecificDateFilter(e.target.value)}
              title="Filter by exact day"
              className="p-1.5 bg-background rounded-xl border border-borderLight text-textMain outline-none text-[11px]"
            />
          </div>

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

              <div className="space-y-2">
                {group.items.map(tx => {
                  const isExpense = tx.type === 'EXPENSE';
                  const displayTitle = tx.label || tx.categoryId;
                  const isDebtRecovery = tx.cashflowCategory === 'DEBT_RECOVERY_PRINCIPAL' || tx.incomeType === 'DEBT_RECOVERY';
                  const isBorrowing = tx.cashflowCategory === 'DEBT_INFLOW_BORROWED';
                  const isLoanGiven = tx.cashflowCategory === 'LOAN_GIVEN_OUTFLOW';
                  const isDebtRepaid = tx.cashflowCategory === 'DEBT_REPAYMENT_OUTFLOW';

                  return (
                    <div 
                      key={tx.id}
                      className="p-3 bg-surface rounded-xl border border-borderLight shadow-2xs hover:shadow-sm transition-all flex items-center justify-between"
                    >
                      <div className="flex items-center space-x-3 min-w-0">
                        <div className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
                          isExpense 
                            ? "bg-red-50 text-red-600" 
                            : isDebtRecovery
                              ? "bg-amber-50 text-amber-700"
                              : isBorrowing
                                ? "bg-blue-50 text-blue-700"
                                : "bg-green-50 text-green-600"
                        )}>
                          {isExpense ? (
                            isLoanGiven ? <Send size={16} /> : isDebtRepaid ? <CreditCard size={16} /> : <ArrowDownRight size={18} />
                          ) : isDebtRecovery ? (
                            <HandCoins size={17} />
                          ) : isBorrowing ? (
                            <Landmark size={16} />
                          ) : (
                            <ArrowUpRight size={18} />
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="font-bold text-sm text-textMain truncate max-w-[130px] sm:max-w-[200px]">
                              {displayTitle}
                            </span>

                            {isDebtRecovery && (
                              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.2 rounded-full border border-amber-200 shrink-0">
                                🤝 Recovered {tx.debtorName ? `(${tx.debtorName})` : ''}
                              </span>
                            )}

                            {isBorrowing && (
                              <span className="text-[10px] bg-blue-100 text-blue-900 font-bold px-2 py-0.2 rounded-full border border-blue-200 shrink-0">
                                🏦 Borrowed {tx.debtorName ? `(${tx.debtorName})` : ''}
                              </span>
                            )}

                            {isLoanGiven && (
                              <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.2 rounded-full border border-amber-200 shrink-0">
                                🤝 Lent Out {tx.debtorName ? `(${tx.debtorName})` : ''}
                              </span>
                            )}

                            {isDebtRepaid && (
                              <span className="text-[10px] bg-purple-100 text-purple-900 font-bold px-2 py-0.2 rounded-full border border-purple-200 shrink-0">
                                💳 Repaid Loan {tx.debtorName ? `(${tx.debtorName})` : ''}
                              </span>
                            )}

                            {!isDebtRecovery && !isBorrowing && tx.type === 'INCOME' && (
                              <span className="text-[10px] bg-emerald-100 text-emerald-800 font-bold px-2 py-0.2 rounded-full border border-emerald-200 shrink-0">
                                💼 Earned
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
                  ? "Try clearing your search query or filters above." 
                  : "Add your first expense or income using the form above."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Transaction Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTargetTx}
        title="Delete Transaction"
        itemName={deleteTargetTx ? `${deleteTargetTx.type === 'EXPENSE' ? '-' : '+'}₹${deleteTargetTx.amount.toLocaleString('en-IN')} (${deleteTargetTx.label || deleteTargetTx.categoryId})` : ''}
        message={
          deleteTargetTx?.debtId 
            ? "This transaction is linked to a loan in Debts. Deleting it will automatically restore the loan's balance. Are you sure?" 
            : "Are you sure you want to permanently delete this transaction from your history?"
        }
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
