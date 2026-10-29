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
  Briefcase,
  HandCoins,
  Landmark,
  CreditCard,
  Send,
  Zap,
  TrendingUp,
  Percent,
  Check
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
import { format, isSameDay } from 'date-fns';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useAuth } from '@/context/AuthContext';

type HistoryFilterType = 'ALL' | 'EXPENSE' | 'INCOME' | 'DEBT';

const POPULAR_EXPENSE_TAGS = ['Groceries', 'Food', 'Fuel', 'Bills', 'Shopping', 'Medicines', 'Loan to Friend'];
const POPULAR_INCOME_TAGS = ['Salary', 'Business/Profit', 'Rental', 'Friend Repaid Loan', 'Loan Taken'];

export const Expenses: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { text: voiceText, isListening, startListening, hasSupport } = useSpeechToText();

  // Mode: Expense or Income
  const [type, setType] = useState<'EXPENSE' | 'INCOME'>('EXPENSE');
  const [amount, setAmount] = useState('');
  const [categoryInput, setCategoryInput] = useState('');
  const [notes, setNotes] = useState('');
  const [resolvedCategory, setResolvedCategory] = useState<ResolvedCategory | null>(null);
  const [isSaved, setIsSaved] = useState(false);
  const [balance, setBalance] = useState<number>(0);

  // Temporal Invariants (Past & Present Only)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [txDate, setTxDate] = useState(todayStr);
  const [txTime, setTxTime] = useState(() => format(new Date(), 'HH:mm'));

  // Debt Integration (Simple 1-tap friend repayment linking)
  const [activeDebts, setActiveDebts] = useState<DebtRecordItem[]>([]);
  const [isDebtLinked, setIsDebtLinked] = useState(false);
  const [selectedDebtId, setSelectedDebtId] = useState<string>('');
  const [peerPersonName, setPeerPersonName] = useState<string>('');

  // Transactions list
  const [allTransactions, setAllTransactions] = useState<HemaDB['transactions']['value'][]>([]);

  // History Filter State
  const [historyTab, setHistoryTab] = useState<HistoryFilterType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [deleteTargetTx, setDeleteTargetTx] = useState<HemaDB['transactions']['value'] | null>(null);

  // Set live time
  const setLiveTime = () => {
    const now = new Date();
    setTxDate(todayStr);
    setTxTime(format(now, 'HH:mm'));
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

  // Load transactions and active debts
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

  // Auto-fill category from voice
  useEffect(() => {
    if (voiceText) {
      setCategoryInput(voiceText);
    }
  }, [voiceText]);

  // Auto-correct category for living expenses
  useEffect(() => {
    if (categoryInput.length > 2 && type === 'EXPENSE' && !isDebtLinked) {
      const timer = setTimeout(() => {
        setResolvedCategory(resolveCategory(categoryInput));
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setResolvedCategory(null);
    }
  }, [categoryInput, type, isDebtLinked]);

  // Handle switching tabs
  const handleTypeSwitch = (newType: 'EXPENSE' | 'INCOME') => {
    setType(newType);
    setIsDebtLinked(false);
    setSelectedDebtId('');
    setPeerPersonName('');
    setCategoryInput('');
  };

  // Tag chip selection
  const handleTagClick = (tag: string) => {
    if (tag === 'Friend Repaid Loan') {
      setIsDebtLinked(true);
      setCategoryInput('Debt Recovery');
      return;
    }
    if (tag === 'Loan to Friend') {
      setIsDebtLinked(true);
      setCategoryInput('Loan Given');
      return;
    }
    if (tag === 'Loan Taken') {
      setIsDebtLinked(true);
      setCategoryInput('Loan Borrowed');
      return;
    }
    setIsDebtLinked(false);
    setCategoryInput(tag);
  };

  // Save Transaction
  const handleSave = async () => {
    const numAmount = Number(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) return;

    // Build timestamp clamped to present
    let timestamp = Date.now();
    if (txDate) {
      const [year, month, day] = txDate.split('-').map(Number);
      const [hours, minutes] = (txTime || format(new Date(), 'HH:mm')).split(':').map(Number);
      const dateObj = new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0);
      timestamp = validateTimestampInvariant(dateObj.getTime());
    }

    let finalLabel = categoryInput.trim();
    let finalCategory = 'General';
    let cashflowCat: CashflowClassification = type === 'EXPENSE' ? 'LIVING_EXPENSE' : 'EARNED_INCOME';
    let debtId: string | undefined = undefined;
    let debtorName: string | undefined = undefined;

    // --- CASE A: Friend Repaid a Loan (Debt Recovery) ---
    if (type === 'INCOME' && (isDebtLinked || categoryInput.toLowerCase().includes('repaid') || categoryInput.toLowerCase().includes('debt recovery'))) {
      cashflowCat = 'DEBT_RECOVERY_PRINCIPAL';
      finalCategory = 'Debt Recovery';

      if (selectedDebtId && selectedDebtId !== '__CUSTOM__') {
        const found = activeDebts.find(d => d.id === selectedDebtId);
        debtorName = found ? found.person : peerPersonName.trim();
        debtId = selectedDebtId;
      } else {
        debtorName = peerPersonName.trim() || 'Debtor';
      }
      finalLabel = finalLabel || `Repayment from ${debtorName}`;

      // Atomic sync to Debts if linked
      if (debtId) {
        await recordAtomicDebtPaymentAndCashflow({
          debtId,
          amount: numAmount,
          date: timestamp,
          notes: notes.trim() || undefined,
          syncToCashflow: true
        });
        finishSave();
        return;
      }
    }

    // --- CASE B: Loan Taken by Me (Liability / Inflow) ---
    else if (type === 'INCOME' && (categoryInput.toLowerCase().includes('loan taken') || categoryInput.toLowerCase().includes('borrowed'))) {
      cashflowCat = 'DEBT_INFLOW_BORROWED';
      finalCategory = 'Loan Borrowed';
      debtorName = peerPersonName.trim() || 'Creditor';
      finalLabel = finalLabel || `Borrowed from ${debtorName}`;

      try {
        const created = await addDebt({
          person: debtorName,
          amount: numAmount,
          principalAmount: numAmount,
          type: 'WE_OWE',
          status: 'PENDING',
          dueDate: Date.now() + 30 * 86400000,
          dateCreated: timestamp,
          notes: notes.trim() ? `Borrowed: ${notes.trim()}` : 'Hand loan taken',
          payments: []
        } as any);
        debtId = (created as any)?.id;
      } catch (e) {}
    }

    // --- CASE C: Money Lent to Someone (Expense / Loan Asset) ---
    else if (type === 'EXPENSE' && (isDebtLinked || categoryInput.toLowerCase().includes('loan to') || categoryInput.toLowerCase().includes('lent to'))) {
      cashflowCat = 'LOAN_GIVEN_OUTFLOW';
      finalCategory = 'Loan Given';
      debtorName = peerPersonName.trim() || 'Borrower';
      finalLabel = finalLabel || `Lent to ${debtorName}`;

      try {
        const created = await addDebt({
          person: debtorName,
          amount: numAmount,
          principalAmount: numAmount,
          type: 'OWED_TO_US',
          status: 'PENDING',
          dueDate: Date.now() + 30 * 86400000,
          dateCreated: timestamp,
          notes: notes.trim() ? `Lent: ${notes.trim()}` : 'Hand loan given out',
          payments: []
        } as any);
        debtId = (created as any)?.id;
      } catch (e) {}
    }

    // --- CASE D: Standard Living Expense or Regular Income ---
    else {
      if (type === 'EXPENSE') {
        cashflowCat = 'LIVING_EXPENSE';
        finalCategory = resolvedCategory ? resolvedCategory.categoryId : (finalLabel || 'Living Expense');
      } else {
        cashflowCat = 'EARNED_INCOME';
        finalCategory = finalLabel || 'Salary';
      }
    }

    await addTransaction({
      id: crypto.randomUUID(),
      amount: numAmount,
      categoryId: finalCategory,
      label: finalLabel || finalCategory,
      type: type,
      cashflowCategory: cashflowCat,
      incomeType: (type === 'INCOME' && cashflowCat === 'DEBT_RECOVERY_PRINCIPAL') ? 'DEBT_RECOVERY' : 'REGULAR',
      debtId: debtId,
      debtorName: debtorName,
      date: timestamp,
      notes: notes.trim()
    });

    finishSave();
  };

  const finishSave = async () => {
    setIsSaved(true);
    await fetchTransactions();
    setTimeout(() => {
      setIsSaved(false);
      setAmount('');
      setCategoryInput('');
      setNotes('');
      setTxDate(todayStr);
      setTxTime(format(new Date(), 'HH:mm'));
      setResolvedCategory(null);
      setIsDebtLinked(false);
      setSelectedDebtId('');
      setPeerPersonName('');
    }, 1000);
  };

  // --- Financial Health Calculations (Isolate Salary from Debt Receipts) ---
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

  const trueNetSavings = earnedIncome - livingExpenses;

  const spendRate = useMemo(() => {
    if (earnedIncome <= 0) return livingExpenses > 0 ? 100 : 0;
    return Math.min(100, Math.round((livingExpenses / earnedIncome) * 100));
  }, [earnedIncome, livingExpenses]);

  // Filtered History
  const filteredHistory = useMemo(() => {
    return allTransactions.filter(tx => {
      // 1. Tab filter
      if (historyTab === 'EXPENSE' && tx.type !== 'EXPENSE') return false;
      if (historyTab === 'INCOME' && tx.type !== 'INCOME') return false;
      if (historyTab === 'DEBT' && (!tx.debtId && tx.incomeType !== 'DEBT_RECOVERY' && !['DEBT_RECOVERY_PRINCIPAL', 'DEBT_INFLOW_BORROWED', 'LOAN_GIVEN_OUTFLOW', 'DEBT_REPAYMENT_OUTFLOW'].includes(tx.cashflowCategory as any))) return false;

      const txDateObj = new Date(tx.date);

      // 2. Month filter
      if (selectedMonth !== 'ALL' && txDateObj.getMonth() !== Number(selectedMonth)) return false;

      // 3. Year filter
      if (selectedYear !== 'ALL' && String(txDateObj.getFullYear()) !== selectedYear) return false;

      // 4. Search query
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
  }, [allTransactions, historyTab, selectedMonth, selectedYear, searchQuery]);

  // Grouped by Month
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

  return (
    <div className="space-y-4 animate-in fade-in duration-300 pb-24">
      
      {/* --- Top 2-Tab Mode Switcher --- */}
      <div className="flex justify-center">
        <div className="bg-slate-100 p-1 rounded-2xl flex space-x-1 w-full max-w-sm shadow-inner border border-slate-200/80">
          <button 
            type="button"
            onClick={() => handleTypeSwitch('EXPENSE')}
            className={cn(
              "flex-1 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5",
              type === 'EXPENSE' 
                ? "bg-red-600 text-white shadow-sm" 
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <ArrowDownRight size={16} />
            <span>Expense</span>
          </button>
          <button 
            type="button"
            onClick={() => handleTypeSwitch('INCOME')}
            className={cn(
              "flex-1 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center justify-center space-x-1.5",
              type === 'INCOME' 
                ? "bg-emerald-600 text-white shadow-sm" 
                : "text-slate-600 hover:text-slate-900"
            )}
          >
            <ArrowUpRight size={16} />
            <span>Income</span>
          </button>
        </div>
      </div>

      {/* --- Main Entry Card --- */}
      <Card className="border border-slate-200 shadow-xs rounded-2xl overflow-hidden">
        <CardContent className="p-4 sm:p-5 space-y-4">
          
          {/* Available Balance Pill */}
          <div className="flex items-center justify-between bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200 text-xs">
            <div className="flex items-center text-slate-700 font-semibold">
              <Wallet size={14} className="mr-1.5 text-amber-600" />
              <span>Available Cash</span>
            </div>
            <span className={cn(
              "font-bold text-sm",
              balance >= 0 ? "text-slate-900" : "text-red-600"
            )}>
              ₹{balance.toLocaleString('en-IN')}
            </span>
          </div>

          {/* Large Hero Amount Input */}
          <div className="text-center py-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-1">
              {type === 'EXPENSE' ? 'Spent Amount' : 'Received Amount'}
            </span>
            <div className="flex items-center justify-center text-4xl sm:text-5xl font-black text-slate-900">
              <span className="text-2xl sm:text-3xl text-slate-400 mr-1.5 font-bold">₹</span>
              <input 
                type="number" 
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
                className="w-full max-w-[220px] bg-transparent outline-none text-center placeholder:text-slate-300 font-black [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* "What was this for?" Input + Voice */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              {type === 'EXPENSE' ? 'What was this spent on?' : 'Where did this money come from?'}
            </label>
            <div className="relative">
              <input
                type="text"
                value={categoryInput}
                onChange={(e) => setCategoryInput(e.target.value)}
                placeholder={type === 'EXPENSE' ? "e.g., Petrol, Groceries, Tea, Dinner" : "e.g., Salary, Rent, Bonus, Repayment"}
                className="w-full p-2.5 bg-slate-50 rounded-xl border border-slate-200 focus:bg-white focus:border-amber-500 outline-none text-xs sm:text-sm font-medium pr-10 transition-colors"
              />
              {hasSupport && (
                <button 
                  type="button"
                  onClick={startListening}
                  className={cn(
                    "absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors",
                    isListening ? "bg-red-100 text-red-600 animate-pulse" : "text-slate-400 hover:text-amber-600 hover:bg-slate-100"
                  )}
                  title="Voice input"
                >
                  <Mic size={16} />
                </button>
              )}
            </div>

            {/* Auto-category suggestion badge */}
            {type === 'EXPENSE' && resolvedCategory && categoryInput.length > 2 && (
              <div className="flex items-center text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                <Wand2 size={12} className="mr-1 text-amber-600 shrink-0" />
                <span>Auto-categorized as <strong className="font-bold">{resolvedCategory.categoryId}</strong></span>
              </div>
            )}
          </div>

          {/* Quick Tag Pills */}
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {(type === 'EXPENSE' ? POPULAR_EXPENSE_TAGS : POPULAR_INCOME_TAGS).map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => handleTagClick(tag)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer",
                  categoryInput === tag || (tag.includes('Loan') && isDebtLinked)
                    ? "bg-amber-100 border-amber-400 text-amber-950 font-bold"
                    : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                )}
              >
                {tag}
              </button>
            ))}
          </div>

          {/* Simple Inline Friend / Khata Linker (if friend repayment or loan) */}
          {(isDebtLinked || categoryInput.toLowerCase().includes('loan') || categoryInput.toLowerCase().includes('repaid')) && (
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl space-y-2 animate-in fade-in duration-200">
              <div className="flex items-center justify-between text-xs font-bold text-amber-950">
                <span className="flex items-center gap-1.5">
                  <HandCoins size={14} className="text-amber-600" />
                  <span>Link to Debts & Khata:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIsDebtLinked(false)}
                  className="text-[11px] text-amber-700 hover:underline cursor-pointer"
                >
                  Cancel
                </button>
              </div>

              {type === 'INCOME' && activeDebts.filter(d => d.type === 'OWED_TO_US').length > 0 && (
                <select
                  value={selectedDebtId}
                  onChange={(e) => {
                    setSelectedDebtId(e.target.value);
                    const found = activeDebts.find(d => d.id === e.target.value);
                    if (found) {
                      setPeerPersonName(found.person);
                      setCategoryInput(`Repayment from ${found.person}`);
                    }
                  }}
                  className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-semibold text-slate-800 outline-none"
                >
                  <option value="">-- Select Debtor (Auto-updates Khata) --</option>
                  {activeDebts
                    .filter(d => d.type === 'OWED_TO_US')
                    .map(d => (
                      <option key={d.id} value={d.id}>
                        {d.person} (Pending: ₹{d.amount.toLocaleString('en-IN')})
                      </option>
                    ))}
                  <option value="__CUSTOM__">Other / Unlisted Person</option>
                </select>
              )}

              {(!selectedDebtId || selectedDebtId === '__CUSTOM__') && (
                <input
                  type="text"
                  value={peerPersonName}
                  onChange={(e) => setPeerPersonName(e.target.value)}
                  placeholder="Person name (e.g. Ramesh, Suresh)"
                  className="w-full p-2 bg-white rounded-lg border border-amber-300 text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400"
                />
              )}
            </div>
          )}

          {/* Date & Time Row (Live by default, past-only clamped) */}
          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
            <div>
              <label className="text-[11px] font-bold text-slate-600 flex items-center mb-1">
                <Calendar size={12} className="mr-1 text-slate-400" />
                <span>Date</span>
              </label>
              <input
                type="date"
                max={todayStr}
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-600 flex items-center">
                  <Clock size={12} className="mr-1 text-slate-400" />
                  <span>Time</span>
                </label>
                <button
                  type="button"
                  onClick={setLiveTime}
                  className="text-[10px] font-bold text-amber-700 hover:underline cursor-pointer flex items-center gap-0.5"
                >
                  <Zap size={10} />
                  <span>Now</span>
                </button>
              </div>
              <input
                type="time"
                value={txTime}
                onChange={(e) => setTxTime(e.target.value)}
                className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-500"
              />
            </div>
          </div>

          {/* Optional Notes */}
          <div>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes or remarks"
              className="w-full p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-medium text-slate-700 outline-none focus:bg-white focus:border-amber-500 placeholder:text-slate-400"
            />
          </div>

          {/* Submit Action Button */}
          <button
            type="button"
            disabled={!amount || Number(amount) <= 0 || isSaved}
            onClick={handleSave}
            className={cn(
              "w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-bold text-white shadow-md transition-all active:scale-[0.98] flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50",
              isSaved
                ? "bg-emerald-600"
                : type === 'EXPENSE'
                  ? "bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                  : "bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
            )}
          >
            {isSaved ? (
              <>
                <Check size={18} />
                <span>Transaction Saved!</span>
              </>
            ) : (
              <span>Add {type === 'EXPENSE' ? 'Expense' : 'Income'} (₹{amount ? Number(amount).toLocaleString('en-IN') : '0'})</span>
            )}
          </button>
        </CardContent>
      </Card>

      {/* --- Household Financial Health (True Earnings vs Living Spends) --- */}
      <Card className="border border-slate-200 shadow-xs rounded-2xl bg-gradient-to-br from-white to-slate-50 overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center space-x-1.5 text-xs font-bold text-slate-800">
              <TrendingUp size={14} className="text-amber-600" />
              <span>Household Financial Health</span>
            </div>
            <span className={cn(
              "text-[10px] font-bold px-2 py-0.5 rounded-full border",
              spendRate <= 60 
                ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                : spendRate <= 80
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-red-50 text-red-800 border-red-200"
            )}>
              {spendRate <= 60 ? 'Healthy Spend' : spendRate <= 80 ? 'Moderate Spend' : 'High Spend'}
            </span>
          </div>

          {/* 3 Metric Summary */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 bg-slate-100/70 rounded-xl">
              <span className="text-[10px] text-slate-500 font-semibold block">Salary & Profits</span>
              <span className="text-xs sm:text-sm font-bold text-emerald-700">₹{earnedIncome.toLocaleString('en-IN')}</span>
            </div>
            <div className="p-2 bg-slate-100/70 rounded-xl">
              <span className="text-[10px] text-slate-500 font-semibold block">Living Spends</span>
              <span className="text-xs sm:text-sm font-bold text-red-600">₹{livingExpenses.toLocaleString('en-IN')}</span>
            </div>
            <div className="p-2 bg-slate-100/70 rounded-xl">
              <span className="text-[10px] text-slate-500 font-semibold block">Net Savings</span>
              <span className={cn(
                "text-xs sm:text-sm font-bold",
                trueNetSavings >= 0 ? "text-slate-900" : "text-red-600"
              )}>
                ₹{trueNetSavings.toLocaleString('en-IN')}
              </span>
            </div>
          </div>

          {/* Spend Rate Meter */}
          <div>
            <div className="flex justify-between items-center text-[10px] text-slate-500 font-semibold mb-1">
              <span>Spending Rate</span>
              <span className="font-bold text-slate-800">{spendRate}% of earned income</span>
            </div>
            <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  spendRate <= 60 ? "bg-emerald-500" : spendRate <= 80 ? "bg-amber-500" : "bg-red-500"
                )}
                style={{ width: `${spendRate}%` }}
              />
            </div>
          </div>

          {/* Gentle reminder if debt inflow occurred */}
          {debtInflow > 0 && (
            <p className="text-[10px] text-slate-500 italic">
              ℹ️ ₹{debtInflow.toLocaleString('en-IN')} from debt inflows & loan recoveries is isolated so your spending rate remains 100% accurate.
            </p>
          )}
        </CardContent>
      </Card>

      {/* --- Transaction Log & History --- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center space-x-1.5">
            <History size={16} className="text-slate-500" />
            <span>Activity History</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">
            {filteredHistory.length} records
          </span>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Search */}
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by label, note, amount..."
              className="w-full pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:bg-white focus:border-amber-500"
            />
          </div>

          {/* Month & Year Selectors */}
          <div className="flex gap-1.5">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="ALL">All Months</option>
              {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m, idx) => (
                <option key={m} value={String(idx)}>{m}</option>
              ))}
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="p-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none"
            >
              <option value="ALL">All Years</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
            </select>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['ALL', 'EXPENSE', 'INCOME', 'DEBT'] as HistoryFilterType[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setHistoryTab(tab)}
              className={cn(
                "px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0",
                historyTab === tab
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              )}
            >
              {tab === 'ALL' ? 'All' : tab === 'EXPENSE' ? 'Expenses' : tab === 'INCOME' ? 'Income' : 'Loans & Debts'}
            </button>
          ))}
        </div>

        {/* Transactions List Grouped by Month */}
        <div className="space-y-4">
          {groupedByMonth.map((group) => (
            <div key={group.monthKey} className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-600 px-1">
                <span>{group.monthKey}</span>
                <span className="text-[11px] text-slate-500 font-normal">
                  +₹{group.totalIncome.toLocaleString('en-IN')} | -₹{group.totalExpense.toLocaleString('en-IN')}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden shadow-2xs">
                {group.items.map((tx) => {
                  const isExpense = tx.type === 'EXPENSE';
                  return (
                    <div key={tx.id} className="p-3 flex items-center justify-between hover:bg-slate-50/70 transition-colors">
                      <div className="flex items-center space-x-3">
                        <div className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                          isExpense ? "bg-red-50 text-red-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                          {isExpense ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                        </div>
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-slate-900">
                            {tx.label || tx.categoryId}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
                            <span>{format(new Date(tx.date), 'dd MMM yyyy, hh:mm a')}</span>
                            {tx.debtorName && (
                              <span className="px-1.5 py-0.2 bg-amber-50 text-amber-800 rounded font-bold border border-amber-200">
                                Khata: {tx.debtorName}
                              </span>
                            )}
                          </div>
                          {tx.notes && (
                            <p className="text-[10px] text-slate-500 mt-0.5 italic">{tx.notes}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span className={cn(
                          "font-bold text-xs sm:text-sm",
                          isExpense ? "text-slate-900" : "text-emerald-600"
                        )}>
                          {isExpense ? '-' : '+'}₹{tx.amount.toLocaleString('en-IN')}
                        </span>
                        <button
                          type="button"
                          onClick={() => setDeleteTargetTx(tx)}
                          className="text-slate-400 hover:text-red-500 p-1 transition-colors cursor-pointer"
                          title="Delete transaction"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {groupedByMonth.length === 0 && (
            <div className="p-8 bg-white rounded-2xl border border-slate-200 text-center space-y-2">
              <History size={28} className="mx-auto text-slate-300" />
              <p className="text-xs font-bold text-slate-700">No transactions found</p>
              <p className="text-[11px] text-slate-500">
                {searchQuery ? "Try clearing your search query." : "Add your first transaction above."}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTargetTx}
        title="Delete Transaction"
        itemName={deleteTargetTx ? `${deleteTargetTx.type === 'EXPENSE' ? '-' : '+'}₹${deleteTargetTx.amount.toLocaleString('en-IN')} (${deleteTargetTx.label || deleteTargetTx.categoryId})` : ''}
        message={
          deleteTargetTx?.debtId 
            ? "This transaction is linked to a loan in Debts. Deleting it will restore the loan's balance. Proceed?" 
            : "Are you sure you want to permanently delete this transaction?"
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
