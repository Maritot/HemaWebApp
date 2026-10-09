import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Users, AlertCircle, CheckCircle2, ChevronRight, Phone, Plus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getDebts, addDebt, updateDebtStatus, HemaDB } from '@/lib/db';
import { format } from 'date-fns';

const Debts: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'PENDING' | 'SETTLED'>('PENDING');
  const [debts, setDebts] = useState<HemaDB['debts']['value'][]>([]);
  const [showModal, setShowModal] = useState(false);

  // Form State
  const [person, setPerson] = useState('');
  const [amount, setAmount] = useState('');
  const [debtType, setDebtType] = useState<'WE_OWE' | 'OWED_TO_US'>('OWED_TO_US');
  const [dueDateStr, setDueDateStr] = useState('');

  useEffect(() => {
    fetchDebts();
  }, []);

  const fetchDebts = async () => {
    const data = await getDebts();
    setDebts(data.sort((a, b) => b.dateCreated - a.dateCreated));
  };

  const handleSave = async () => {
    if (!person || !amount) return;
    await addDebt({
      id: crypto.randomUUID(),
      person,
      amount: Number(amount),
      type: debtType,
      status: 'PENDING',
      dueDate: dueDateStr ? new Date(dueDateStr).getTime() : Date.now() + 86400000 * 30, // Default +30 days
      dateCreated: Date.now()
    });
    setShowModal(false);
    setPerson('');
    setAmount('');
    setDueDateStr('');
    fetchDebts();
  };

  const handleSettle = async (id: string) => {
    await updateDebtStatus(id, 'SETTLED');
    fetchDebts();
  };

  const filtered = debts.filter(d => 
    activeTab === 'PENDING' ? d.status !== 'SETTLED' : d.status === 'SETTLED'
  );

  const weOweTotal = debts.filter(d => d.type === 'WE_OWE' && d.status !== 'SETTLED').reduce((acc, d) => acc + d.amount, 0);
  const owedToUsTotal = debts.filter(d => d.type === 'OWED_TO_US' && d.status !== 'SETTLED').reduce((acc, d) => acc + d.amount, 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 relative">
      
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="text-2xl font-bold text-textMain tracking-tight">{t('debts.title')}</h2>
          <p className="text-textMuted text-sm">{t('debts.subtitle')}</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-primary-600 text-white p-3 rounded-full shadow-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="bg-red-50 border-red-100 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider mb-1">{t('debts.we_owe')}</p>
            <p className="text-xl font-bold text-red-700">₹{weOweTotal.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-100 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-1">{t('debts.owed_to_us')}</p>
            <p className="text-xl font-bold text-green-700">₹{owedToUsTotal.toLocaleString('en-IN')}</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-borderLight mt-6">
        <button 
          onClick={() => setActiveTab('PENDING')}
          className={cn(
            "flex-1 pb-3 text-sm font-semibold transition-colors",
            activeTab === 'PENDING' ? "text-primary-600 border-b-2 border-primary-600" : "text-textMuted"
          )}
        >
          {t('debts.active')}
        </button>
        <button 
          onClick={() => setActiveTab('SETTLED')}
          className={cn(
            "flex-1 pb-3 text-sm font-semibold transition-colors",
            activeTab === 'SETTLED' ? "text-primary-600 border-b-2 border-primary-600" : "text-textMuted"
          )}
        >
          {t('debts.settled')}
        </button>
      </div>

      {/* Debts List */}
      <div className="space-y-3 pt-2">
        {filtered.length === 0 ? (
          <p className="text-center text-textMuted py-10 bg-surface rounded-xl border border-borderLight">No debts found in this category.</p>
        ) : (
          filtered.map(debt => (
            <div key={debt.id} className="flex flex-col p-4 bg-surface rounded-xl border border-borderLight shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center">
                    <Users size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-textMain text-sm">{debt.person}</p>
                    <div className="flex items-center space-x-2 mt-0.5">
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase",
                        debt.type === 'WE_OWE' ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                      )}>
                        {debt.type === 'WE_OWE' ? t('debts.to_pay') : t('debts.to_collect')}
                      </span>
                      <span className="text-xs text-textMuted">
                        Due: {format(new Date(debt.dueDate), 'dd MMM yyyy')}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex flex-col items-end">
                  <span className="font-bold text-textMain">₹{debt.amount.toLocaleString('en-IN')}</span>
                  {debt.status === 'OVERDUE' && (
                    <span className="flex items-center text-[10px] text-red-500 font-bold mt-1">
                      <AlertCircle size={10} className="mr-1" /> {t('debts.overdue')}
                    </span>
                  )}
                  {debt.status === 'SETTLED' && (
                    <span className="flex items-center text-[10px] text-green-500 font-bold mt-1">
                      <CheckCircle2 size={10} className="mr-1" /> {t('debts.settled')}
                    </span>
                  )}
                </div>
              </div>

              {/* Actions */}
              {debt.status !== 'SETTLED' && (
                <div className="flex items-center justify-end space-x-2 border-t border-borderLight pt-3 mt-1">
                  <a href={`https://wa.me/?text=Hi ${debt.person}, a quick reminder about the ₹${debt.amount} ${debt.type === 'WE_OWE' ? 'I owe you' : 'you owe me'}.`} target="_blank" rel="noreferrer" className="flex-1 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg py-2 flex items-center justify-center hover:bg-[#25D366]/20 transition-colors">
                    <Phone size={14} className="text-[#128C7E] mr-1" />
                    <span className="text-xs font-bold text-[#128C7E]">{t('debts.send_reminder', 'Remind')}</span>
                  </a>
                  <button 
                    onClick={() => handleSettle(debt.id)}
                    className="flex-1 bg-primary-100 text-primary-700 rounded-lg py-2 flex items-center justify-center hover:bg-primary-200 transition-colors"
                  >
                    <CheckCircle2 size={14} className="mr-1" />
                    <span className="text-xs font-bold">Mark Settled</span>
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-sm animate-in zoom-in-95 border-none shadow-2xl">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-textMain">{t('debts.add_debt', 'Add Debt/Credit')}</h3>
                <button onClick={() => setShowModal(false)} className="text-textMuted hover:text-textMain">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex bg-borderLight p-1 rounded-full space-x-1">
                  <button 
                    onClick={() => setDebtType('OWED_TO_US')}
                    className={cn("flex-1 py-1.5 rounded-full text-sm font-semibold", debtType === 'OWED_TO_US' ? "bg-surface shadow text-green-600" : "text-textMuted")}
                  >
                    Owed to Us
                  </button>
                  <button 
                    onClick={() => setDebtType('WE_OWE')}
                    className={cn("flex-1 py-1.5 rounded-full text-sm font-semibold", debtType === 'WE_OWE' ? "bg-surface shadow text-red-600" : "text-textMuted")}
                  >
                    We Owe
                  </button>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">{t('gifts.person_name', 'Person Name')}</label>
                  <input type="text" value={person} onChange={e => setPerson(e.target.value)} className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-textMuted">{t('expenses.amount', 'Amount')} (₹)</label>
                  <input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-textMuted">Due Date (Optional)</label>
                  <input type="date" value={dueDateStr} onChange={e => setDueDateStr(e.target.value)} className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none text-textMain" />
                </div>
                
                <button onClick={handleSave} disabled={!person || !amount} className="w-full mt-2 py-3 bg-primary-600 disabled:opacity-50 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors">
                  {t('expenses.save', 'Save')}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
};

export default Debts;
