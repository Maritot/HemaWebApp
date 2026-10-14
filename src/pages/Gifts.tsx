import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  Gift as GiftIcon, 
  Plus, 
  User, 
  Users, 
  X, 
  ChevronLeft, 
  Sparkles, 
  Trash2, 
  Camera, 
  Coins, 
  Shirt, 
  Package, 
  Calendar,
  Search,
  Scale,
  Pencil
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { 
  addGift, 
  getGifts, 
  deleteGift,
  addPerson, 
  getPeople, 
  deletePerson, 
  updatePersonAndGifts,
  GiftTransaction, 
  PersonRecord, 
  GiftCategory 
} from '@/lib/db';
import { format } from 'date-fns';

const RELATION_TAGS = ['Uncle', 'Aunt', 'In-laws', 'Cousin', 'Friend', 'Neighbour', 'Colleague', 'Family'];
const OCCASIONS = ['Wedding (विवाह / పెళ్లి)', 'Housewarming (गृहप्रवेश / గృహప్రవేశం)', 'Birthday (जन्मदिन / పుట్టినరోజు)', 'Baby Shower / Seemantham', 'Festival (दीपावली / సంక్రాంతి)', 'Retirement', 'Other'];

const Gifts: React.FC = () => {
  const { t } = useTranslation();

  // Data states
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [gifts, setGifts] = useState<GiftTransaction[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<PersonRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddPersonModal, setShowAddPersonModal] = useState(false);
  const [showAddGiftModal, setShowAddGiftModal] = useState(false);
  const [showEditPersonModal, setShowEditPersonModal] = useState(false);

  // Edit Person form state
  const [editingPerson, setEditingPerson] = useState<PersonRecord | null>(null);
  const [editPersonName, setEditPersonName] = useState('');
  const [editPersonRelation, setEditPersonRelation] = useState('Family');
  const [editPersonPhone, setEditPersonPhone] = useState('');
  const [editPersonAvatar, setEditPersonAvatar] = useState('');

  // Add Person form state
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonRelation, setNewPersonRelation] = useState('Family');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [newPersonAvatar, setNewPersonAvatar] = useState('');

  // Add Gift form state
  const [giftType, setGiftType] = useState<'GIVEN' | 'RECEIVED'>('RECEIVED');
  const [giftCategory, setGiftCategory] = useState<GiftCategory>('CASH');
  const [itemTitle, setItemTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [weightGrams, setWeightGrams] = useState('');
  const [purity, setPurity] = useState('22K');
  const [occasion, setOccasion] = useState(OCCASIONS[0]);
  const [giftDate, setGiftDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    const [peopleData, giftsData] = await Promise.all([getPeople(), getGifts()]);
    
    // If no people exist yet, let's auto-generate a couple of starter relatives from existing gifts or sample
    if (peopleData.length === 0 && giftsData.length > 0) {
      const distinctNames = Array.from(new Set(giftsData.map(g => g.person)));
      const created: PersonRecord[] = [];
      for (const name of distinctNames) {
        const p: PersonRecord = {
          id: crypto.randomUUID(),
          name,
          relationship: 'Family',
          createdAt: Date.now()
        };
        await addPerson(p);
        created.push(p);
      }
      setPeople(created);
    } else {
      setPeople(peopleData.sort((a, b) => a.name.localeCompare(b.name)));
    }

    setGifts(giftsData.sort((a, b) => b.date - a.date));
  };

  // Avatar photo upload helper (as data URI)
  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Compress and resize avatar photo so it never exceeds browser storage limits
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 200;
          let w = img.width;
          let h = img.height;
          if (w > h && w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          setNewPersonAvatar(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCreatePerson = async () => {
    if (!newPersonName.trim()) return;
    try {
      const person: PersonRecord = {
        id: crypto.randomUUID(),
        name: newPersonName.trim(),
        relationship: newPersonRelation,
        phone: newPersonPhone.trim(),
        avatarUrl: newPersonAvatar || undefined,
        createdAt: Date.now()
      };
      await addPerson(person);
      setShowAddPersonModal(false);
      setNewPersonName('');
      setNewPersonPhone('');
      setNewPersonAvatar('');
      setNewPersonRelation('Family');
      await loadAllData();
      setSelectedPerson(person); // Open their profile directly
    } catch (err) {
      console.error('Failed to create person card:', err);
      alert('Unable to save person card. Please try again.');
    }
  };

  const handleDeletePerson = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Remove this person from your Gift Ledger?')) {
      await deletePerson(id);
      if (selectedPerson?.id === id) {
        setSelectedPerson(null);
      }
      loadAllData();
    }
  };

  const handleOpenEditPerson = (person: PersonRecord, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setEditingPerson(person);
    setEditPersonName(person.name);
    setEditPersonRelation(person.relationship || 'Family');
    setEditPersonPhone(person.phone || '');
    setEditPersonAvatar(person.avatarUrl || '');
    setShowEditPersonModal(true);
  };

  const handleEditPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxDim = 200;
          let w = img.width;
          let h = img.height;
          if (w > h && w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else if (h > maxDim) {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, w, h);
          setEditPersonAvatar(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSaveEditPerson = async () => {
    if (!editingPerson || !editPersonName.trim()) return;
    try {
      const oldName = editingPerson.name;
      const updated: PersonRecord = {
        ...editingPerson,
        name: editPersonName.trim(),
        relationship: editPersonRelation,
        phone: editPersonPhone.trim() || undefined,
        avatarUrl: editPersonAvatar || undefined
      };
      await updatePersonAndGifts(updated, oldName);
      setShowEditPersonModal(false);
      setEditingPerson(null);
      await loadAllData();
      if (selectedPerson?.id === updated.id) {
        setSelectedPerson(updated);
      }
    } catch (err) {
      console.error('Failed to update person card:', err);
      alert('Unable to save changes. Please try again.');
    }
  };

  const handleSaveGift = async () => {
    if (!selectedPerson) return;

    // Auto title if user left it blank
    let finalItem = itemTitle.trim();
    if (!finalItem) {
      if (giftCategory === 'CASH') finalItem = 'Cash Envelop (Shagun)';
      else if (giftCategory === 'GOLD') finalItem = `Gold (${weightGrams ? weightGrams + 'g' : purity})`;
      else if (giftCategory === 'SILVER') finalItem = `Silver (${weightGrams ? weightGrams + 'g' : 'Item'})`;
      else if (giftCategory === 'CLOTHES') finalItem = 'Clothes / Saree';
      else finalItem = 'Gift Item';
    }

    const timestamp = giftDate ? new Date(giftDate).getTime() : Date.now();

    const gift: GiftTransaction = {
      id: crypto.randomUUID(),
      personId: selectedPerson.id,
      person: selectedPerson.name,
      occasion: occasion,
      type: giftType,
      category: giftCategory,
      item: finalItem,
      amount: Number(amount) || 0,
      weightGrams: (giftCategory === 'GOLD' || giftCategory === 'SILVER') && weightGrams ? Number(weightGrams) : undefined,
      purity: giftCategory === 'GOLD' ? purity : (giftCategory === 'SILVER' ? '92.5 Sterling' : undefined),
      date: timestamp,
      notes: notes.trim()
    };

    await addGift(gift);
    setShowAddGiftModal(false);
    // Reset gift form
    setItemTitle('');
    setAmount('');
    setWeightGrams('');
    setNotes('');
    setGiftCategory('CASH');
    await loadAllData();
  };

  const handleDeleteGiftItem = async (giftId: string) => {
    if (window.confirm('Delete this gift entry?')) {
      await deleteGift(giftId);
      loadAllData();
    }
  };

  // Helper stats for a person
  const getPersonGiftStats = (person: PersonRecord) => {
    const personGifts = gifts.filter(g => g.personId === person.id || g.person.toLowerCase() === person.name.toLowerCase());
    const receivedCount = personGifts.filter(g => g.type === 'RECEIVED').length;
    const givenCount = personGifts.filter(g => g.type === 'GIVEN').length;
    const totalValReceived = personGifts.filter(g => g.type === 'RECEIVED').reduce((s, g) => s + g.amount, 0);
    const totalValGiven = personGifts.filter(g => g.type === 'GIVEN').reduce((s, g) => s + g.amount, 0);
    return { personGifts, receivedCount, givenCount, totalValReceived, totalValGiven };
  };

  const filteredPeople = people.filter(p => 
    p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.relationship?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 relative">
      
      {/* Top Header */}
      {!selectedPerson ? (
        <>
          <div className="flex justify-between items-center mb-1">
            <div>
              <h2 className="text-2xl font-bold text-textMain tracking-tight">Gift Ledger</h2>
              <p className="text-textMuted text-xs">Shagun & Relationship People Cards</p>
            </div>
            <button 
              onClick={() => setShowAddPersonModal(true)}
              className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-full shadow-soft flex items-center space-x-1.5 text-sm font-semibold transition-all active:scale-95"
            >
              <Plus size={18} />
              <span>Add Person</span>
            </button>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search size={18} className="absolute left-3.5 top-3 text-textMuted" />
            <input 
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search relatives, in-laws, friends..."
              className="w-full bg-surface border border-borderLight rounded-full py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-primary-400 focus:ring-1 focus:ring-primary-400 shadow-sm"
            />
          </div>

          {/* People Face Cards Grid */}
          {filteredPeople.length === 0 ? (
            <div className="text-center py-12 bg-surface rounded-2xl border border-dashed border-borderLight p-6">
              <div className="w-16 h-16 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center mx-auto mb-3">
                <Users size={30} />
              </div>
              <h3 className="font-bold text-textMain text-base">No People Added Yet</h3>
              <p className="text-textMuted text-xs mt-1 max-w-xs mx-auto">
                Add your relatives, friends, or neighbours to record Shagun (cash, gold, silver, sarees) given and received.
              </p>
              <button 
                onClick={() => setShowAddPersonModal(true)}
                className="mt-4 bg-primary-600 text-white px-5 py-2 rounded-full text-xs font-bold hover:bg-primary-700 shadow-soft"
              >
                + Add First Person
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 pt-1">
              {filteredPeople.map(person => {
                const stats = getPersonGiftStats(person);
                return (
                  <Card 
                    key={person.id}
                    onClick={() => setSelectedPerson(person)}
                    className="border-none shadow-sm hover:shadow-md transition-all cursor-pointer bg-surface hover:border-primary-200 group active:scale-[0.98] overflow-hidden"
                  >
                    <CardContent className="p-3.5 text-center flex flex-col items-center relative">
                      {/* Action buttons: Edit & Delete */}
                      <div className="absolute right-1.5 top-1.5 flex items-center space-x-1 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button 
                          type="button"
                          onClick={(e) => handleOpenEditPerson(person, e)}
                          className="text-textMuted hover:text-primary-700 p-1 rounded-full hover:bg-primary-50 bg-white/90 shadow-2xs"
                          title="Edit person details"
                        >
                          <Pencil size={13} />
                        </button>
                        <button 
                          type="button"
                          onClick={(e) => handleDeletePerson(person.id, e)}
                          className="text-textMuted hover:text-red-500 p-1 rounded-full hover:bg-red-50 bg-white/90 shadow-2xs"
                          title="Delete person"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Face / Avatar Card */}
                      <div className="w-16 h-16 rounded-full overflow-hidden mb-2.5 ring-2 ring-primary-100 shadow-inner flex items-center justify-center bg-gradient-to-tr from-amber-100 to-primary-50 text-primary-700">
                        {person.avatarUrl ? (
                          <img src={person.avatarUrl} alt={person.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="font-bold text-xl uppercase tracking-wider">
                            {person.name.substring(0, 2)}
                          </span>
                        )}
                      </div>

                      {/* Person Details */}
                      <h4 className="font-bold text-sm text-textMain truncate w-full">{person.name}</h4>
                      <span className="text-[10px] bg-primary-50 text-primary-800 font-semibold px-2 py-0.5 rounded-full mt-1">
                        {person.relationship || 'Relative'}
                      </span>

                      {/* Quick Shagun Summary */}
                      <div className="mt-3 pt-2.5 border-t border-borderLight w-full flex justify-around text-[10px]">
                        <div>
                          <p className="text-textMuted">Recv</p>
                          <p className="font-bold text-green-600">{stats.receivedCount}</p>
                        </div>
                        <div className="border-r border-borderLight" />
                        <div>
                          <p className="text-textMuted">Given</p>
                          <p className="font-bold text-primary-600">{stats.givenCount}</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* ================= PERSON SPECIFIC GIFT HISTORY SCREEN ================= */
        <div className="space-y-5 animate-in fade-in">
          {/* Back button & Person Header */}
          <div className="flex items-center justify-between">
            <button 
              onClick={() => setSelectedPerson(null)}
              className="flex items-center text-sm font-semibold text-textMuted hover:text-textMain py-1"
            >
              <ChevronLeft size={18} className="mr-0.5" />
              Back to People
            </button>

            <button 
              onClick={() => setShowAddGiftModal(true)}
              className="bg-primary-600 hover:bg-primary-700 text-white px-3.5 py-1.5 rounded-full text-xs font-bold shadow-soft flex items-center space-x-1"
            >
              <Plus size={16} />
              <span>Record Gift</span>
            </button>
          </div>

          {/* Person Hero Profile Card */}
          <Card className="border-none bg-gradient-to-br from-amber-50 to-orange-50/50 shadow-sm border border-amber-100">
            <CardContent className="p-4 flex items-center space-x-4">
              <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 ring-2 ring-primary-300 flex items-center justify-center bg-surface text-primary-700 font-bold text-xl shadow-sm">
                {selectedPerson.avatarUrl ? (
                  <img src={selectedPerson.avatarUrl} alt={selectedPerson.name} className="w-full h-full object-cover" />
                ) : (
                  <span>{selectedPerson.name.substring(0, 2).toUpperCase()}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <h3 className="text-lg font-bold text-textMain truncate">{selectedPerson.name}</h3>
                  <button 
                    type="button"
                    onClick={() => handleOpenEditPerson(selectedPerson)}
                    className="p-1 rounded-full text-primary-700 hover:text-primary-800 bg-white/90 hover:bg-white border border-primary-200/80 shadow-2xs transition-all active:scale-95"
                    title="Edit person details"
                  >
                    <Pencil size={13} />
                  </button>
                  <span className="text-[10px] bg-primary-100 text-primary-800 font-bold px-2 py-0.5 rounded-full">
                    {selectedPerson.relationship}
                  </span>
                </div>
                {selectedPerson.phone && (
                  <p className="text-xs text-textMuted mt-0.5">{selectedPerson.phone}</p>
                )}
                {/* Total Shagun exchange */}
                {(() => {
                  const stats = getPersonGiftStats(selectedPerson);
                  return (
                    <div className="flex items-center space-x-3 text-xs mt-2 font-medium">
                      <span className="text-green-700">They gave: <strong>₹{stats.totalValReceived.toLocaleString('en-IN')}</strong></span>
                      <span className="text-primary-700">We gave: <strong>₹{stats.totalValGiven.toLocaleString('en-IN')}</strong></span>
                    </div>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          {/* History of gifts with this person */}
          <div>
            <div className="flex justify-between items-center mb-3 px-1">
              <h4 className="text-sm font-bold text-textMain uppercase tracking-wider">Gift History (Shagun)</h4>
              <span className="text-xs text-textMuted">
                {getPersonGiftStats(selectedPerson).personGifts.length} transactions
              </span>
            </div>

            {(() => {
              const personGifts = getPersonGiftStats(selectedPerson).personGifts;
              if (personGifts.length === 0) {
                return (
                  <div className="text-center py-10 bg-surface rounded-2xl border border-borderLight p-6">
                    <p className="text-textMuted text-xs">No gifts recorded with {selectedPerson.name} yet.</p>
                    <button 
                      onClick={() => setShowAddGiftModal(true)}
                      className="mt-3 text-primary-600 font-bold text-xs hover:underline"
                    >
                      + Record what they gave or what you gave
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {personGifts.map(gift => (
                    <Card key={gift.id} className="border-none shadow-sm hover:shadow-md transition-shadow">
                      <CardContent className="p-3.5 flex items-start space-x-3.5">
                        {/* Category Icon */}
                        <div className={cn(
                          "w-11 h-11 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                          gift.category === 'GOLD' ? 'bg-amber-100 text-amber-700' :
                          gift.category === 'SILVER' ? 'bg-slate-100 text-slate-700' :
                          gift.category === 'CASH' ? 'bg-emerald-100 text-emerald-700' :
                          gift.category === 'CLOTHES' ? 'bg-purple-100 text-purple-700' :
                          'bg-primary-50 text-primary-600'
                        )}>
                          {gift.category === 'GOLD' && <Coins size={20} />}
                          {gift.category === 'SILVER' && <Scale size={20} />}
                          {gift.category === 'CASH' && <Coins size={20} />}
                          {gift.category === 'CLOTHES' && <Shirt size={20} />}
                          {gift.category === 'OTHER' && <Package size={20} />}
                        </div>

                        {/* Gift Details */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-textMain">{gift.item}</span>
                            <span className={cn(
                              "text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider",
                              gift.type === 'RECEIVED' ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
                            )}>
                              {gift.type === 'RECEIVED' ? 'They Gave Us' : 'We Gave Them'}
                            </span>
                          </div>

                          {/* Indian Specs (Weight, Carats, Tola, Occasion) */}
                          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs">
                            <span className="text-textMuted bg-slate-50 px-2 py-0.5 rounded border border-borderLight">
                              {gift.occasion}
                            </span>
                            {gift.weightGrams ? (
                              <span className="text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                {gift.weightGrams}g {gift.purity ? `(${gift.purity})` : ''} 
                                {gift.category === 'GOLD' && gift.weightGrams >= 8 ? ` · ~${(gift.weightGrams / 8).toFixed(1)} Tola/Savaran` : ''}
                              </span>
                            ) : null}
                          </div>

                          {/* Date and notes */}
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-borderLight text-[11px] text-textMuted">
                            <span>{format(new Date(gift.date), 'dd MMMM yyyy')}</span>
                            {gift.amount > 0 && (
                              <span className="font-bold text-textMain text-sm">
                                ₹{gift.amount.toLocaleString('en-IN')}
                              </span>
                            )}
                          </div>

                          {gift.notes && (
                            <p className="text-[11px] text-textMuted italic mt-1 bg-background p-1.5 rounded">
                              "{gift.notes}"
                            </p>
                          )}
                        </div>

                        {/* Delete entry */}
                        <button 
                          onClick={() => handleDeleteGiftItem(gift.id)}
                          className="text-textMuted/40 hover:text-red-500 p-1"
                          title="Delete gift entry"
                        >
                          <Trash2 size={14} />
                        </button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ================= MODAL 1: ADD PERSON (FACE CARD) ================= */}
      {showAddPersonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-5">
                <h3 className="text-lg font-bold text-textMain">Add New Person</h3>
                <button onClick={() => setShowAddPersonModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Photo Upload / Avatar preview */}
                <div className="flex flex-col items-center">
                  <label className="relative cursor-pointer group">
                    <div className="w-20 h-20 rounded-full bg-primary-50 ring-2 ring-primary-300 overflow-hidden flex items-center justify-center text-primary-600 shadow-inner">
                      {newPersonAvatar ? (
                        <img src={newPersonAvatar} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <Camera size={22} />
                          <span className="text-[9px] font-semibold mt-1">Add Photo</span>
                        </div>
                      )}
                    </div>
                    <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                  </label>
                  <span className="text-[10px] text-textMuted mt-1">Tap to select photo (Optional)</span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Person Name *</label>
                  <input 
                    type="text" 
                    value={newPersonName} 
                    onChange={e => setNewPersonName(e.target.value)} 
                    placeholder="e.g. Ramesh Uncle, Kavitha Athai" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Relationship</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {RELATION_TAGS.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setNewPersonRelation(tag)}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                          newPersonRelation === tag 
                            ? "bg-primary-600 text-white shadow-xs" 
                            : "bg-background text-textMuted border border-borderLight"
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    value={newPersonPhone} 
                    onChange={e => setNewPersonPhone(e.target.value)} 
                    placeholder="+91 98765 43210" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  />
                </div>

                <button 
                  onClick={handleCreatePerson} 
                  disabled={!newPersonName.trim()}
                  className="w-full mt-2 py-3 bg-primary-600 disabled:opacity-50 text-white font-bold rounded-xl hover:bg-primary-700 transition-colors shadow-soft"
                >
                  Create Person Card
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================= MODAL: EDIT PERSON DETAILS ================= */}
      {showEditPersonModal && editingPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-textMain flex items-center space-x-1.5">
                    <Pencil size={16} className="text-primary-600" />
                    <span>Edit Person Details</span>
                  </h3>
                  <p className="text-xs text-textMuted">Update information for {editingPerson.name}</p>
                </div>
                <button 
                  onClick={() => {
                    setShowEditPersonModal(false);
                    setEditingPerson(null);
                  }} 
                  className="text-textMuted hover:text-textMain p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Photo Upload / Avatar preview */}
                <div className="flex flex-col items-center">
                  <label className="relative cursor-pointer group">
                    <div className="w-20 h-20 rounded-full bg-primary-50 ring-2 ring-primary-300 overflow-hidden flex items-center justify-center text-primary-600 shadow-inner">
                      {editPersonAvatar ? (
                        <img src={editPersonAvatar} alt="Preview" className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center">
                          <Camera size={22} />
                          <span className="text-[9px] font-semibold mt-1">Change Photo</span>
                        </div>
                      )}
                    </div>
                    <input type="file" accept="image/*" onChange={handleEditPhotoUpload} className="hidden" />
                  </label>
                  <span className="text-[10px] text-textMuted mt-1">Tap to change photo (Optional)</span>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Person Name *</label>
                  <input 
                    type="text" 
                    value={editPersonName} 
                    onChange={e => setEditPersonName(e.target.value)} 
                    placeholder="e.g. Ramesh Uncle, Kavitha Athai" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Relationship</label>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {RELATION_TAGS.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setEditPersonRelation(tag)}
                        className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                          editPersonRelation === tag 
                            ? "bg-primary-600 text-white shadow-xs" 
                            : "bg-background text-textMuted border border-borderLight"
                        )}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Phone Number (Optional)</label>
                  <input 
                    type="tel" 
                    value={editPersonPhone} 
                    onChange={e => setEditPersonPhone(e.target.value)} 
                    placeholder="+91 98765 43210" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  />
                </div>

                <div className="flex space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setShowEditPersonModal(false);
                      setEditingPerson(null);
                    }}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-textMuted font-bold rounded-xl text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    onClick={handleSaveEditPerson} 
                    disabled={!editPersonName.trim()}
                    className="flex-1 py-2.5 bg-primary-600 disabled:opacity-50 text-white font-bold rounded-xl hover:bg-primary-700 transition-colors shadow-soft text-xs"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ================= MODAL 2: ADD GIFT BETWEEN US ================= */}
      {showAddGiftModal && selectedPerson && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-textMain">Record Gift</h3>
                  <p className="text-xs text-textMuted">With {selectedPerson.name}</p>
                </div>
                <button onClick={() => setShowAddGiftModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Given vs Received toggle */}
                <div className="flex bg-borderLight p-1 rounded-full space-x-1">
                  <button 
                    type="button"
                    onClick={() => setGiftType('RECEIVED')}
                    className={cn(
                      "flex-1 py-1.5 rounded-full text-xs font-bold transition-all", 
                      giftType === 'RECEIVED' ? "bg-surface shadow text-green-700" : "text-textMuted"
                    )}
                  >
                    They Gave Us
                  </button>
                  <button 
                    type="button"
                    onClick={() => setGiftType('GIVEN')}
                    className={cn(
                      "flex-1 py-1.5 rounded-full text-xs font-bold transition-all", 
                      giftType === 'GIVEN' ? "bg-surface shadow text-primary-700" : "text-textMuted"
                    )}
                  >
                    We Gave Them
                  </button>
                </div>

                {/* Gift Category dropdown / tabs */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Gift Type / Category *</label>
                  <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                    {[
                      { id: 'CASH', label: '💵 Cash', color: 'border-emerald-200' },
                      { id: 'GOLD', label: '🪙 Gold', color: 'border-amber-200' },
                      { id: 'SILVER', label: '🥈 Silver', color: 'border-slate-200' },
                      { id: 'CLOTHES', label: '👗 Clothes', color: 'border-purple-200' },
                      { id: 'OTHER', label: '🎁 Other', color: 'border-blue-200' },
                    ].map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setGiftCategory(cat.id as GiftCategory)}
                        className={cn(
                          "py-2 px-2 text-xs font-bold rounded-xl border transition-all text-center",
                          giftCategory === cat.id 
                            ? "bg-primary-600 text-white border-primary-600 shadow-soft" 
                            : "bg-background text-textMain border-borderLight hover:bg-slate-50"
                        )}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Specific item name */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">
                    Item Description (e.g. Ring, Chain, Silk Saree, Envelop)
                  </label>
                  <input 
                    type="text" 
                    value={itemTitle} 
                    onChange={e => setItemTitle(e.target.value)} 
                    placeholder={
                      giftCategory === 'GOLD' ? 'e.g. Gold Ring, Gold Coin, Chain' :
                      giftCategory === 'SILVER' ? 'e.g. Silver Lamp (Diya), Silver Coin, Glass' :
                      giftCategory === 'CLOTHES' ? 'e.g. Pattu Saree, Kurta set' :
                      giftCategory === 'CASH' ? 'e.g. Shagun Envelop' :
                      'e.g. Home Appliance, Sweet Box'
                    }
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  />
                </div>

                {/* GOLD & SILVER Specific Indian calculation fields (Grams, Carats) */}
                {(giftCategory === 'GOLD' || giftCategory === 'SILVER') && (
                  <div className="bg-amber-50/70 border border-amber-200 p-3 rounded-xl space-y-2.5">
                    <div className="flex items-center text-amber-900 text-xs font-bold">
                      <Scale size={14} className="mr-1.5 text-amber-700" />
                      Weight & Carat Details (Indian Household Standard)
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] font-semibold text-amber-900">Weight (Grams)</label>
                        <input 
                          type="number" 
                          step="0.1"
                          value={weightGrams} 
                          onChange={e => setWeightGrams(e.target.value)} 
                          placeholder="e.g. 8 (1 Tola)" 
                          className="w-full mt-1 p-2 bg-surface rounded-lg border border-amber-200 outline-none text-xs font-bold"
                        />
                      </div>

                      {giftCategory === 'GOLD' ? (
                        <div>
                          <label className="text-[11px] font-semibold text-amber-900">Purity</label>
                          <select 
                            value={purity} 
                            onChange={e => setPurity(e.target.value)}
                            className="w-full mt-1 p-2 bg-surface rounded-lg border border-amber-200 outline-none text-xs font-bold"
                          >
                            <option value="22K">22 Karat (Jewellery)</option>
                            <option value="24K">24 Karat (Coin/Bar)</option>
                            <option value="18K">18 Karat</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="text-[11px] font-semibold text-amber-900">Type</label>
                          <input 
                            type="text" 
                            disabled 
                            value="92.5 Sterling / Pure" 
                            className="w-full mt-1 p-2 bg-surface/50 rounded-lg border border-amber-200 outline-none text-xs text-textMuted"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Monetary Value & Date */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Monetary Value (₹)</label>
                    <input 
                      type="number" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)} 
                      placeholder={giftCategory === 'CASH' ? '501, 1116...' : 'Est. value'} 
                      className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Date of Occasion</label>
                    <input 
                      type="date" 
                      value={giftDate} 
                      onChange={e => setGiftDate(e.target.value)} 
                      className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain"
                    />
                  </div>
                </div>

                {/* Occasion Dropdown */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Occasion</label>
                  <select 
                    value={occasion} 
                    onChange={e => setOccasion(e.target.value)}
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm"
                  >
                    {OCCASIONS.map(occ => (
                      <option key={occ} value={occ}>{occ}</option>
                    ))}
                  </select>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Notes / Reciprocal Reminder</label>
                  <input 
                    type="text" 
                    value={notes} 
                    onChange={e => setNotes(e.target.value)} 
                    placeholder="e.g. Return gift given at reception" 
                    className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs"
                  />
                </div>

                <button 
                  onClick={handleSaveGift}
                  className="w-full mt-2 py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl shadow-soft transition-colors text-sm"
                >
                  Save to {selectedPerson.name}'s History
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
