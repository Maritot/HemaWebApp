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
  ArrowDownRight, 
  ArrowUpRight, 
  Trash2, 
  Filter, 
  X,
  History
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { resolveCategory, ResolvedCategory } from '@/lib/AutoCorrectEngine';
import { addTransaction, getTransactions, deleteTransaction, HemaDB } from '@/lib/db';
import { useTranslation } from 'react-i18next';
import { useSpeechToText } from '@/hooks/useSpeechToText';
import { format, isSameDay } from 'date-fns';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useAuth } from '@/context/AuthContext';

type HistoryFilterType = 'ALL' | 'EXPENSE' | 'INCOME';

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
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [txDate, setTxDate] = useState(todayStr);

  // All Transactions for History Log
  const [allTransactions, setAllTransactions] = useState<HemaDB['transactions']['value'][]>([]);

  // History Filter state (decoupled from top form)
  const [historyTab, setHistoryTab] = useState<HistoryFilterType>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL'); // 'ALL' or '0'..'11'
  const [selectedYear, setSelectedYear] = useState<string>('ALL'); // 'ALL' or '2026'..
  const [specificDateFilter, setSpecificDateFilter] = useState<string>(''); // YYYY-MM-DD or empty
  const [deleteTargetTx, setDeleteTargetTx] = useState<HemaDB['transactions']['value'] | null>(null);

  const fetchTransactions = async () => {
    const txs = await getTransactions();
    const sorted = txs.sort((a, b) => b.date - a.date);
    setAllTransactions(sorted);

    const totalInc = sorted.filter(t => t.type === 'INCOME').reduce((sum, t) => sum + t.amount, 0);
    const totalExp = sorted.filter(t => t.type === 'EXPENSE').reduce((sum, t) => sum + t.amount, 0);
    setBalance(totalInc - totalExp);
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
    
    const timestamp = txDate ? new Date(txDate).getTime() : Date.now();

    await addTransaction({
      id: crypto.randomUUID(),
      amount: Number(amount),
      categoryId: finalCategory,
      label: userInputLabel || finalCategory, // Preserves "Petrol" while categorizing as "Transport"
      type: type,
      date: timestamp,
      notes: notes.trim()
    });

    setIsSaved(true);
    await fetchTransactions();
    setTimeout(() => {
      setIsSaved(false);
      setAmount('');
      setRawCategory('');
      setNotes('');
      setTxDate(todayStr);
      setResolvedCategory(null);
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

  // Filtered transactions for the history log
  const filteredHistory = useMemo(() => {
    return allTransactions.filter(tx => {
      // 1. Type filter
      if (historyTab !== 'ALL' && tx.type !== historyTab) {
        return false;
      }

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

      // 5. Search query (matches label, category, notes, or amount)
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const label = (tx.label || '').toLowerCase();
        const cat = (tx.categoryId || '').toLowerCase();
        const note = (tx.notes || '').toLowerCase();
        const amtStr = String(tx.amount);

        if (!label.includes(query) && !cat.includes(query) && !note.includes(query) && !amtStr.includes(query)) {
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
              "flex-1 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all",
              type === 'EXPENSE' ? "bg-surface shadow-sm text-red-600" : "text-textMuted hover:text-textMain"
            )}
          >
            {t('expenses.expense_tab')}
          </button>
          <button 
            type="button"
            onClick={() => handleTypeChange('INCOME')}
            className={cn(
              "flex-1 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition-all",
              type === 'INCOME' ? "bg-surface shadow-sm text-green-600" : "text-textMuted hover:text-textMain"
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

          {/* Date & Notes Input Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-textMain">Date</label>
              <input
                type="date"
                value={txDate}
                max={todayStr}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain"
              />
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
              "w-full py-3 rounded-xl font-bold text-white text-sm transition-all shadow-soft flex items-center justify-center",
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

        {/* 3-Section Slider [ ALL | EXPENSES | INCOME ] */}
        <div className="bg-primary-50/80 p-1 rounded-xl border border-primary-200/60 flex space-x-1 shadow-2xs">
          <button 
            type="button"
            onClick={() => setHistoryTab('ALL')}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
              historyTab === 'ALL' ? "bg-white shadow text-primary-900 border border-primary-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            All Logs
          </button>
          <button 
            type="button"
            onClick={() => setHistoryTab('EXPENSE')}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
              historyTab === 'EXPENSE' ? "bg-white shadow text-red-600 border border-red-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Expenses Only
          </button>
          <button 
            type="button"
            onClick={() => setHistoryTab('INCOME')}
            className={cn(
              "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
              historyTab === 'INCOME' ? "bg-white shadow text-green-700 border border-green-200" : "text-primary-700 hover:text-primary-950"
            )}
          >
            Income Only
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
              placeholder="Search by label (e.g. Petrol, Swiggy), category, notes, or amount..."
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
                className="text-primary-600 hover:text-primary-700 font-bold hover:underline"
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
                          isExpense ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"
                        )}>
                          {isExpense ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                        </div>

                        {/* Title, Category & Timestamp */}
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2 flex-wrap">
                            <span className="font-bold text-sm text-textMain truncate max-w-[130px] sm:max-w-[200px]">
                              {displayTitle}
                            </span>
                            {hasCustomLabel && (
                              <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.2 rounded-full border border-slate-200 shrink-0">
                                {tx.categoryId}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center space-x-2 text-[11px] text-textMuted mt-0.5">
                            <span>{format(new Date(tx.date), 'dd MMM yyyy, hh:mm a')}</span>
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
                          className="text-textMuted hover:text-red-500 p-1.5 transition-colors"
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
                  className="mt-2 px-3 py-1 bg-primary-50 text-primary-700 rounded-lg text-xs font-bold hover:bg-primary-100"
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
