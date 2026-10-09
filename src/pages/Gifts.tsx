import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Gift as GiftIcon, ArrowUpRight, ArrowDownRight, Plus, User, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { addGift, getGifts, HemaDB } from '@/lib/db';
import { format } from 'date-fns';

const Gifts: React.FC = () => {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<'ALL' | 'GIVEN' | 'RECEIVED'>('ALL');
  const [gifts, setGifts] = useState<HemaDB['gifts']['value'][]>([]);
  const [showModal, setShowModal] = useState(false);

  // Modal form state
  const [person, setPerson] = useState('');
  const [occasion, setOccasion] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [giftType, setGiftType] = useState<'GIVEN' | 'RECEIVED'>('GIVEN');
  const [giftDate, setGiftDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    fetchGifts();
  }, []);

  const fetchGifts = async () => {
    const data = await getGifts();
    setGifts(data.sort((a, b) => b.date - a.date)); // newest first
  };

  const handleSave = async () => {
    if (!person || (!amount && !itemDesc)) return; // Must have person + either an item or amount
    
    const timestamp = giftDate ? new Date(giftDate).getTime() : Date.now();

    await addGift({
      id: crypto.randomUUID(),
      person,
      occasion: occasion || 'Other',
      type: giftType,
      amount: Number(amount) || 0,
      item: itemDesc || 'Cash', // Default to 'Cash' if they only entered an amount
      date: timestamp
    });
    
    setShowModal(false);
    setPerson('');
    setOccasion('');
    setItemDesc('');
    setAmount('');
    setGiftDate(new Date().toISOString().split('T')[0]);
    fetchGifts();
  };

  const filteredGifts = gifts.filter(g => filter === 'ALL' || g.type === filter);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 relative">
      
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="text-2xl font-bold text-textMain tracking-tight">{t('gifts.title')}</h2>
          <p className="text-textMuted text-sm">{t('gifts.subtitle')}</p>
        </div>
        <button 
          onClick={() => setShowModal(true)}
          className="bg-primary-600 text-white p-3 rounded-full shadow-lg hover:bg-primary-700 transition-colors"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2 overflow-x-auto pb-2 scrollbar-hide">
        {(['ALL', 'GIVEN', 'RECEIVED'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={cn(
              "px-4 py-2 rounded-full text-sm font-semibold transition-all whitespace-nowrap",
              filter === tab 
                ? "bg-primary-100 text-primary-800 border border-primary-200" 
                : "bg-surface text-textMuted border border-borderLight"
            )}
          >
            {tab === 'ALL' ? t('gifts.all') : tab === 'GIVEN' ? t('gifts.given') : t('gifts.received')}
          </button>
        ))}
      </div>

      {/* Gifts List */}
      <div className="space-y-4">
        {filteredGifts.length === 0 ? (
          <p className="text-center text-textMuted py-10 bg-surface rounded-xl border border-borderLight">No gifts recorded yet.</p>
        ) : (
          filteredGifts.map(gift => (
            <Card key={gift.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 flex items-center space-x-4">
                <div className={cn(
                  "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                  gift.type === 'RECEIVED' ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-primary-600'
                )}>
                  <GiftIcon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-textMain truncate">{gift.person}</p>
                  <div className="flex items-center text-xs text-textMuted space-x-2 mt-0.5">
                    <span className="flex items-center">
                      <User size={12} className="mr-1" /> {gift.occasion}
                    </span>
                    <span>•</span>
                    <span>{format(new Date(gift.date), 'dd MMM yyyy')}</span>
                  </div>
                </div>
                <div className="text-right shrink-0 max-w-[120px]">
                  <div className={cn(
                    "font-bold text-sm flex items-center justify-end truncate",
                    gift.type === 'RECEIVED' ? 'text-green-600' : 'text-textMain'
                  )}>
                    {gift.type === 'RECEIVED' ? <ArrowDownRight size={14} className="mr-0.5 shrink-0"/> : <ArrowUpRight size={14} className="mr-0.5 shrink-0"/>}
                    <span className="truncate">{gift.item}</span>
                  </div>
                  {gift.amount > 0 && (
                    <p className="text-[10px] font-semibold text-textMuted uppercase mt-1">
                      Val: ₹{gift.amount.toLocaleString('en-IN')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add Modal overlay */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-sm animate-in zoom-in-95 border-none shadow-2xl overflow-y-auto max-h-[90vh]">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-textMain">{t('gifts.add_gift', 'Add Gift')}</h3>
                <button onClick={() => setShowModal(false)} className="text-textMuted hover:text-textMain bg-slate-100 p-1 rounded-full">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex bg-borderLight p-1 rounded-full space-x-1">
                  <button 
                    onClick={() => setGiftType('GIVEN')}
                    className={cn("flex-1 py-1.5 rounded-full text-sm font-semibold", giftType === 'GIVEN' ? "bg-surface shadow text-primary-600" : "text-textMuted")}
                  >
                    We Gave
                  </button>
                  <button 
                    onClick={() => setGiftType('RECEIVED')}
                    className={cn("flex-1 py-1.5 rounded-full text-sm font-semibold", giftType === 'RECEIVED' ? "bg-surface shadow text-green-600" : "text-textMuted")}
                  >
                    We Received
                  </button>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">{t('gifts.person_name', 'Person Name')}</label>
                  <input type="text" value={person} onChange={e => setPerson(e.target.value)} placeholder="e.g., Ramesh Uncle" className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                </div>
                
                <div>
                  <label className="text-xs font-semibold text-textMuted">{t('gifts.occasion', 'Occasion')}</label>
                  <input type="text" value={occasion} onChange={e => setOccasion(e.target.value)} placeholder="e.g., Wedding, Housewarming" className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                </div>

                <hr className="border-borderLight my-2" />

                <div>
                  <label className="text-xs font-semibold text-textMuted">What was the Gift?</label>
                  <input type="text" value={itemDesc} onChange={e => setItemDesc(e.target.value)} placeholder="e.g., Cash, Gold Ring, Saree" className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Value (₹) - Optional</label>
                    <input type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Date</label>
                    <input type="date" value={giftDate} onChange={e => setGiftDate(e.target.value)} className="w-full mt-1 p-3 bg-background rounded-lg border border-borderLight focus:border-primary-400 outline-none text-textMain" />
                  </div>
                </div>
                
                <button 
                  onClick={handleSave} 
                  disabled={!person || (!amount && !itemDesc)} 
                  className="w-full mt-4 py-3 bg-primary-600 disabled:opacity-50 text-white font-bold rounded-lg hover:bg-primary-700 transition-colors"
                >
                  {t('gifts.save', 'Save Gift')}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Gifts;
