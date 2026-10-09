import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { TrendingUp, ArrowUpRight, ArrowDownRight, IndianRupee, Trash2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { getTransactions, deleteTransaction, HemaDB } from '@/lib/db';
import { format, subDays, isSameDay } from 'date-fns';
import { useTranslation } from 'react-i18next';

const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const [transactions, setTransactions] = useState<HemaDB['transactions']['value'][]>([]);
  const [chartData, setChartData] = useState<{ name: string, spend: number }[]>([]);

  useEffect(() => {
    fetchDB();
  }, []);

  const fetchDB = async () => {
    const txs = await getTransactions();
    setTransactions(txs.sort((a, b) => b.date - a.date));
    generateChartData(txs);
  };

  const generateChartData = (txs: HemaDB['transactions']['value'][]) => {
    const data = [];
    const today = new Date();
    // Build last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = subDays(today, i);
      const dayName = format(date, 'EEE');
      const dailySpend = txs
        .filter(t => t.type === 'EXPENSE' && isSameDay(new Date(t.date), date))
        .reduce((sum, t) => sum + t.amount, 0);
      data.push({ name: dayName, spend: dailySpend });
    }
    setChartData(data);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Delete this transaction?')) {
      await deleteTransaction(id);
      fetchDB();
    }
  };

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

      {/* Spend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-textMain flex items-center">
            <TrendingUp className="mr-2 text-primary-600" size={18} />
            {t('dashboard.weekly_spend')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip 
                  cursor={{ fill: '#F8FAFC' }}
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} 
                  formatter={(value: number) => [`₹${value}`, 'Spend']}
                />
                <Bar dataKey="spend" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 6 ? '#d97706' : '#fde68a'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Recent Transactions */}
      <div className="px-1">
        <h3 className="text-sm font-bold text-textMuted mb-3 uppercase tracking-wider">{t('dashboard.recent_tx')}</h3>
        <div className="space-y-3">
          {transactions.slice(0, 5).map(tx => (
            <div key={tx.id} className="flex items-center justify-between p-3 bg-surface rounded-xl border border-borderLight shadow-sm">
              <div className="flex items-center space-x-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${tx.type === 'EXPENSE' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'}`}>
                  <IndianRupee size={18} />
                </div>
                <div>
                  <p className="font-semibold text-textMain text-sm">{tx.categoryId}</p>
                  <p className="text-xs text-textMuted">{format(new Date(tx.date), 'dd MMM, hh:mm a')}</p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <span className={`font-semibold ${tx.type === 'EXPENSE' ? 'text-textMain' : 'text-green-600'}`}>
                  {tx.type === 'EXPENSE' ? '-' : '+'}₹{tx.amount.toLocaleString('en-IN')}
                </span>
                <button onClick={() => handleDelete(tx.id)} className="text-textMuted hover:text-red-500 p-1 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {transactions.length === 0 && (
            <p className="text-sm text-textMuted text-center py-4 bg-surface rounded-xl border border-borderLight shadow-sm">
              {t('dashboard.no_tx')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
