import React, { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, ArrowUpRight, ArrowDownRight, IndianRupee, Trash2, Tag, Calendar } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getTransactions, deleteTransaction, HemaDB } from '@/lib/db';
import { format, subDays, subMonths, isSameDay, isSameMonth } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { useAuth } from '@/context/AuthContext';

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<HemaDB['transactions']['value'][]>([]);
  const [timeframe, setTimeframe] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [deletingTx, setDeletingTx] = useState<HemaDB['transactions']['value'] | null>(null);

  useEffect(() => {
    fetchDB();
  }, [user?.id]);

  const fetchDB = async () => {
    const txs = await getTransactions();
    setTransactions(txs.sort((a, b) => b.date - a.date));
  };

  const handleConfirmDelete = async () => {
    if (deletingTx) {
      await deleteTransaction(deletingTx.id);
      setDeletingTx(null);
      fetchDB();
    }
  };

  // Spend Chart Dynamic Data Generator
  const chartData = useMemo(() => {
    const today = new Date();
    const expenseTxs = transactions.filter(t => t.type === 'EXPENSE');

    if (timeframe === 'weekly') {
      // Last 7 days
      const data = [];
      for (let i = 6; i >= 0; i--) {
        const d = subDays(today, i);
        const name = format(d, 'EEE');
        const spend = expenseTxs
          .filter(t => isSameDay(new Date(t.date), d))
          .reduce((sum, t) => sum + t.amount, 0);
        data.push({ name, spend, fullLabel: format(d, 'dd MMM yyyy') });
      }
      return data;
    }

    if (timeframe === 'monthly') {
      // Last 4 weeks (7-day intervals)
      const data = [];
      for (let i = 3; i >= 0; i--) {
        const weekEnd = subDays(today, i * 7);
        const weekStart = subDays(weekEnd, 6);
        const name = `W${4 - i}`;
        const spend = expenseTxs
          .filter(t => {
            const txDate = new Date(t.date);
            return txDate >= weekStart && txDate <= weekEnd;
          })
          .reduce((sum, t) => sum + t.amount, 0);
        data.push({ 
          name, 
          spend, 
          fullLabel: `${format(weekStart, 'dd MMM')} - ${format(weekEnd, 'dd MMM')}` 
        });
      }
      return data;
    }

    if (timeframe === 'yearly') {
      // Last 12 months
      const data = [];
      for (let i = 11; i >= 0; i--) {
        const m = subMonths(today, i);
        const name = format(m, 'MMM');
        const spend = expenseTxs
          .filter(t => isSameMonth(new Date(t.date), m))
          .reduce((sum, t) => sum + t.amount, 0);
        data.push({ name, spend, fullLabel: format(m, 'MMMM yyyy') });
      }
      return data;
    }

    return [];
  }, [transactions, timeframe]);

  // Dynamic Categories from recorded transactions
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    transactions.forEach(t => {
      if (t.categoryId) cats.add(t.categoryId);
    });
    return ['ALL', ...Array.from(cats).sort()];
  }, [transactions]);

  // Category specific spend total
  const categorySpendTotal = useMemo(() => {
    if (selectedCategory === 'ALL') return null;
    return transactions
      .filter(t => t.type === 'EXPENSE' && t.categoryId.toLowerCase() === selectedCategory.toLowerCase())
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions, selectedCategory]);

  // Strictly up to 10 recent transactions
  const recentTransactions = useMemo(() => {
    const list = selectedCategory === 'ALL'
      ? transactions
      : transactions.filter(t => t.categoryId.toLowerCase() === selectedCategory.toLowerCase());
    return list.slice(0, 10);
  }, [transactions, selectedCategory]);

  const totalIncome = transactions.filter(t => t.type === 'INCOME').reduce((acc, t) => acc + t.amount, 0); 
  const totalExpense = transactions.filter(t => t.type === 'EXPENSE').reduce((acc, t) => acc + t.amount, 0); 
  const balance = totalIncome - totalExpense;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      {/* Total Balance Hero Card */}
      <Card className="bg-gradient-to-br from-primary-500 to-primary-600 text-white shadow-xl shadow-primary-500/20 border-none">
        <CardContent className="pt-6">
          <p className="text-primary-100 text-sm font-medium mb-1">{t('dashboard.total_balance')}</p>
          <div className="flex items-center space-x-1">
            <span className="text-3xl font-bold tracking-tight">₹{balance.toLocaleString('en-IN')}</span>
          </div>
          <div className="mt-6 flex space-x-4">
            <div className="flex-1 bg-white/10 rounded-xl p-3 backdrop-blur-sm">
              <div className="flex items-center text-green-100 text-xs mb-1">
                <ArrowUpRight size={14} className="mr-1"/> {t('dashboard.income')}
              </div>
              <p className="font-semibold">₹{totalIncome.toLocaleString('en-IN')}</p>
            </div>
            <div className="flex-1 bg-white/10 rounded-xl p-3 backdrop-blur-sm">
              <div className="flex items-center text-red-100 text-xs mb-1">
                <ArrowDownRight size={14} className="mr-1"/> {t('dashboard.expenses')}
              </div>
              <p className="font-semibold">₹{totalExpense.toLocaleString('en-IN')}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Spend Chart with Segmented Grouped Button (Weekly | Monthly | Yearly) */}
      <Card className="border border-borderLight shadow-sm">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-textMain flex items-center text-sm sm:text-base">
              <TrendingUp className="mr-2 text-primary-600 shrink-0" size={18} />
              <span>
                {timeframe === 'weekly' ? "Weekly Spend" : timeframe === 'monthly' ? "Monthly Spend (4 Wks)" : "Yearly Spend (12 Mos)"}
              </span>
            </CardTitle>
            
            {/* Grouped Pill Toggle */}
            <div className="flex items-center space-x-1 bg-primary-50/90 p-0.5 rounded-lg border border-primary-200/60 shadow-2xs">
              {(['weekly', 'monthly', 'yearly'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTimeframe(mode)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-bold rounded-md transition-all capitalize",
                    timeframe === mode 
                      ? "bg-primary-600 text-white shadow-2xs" 
                      : "text-primary-800 hover:text-primary-950"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} dy={8} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748B' }} />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #E2E8F0', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', fontSize: '12px' }} 
                  formatter={(value: any, _name: any, item: any) => [`₹${Number(value).toLocaleString('en-IN')}`, item.payload.fullLabel || 'Spend']}
                />
                <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
                  {chartData.map((_entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={index === chartData.length - 1 ? '#d97706' : '#fde68a'} 
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent Transactions Section with Category Filter & User Original Labels */}
      <div className="px-1 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-textMuted uppercase tracking-wider flex items-center">
            <span>{t('dashboard.recent_tx')}</span>
            <span className="ml-2 text-[10px] bg-primary-100 text-primary-800 font-extrabold px-1.5 py-0.2 rounded-full">
              {recentTransactions.length} of 10
            </span>
          </h3>

          {selectedCategory !== 'ALL' && categorySpendTotal !== null && (
            <span className="text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
              {selectedCategory}: ₹{categorySpendTotal.toLocaleString('en-IN')}
            </span>
          )}
        </div>

        {/* Category Filter Pills (All, Transport, Food, Groceries, etc.) */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1.5 scrollbar-hide">
          {availableCategories.map(cat => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shrink-0",
                selectedCategory === cat 
                  ? "bg-primary-600 text-white border-primary-600 shadow-2xs" 
                  : "bg-surface text-textMuted border-borderLight hover:bg-slate-50"
              )}
            >
              {cat === 'ALL' ? 'All Categories' : cat}
            </button>
          ))}
        </div>

        {/* Transactions List */}
        <div className="space-y-2.5">
          {recentTransactions.map(tx => {
            const displayTitle = tx.label || tx.categoryId;
            const hasCustomLabel = tx.label && tx.label.trim().toLowerCase() !== tx.categoryId.trim().toLowerCase();

            return (
              <div key={tx.id} className="flex items-center justify-between p-3 bg-surface rounded-xl border border-borderLight shadow-2xs hover:shadow-sm transition-all">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center shrink-0",
                    tx.type === 'EXPENSE' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'
                  )}>
                    <IndianRupee size={18} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <p className="font-bold text-textMain text-sm truncate max-w-[130px] sm:max-w-[180px]">
                        {displayTitle}
                      </p>
                      {hasCustomLabel && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.2 rounded-full border border-slate-200 shrink-0">
                          {tx.categoryId}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2 text-[11px] text-textMuted mt-0.5">
                      <span>{format(new Date(tx.date), 'dd MMM, hh:mm a')}</span>
                      {tx.notes && (
                        <span className="truncate max-w-[100px] sm:max-w-[160px] italic">
                          · "{tx.notes}"
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <span className={cn(
                    "font-bold text-sm",
                    tx.type === 'EXPENSE' ? 'text-textMain' : 'text-green-600'
                  )}>
                    {tx.type === 'EXPENSE' ? '-' : '+'}₹{tx.amount.toLocaleString('en-IN')}
                  </span>
                  <button 
                    onClick={() => setDeletingTx(tx)} 
                    className="text-textMuted hover:text-red-500 p-1.5 transition-colors"
                    title="Delete transaction"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}

          {recentTransactions.length === 0 && (
            <div className="text-sm text-textMuted text-center py-6 bg-surface rounded-xl border border-borderLight shadow-2xs">
              <p>{t('dashboard.no_tx')}</p>
              {selectedCategory !== 'ALL' && (
                <button 
                  onClick={() => setSelectedCategory('ALL')}
                  className="mt-2 text-xs font-bold text-primary-600 hover:underline"
                >
                  View All Categories
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!deletingTx}
        title="Delete Transaction?"
        itemName={deletingTx ? `${deletingTx.label || deletingTx.categoryId} • ₹${deletingTx.amount.toLocaleString('en-IN')}` : undefined}
        message="Are you sure you want to permanently delete this transaction from your ledger?"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeletingTx(null)}
      />
    </div>
  );
};

export default Dashboard;
