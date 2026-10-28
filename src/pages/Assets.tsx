import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  Shield, 
  Lock, 
  Eye, 
  EyeOff, 
  Plus, 
  Trash2, 
  Edit3, 
  Coins, 
  Landmark, 
  Building2, 
  Car, 
  TrendingUp, 
  Sparkles, 
  X, 
  CheckCircle2, 
  MapPin, 
  FileText, 
  ArrowLeft,
  Briefcase
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { 
  getAssets, 
  addAsset, 
  updateAsset, 
  deleteAsset, 
  getDebts, 
  AssetRecord, 
  AssetCategory 
} from '@/lib/db';
import { isVaultUnlocked, setVaultUnlocked } from '@/lib/security';
import { format } from 'date-fns';

const CATEGORY_CONFIG: Record<AssetCategory, { label: string; icon: any; defaultUnit: string; units: string[]; color: string }> = {
  GOLD_SILVER: {
    label: 'Gold & Precious Metals',
    icon: Coins,
    defaultUnit: 'Grams',
    units: ['Grams', 'Tolas', 'Sovereigns', 'Items'],
    color: 'from-amber-500 to-amber-700'
  },
  REAL_ESTATE: {
    label: 'Land & Real Estate',
    icon: Building2,
    defaultUnit: 'Acres',
    units: ['Acres', 'Guntas', 'Sq. Yards', 'Sq. Feet', 'Plots'],
    color: 'from-emerald-600 to-emerald-800'
  },
  FINANCIAL: {
    label: 'Bank FDs & Guaranteed Capital',
    icon: Landmark,
    defaultUnit: 'Accounts',
    units: ['Accounts', 'Certificates', 'Units'],
    color: 'from-blue-600 to-blue-800'
  },
  VEHICLE: {
    label: 'Vehicles & Machinery',
    icon: Car,
    defaultUnit: 'Vehicles',
    units: ['Vehicles', 'Machines', 'Items'],
    color: 'from-purple-600 to-purple-800'
  },
  OTHER: {
    label: 'Other High-Value Assets',
    icon: Briefcase,
    defaultUnit: 'Items',
    units: ['Items', 'Units'],
    color: 'from-slate-600 to-slate-800'
  }
};

export const AssetsPage: React.FC = () => {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [totalDebtsOwed, setTotalDebtsOwed] = useState<number>(0);
  const [hideValues, setHideValues] = useState<boolean>(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Add / Edit Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<AssetRecord | null>(null);

  // Form Fields
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<AssetCategory>('GOLD_SILVER');
  const [formPurchaseValue, setFormPurchaseValue] = useState('');
  const [formCurrentValue, setFormCurrentValue] = useState('');
  const [formQuantity, setFormQuantity] = useState('1');
  const [formUnit, setFormUnit] = useState('Grams');
  const [formLocation, setFormLocation] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDate, setFormDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Auth Guard: if not unlocked in memory, kick back to dashboard
  useEffect(() => {
    if (!isVaultUnlocked()) {
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // Relock on tab hide / app background
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setVaultUnlocked(false);
        navigate('/', { replace: true });
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [navigate]);

  const loadData = async () => {
    const [fetchedAssets, debts] = await Promise.all([
      getAssets(),
      getDebts()
    ]);
    setAssets(fetchedAssets);

    // Sum liabilities we owe to others
    const liabilities = debts
      .filter(d => d.type === 'WE_OWE' && d.status !== 'SETTLED')
      .reduce((sum, d) => sum + (d.amount || d.principalAmount || 0), 0);
    setTotalDebtsOwed(liabilities);
  };

  useEffect(() => {
    loadData();
  }, []);

  // Aggregations
  const totalCurrentValue = useMemo(() => {
    return assets.reduce((sum, a) => sum + (Number(a.currentValue) || 0), 0);
  }, [assets]);

  const totalPurchaseBasis = useMemo(() => {
    return assets.reduce((sum, a) => sum + (Number(a.purchaseValue) || 0), 0);
  }, [assets]);

  const netWorth = totalCurrentValue - totalDebtsOwed;
  const unrealizedGrowth = totalCurrentValue - totalPurchaseBasis;
  const growthPercentage = totalPurchaseBasis > 0 ? Math.round((unrealizedGrowth / totalPurchaseBasis) * 100) : 0;

  // Gold specifics
  const totalGoldGrams = useMemo(() => {
    return assets
      .filter(a => a.type === 'GOLD_SILVER')
      .reduce((sum, a) => {
        const qty = Number(a.quantity) || 0;
        if (a.unit === 'Tolas') return sum + qty * 11.6638;
        return sum + qty;
      }, 0);
  }, [assets]);

  // Land specifics
  const totalLandAcres = useMemo(() => {
    return assets
      .filter(a => a.type === 'REAL_ESTATE')
      .reduce((sum, a) => {
        const qty = Number(a.quantity) || 0;
        if (a.unit === 'Guntas') return sum + qty / 40;
        if (a.unit === 'Acres') return sum + qty;
        return sum;
      }, 0);
  }, [assets]);

  const handleLockAndExit = () => {
    setVaultUnlocked(false);
    navigate('/', { replace: true });
  };

  const openAddModal = (category?: AssetCategory) => {
    const targetType = category || 'GOLD_SILVER';
    setEditingAsset(null);
    setFormName('');
    setFormType(targetType);
    setFormPurchaseValue('');
    setFormCurrentValue('');
    setFormQuantity('1');
    setFormUnit(CATEGORY_CONFIG[targetType].defaultUnit);
    setFormLocation('');
    setFormNotes('');
    setFormDate(new Date().toISOString().split('T')[0]);
    setIsModalOpen(true);
  };

  const openEditModal = (asset: AssetRecord) => {
    setEditingAsset(asset);
    setFormName(asset.name);
    setFormType(asset.type);
    setFormPurchaseValue(String(asset.purchaseValue || ''));
    setFormCurrentValue(String(asset.currentValue || ''));
    setFormQuantity(String(asset.quantity || '1'));
    setFormUnit(asset.unit || CATEGORY_CONFIG[asset.type].defaultUnit);
    setFormLocation(asset.locationOrLocker || '');
    setFormNotes(asset.notes || '');
    setFormDate(asset.dateAcquired || new Date().toISOString().split('T')[0]);
    setIsModalOpen(true);
  };

  const handleSaveAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const purchase = Number(formPurchaseValue) || 0;
    const current = Number(formCurrentValue) || purchase;

    const payload = {
      name: formName.trim(),
      type: formType,
      purchaseValue: purchase,
      currentValue: current,
      quantity: Number(formQuantity) || 1,
      unit: formUnit,
      locationOrLocker: formLocation.trim() || undefined,
      notes: formNotes.trim() || undefined,
      dateAcquired: formDate || new Date().toISOString().split('T')[0]
    };

    if (editingAsset) {
      await updateAsset({
        ...editingAsset,
        ...payload
      });
    } else {
      await addAsset(payload);
    }

    setIsModalOpen(false);
    await loadData();
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to remove this asset record from your private vault?')) {
      await deleteAsset(id);
      await loadData();
    }
  };

  const filteredAssets = useMemo(() => {
    if (selectedCategory === 'ALL') return assets;
    return assets.filter(a => a.type === selectedCategory);
  }, [assets, selectedCategory]);

  const mask = (value: number) => {
    if (hideValues) return '₹ ••••••••';
    return `₹${value.toLocaleString('en-IN')}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-6 pb-28 space-y-6 antialiased selection:bg-amber-500 selection:text-black">
      
      {/* Top Header Bar */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div className="flex items-center space-x-3">
          <button
            type="button"
            onClick={handleLockAndExit}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title="Exit & Lock Vault"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2">
                <span>Assets</span>
                <span className="bg-gradient-to-r from-amber-400 to-amber-200 bg-clip-text text-transparent">Vault</span>
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider flex items-center gap-1">
                <Lock size={10} /> Secret
              </span>
            </div>
            <p className="text-xs text-slate-400 font-medium">Confidential Sovereign Family Balance Sheet</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Eye Toggle */}
          <button
            type="button"
            onClick={() => setHideValues(!hideValues)}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title={hideValues ? 'Unhide Numbers' : 'Privacy Mode'}
          >
            {hideValues ? <EyeOff size={16} className="text-amber-400" /> : <Eye size={16} />}
          </button>

          {/* Quick Lock Button */}
          <button
            type="button"
            onClick={handleLockAndExit}
            className="px-3 py-2 rounded-xl bg-gradient-to-r from-red-600/80 to-red-700 hover:from-red-600 hover:to-red-800 text-white font-bold text-xs flex items-center space-x-1.5 shadow-md transition-all active:scale-95 cursor-pointer"
          >
            <Lock size={13} />
            <span>Lock</span>
          </button>
        </div>
      </div>

      {/* Hero Card: Total Family Net Worth */}
      <Card className="border border-amber-500/40 bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 shadow-2xl rounded-3xl overflow-hidden relative">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <CardContent className="p-6 relative z-10 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase font-extrabold tracking-wider text-amber-400 flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-400" />
              <span>True Family Net Worth</span>
            </span>
            <span className="text-[11px] text-slate-400 font-medium">
              Assets - Outstanding Debts
            </span>
          </div>

          <div>
            <div className="text-3xl sm:text-4xl font-black text-white tracking-tight">
              {mask(netWorth)}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-semibold">
              <span className="text-emerald-400 flex items-center gap-1">
                <TrendingUp size={14} />
                <span>Growth: {mask(unrealizedGrowth)} ({growthPercentage >= 0 ? `+${growthPercentage}%` : `${growthPercentage}%`})</span>
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400">
                Gross Assets: <strong className="text-slate-200">{mask(totalCurrentValue)}</strong>
              </span>
              {totalDebtsOwed > 0 && (
                <>
                  <span className="text-slate-500">·</span>
                  <span className="text-red-400">
                    Liabilities: <strong>-{mask(totalDebtsOwed)}</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Quick Snapshot Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-2 border-t border-slate-800">
            <div className="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
              <span className="text-[10px] text-amber-300 font-bold uppercase tracking-wider block">Gold Vault</span>
              <span className="text-sm font-extrabold text-white mt-0.5 block">
                {hideValues ? '••• g' : `${totalGoldGrams.toFixed(1)} g`}
              </span>
              <span className="text-[10px] text-slate-400">
                {hideValues ? '•• Tolas' : `~${(totalGoldGrams / 11.66).toFixed(1)} Tolas`}
              </span>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
              <span className="text-[10px] text-emerald-300 font-bold uppercase tracking-wider block">Land Holdings</span>
              <span className="text-sm font-extrabold text-white mt-0.5 block">
                {hideValues ? '••• Acres' : `${totalLandAcres.toFixed(2)} Acres`}
              </span>
              <span className="text-[10px] text-slate-400">
                {hideValues ? '•• Guntas' : `${(totalLandAcres * 40).toFixed(0)} Guntas`}
              </span>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
              <span className="text-[10px] text-blue-300 font-bold uppercase tracking-wider block">Purchase Cost</span>
              <span className="text-sm font-extrabold text-white mt-0.5 block">
                {mask(totalPurchaseBasis)}
              </span>
              <span className="text-[10px] text-slate-400">Invested Basis</span>
            </div>

            <div className="p-2.5 rounded-2xl bg-slate-800/60 border border-slate-700/60">
              <span className="text-[10px] text-purple-300 font-bold uppercase tracking-wider block">Holdings Count</span>
              <span className="text-sm font-extrabold text-white mt-0.5 block">
                {assets.length} Assets
              </span>
              <span className="text-[10px] text-slate-400">Cataloged</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Category Filter Pills & Add Button */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setSelectedCategory('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-amber-500 text-black shadow-md'
                : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            All ({assets.length})
          </button>
          {(Object.keys(CATEGORY_CONFIG) as AssetCategory[]).map(catKey => {
            const count = assets.filter(a => a.type === catKey).length;
            return (
              <button
                key={catKey}
                type="button"
                onClick={() => setSelectedCategory(catKey)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  selectedCategory === catKey
                    ? 'bg-amber-500 text-black shadow-md'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                {CATEGORY_CONFIG[catKey].label.split(' ')[0]} ({count})
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => openAddModal()}
          className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs shadow-md transition-all active:scale-95 flex items-center space-x-1 shrink-0 cursor-pointer"
        >
          <Plus size={15} />
          <span>Add Asset</span>
        </button>
      </div>

      {/* Asset Items List */}
      <div className="space-y-3">
        {filteredAssets.map(asset => {
          const config = CATEGORY_CONFIG[asset.type] || CATEGORY_CONFIG.OTHER;
          const Icon = config.icon;
          const appreciation = (asset.currentValue || 0) - (asset.purchaseValue || 0);

          return (
            <div
              key={asset.id}
              className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800/90 hover:border-amber-500/40 shadow-sm transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
            >
              <div className="flex items-start space-x-3.5 min-w-0">
                <div className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${config.color} text-white flex items-center justify-center shrink-0 shadow-md`}>
                  <Icon size={20} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center space-x-2 flex-wrap">
                    <h3 className="font-extrabold text-white text-sm truncate">{asset.name}</h3>
                    <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-slate-800 text-amber-300 border border-slate-700">
                      {asset.quantity} {asset.unit}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mt-1">
                    {asset.locationOrLocker && (
                      <span className="flex items-center gap-1 text-slate-300 text-[11px]">
                        <MapPin size={11} className="text-amber-400" />
                        <span>{asset.locationOrLocker}</span>
                      </span>
                    )}
                    {asset.dateAcquired && (
                      <span className="text-[11px] text-slate-500">
                        Acquired: {format(new Date(asset.dateAcquired), 'MMM yyyy')}
                      </span>
                    )}
                  </div>

                  {asset.notes && (
                    <p className="text-[11px] text-slate-400 italic mt-0.5 truncate max-w-xs sm:max-w-md">
                      "{asset.notes}"
                    </p>
                  )}
                </div>
              </div>

              {/* Valuation & Actions */}
              <div className="flex items-center justify-between sm:justify-end space-x-4 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-800/60 shrink-0">
                <div className="text-left sm:text-right">
                  <div className="text-base font-extrabold text-white">
                    {mask(asset.currentValue)}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Paid: {mask(asset.purchaseValue)}
                    {appreciation !== 0 && (
                      <span className={appreciation > 0 ? ' text-emerald-400 font-bold ml-1' : ' text-red-400 font-bold ml-1'}>
                        ({appreciation > 0 ? '+' : ''}{mask(appreciation)})
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => openEditModal(asset)}
                    className="p-2 rounded-xl text-slate-400 hover:text-amber-400 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Edit Asset"
                  >
                    <Edit3 size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(asset.id)}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-400 hover:bg-slate-800 transition-colors cursor-pointer"
                    title="Delete Asset"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {filteredAssets.length === 0 && (
          <div className="p-10 rounded-3xl bg-slate-900/50 border border-slate-800 text-center space-y-3">
            <Coins size={36} className="mx-auto text-amber-500/40" />
            <h4 className="font-bold text-white text-base">Your Vault is Empty</h4>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Securely catalog your family's gold jewelry, ancestral lands, fixed deposits, and vehicles in this secret encrypted vault.
            </p>
            <button
              type="button"
              onClick={() => openAddModal()}
              className="mt-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs rounded-xl shadow-md transition-all active:scale-95 cursor-pointer inline-flex items-center space-x-1.5"
            >
              <Plus size={14} />
              <span>Catalog First Asset</span>
            </button>
          </div>
        )}
      </div>

      {/* Add / Edit Asset Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <Card className="w-full max-w-md border border-amber-500/30 bg-slate-900 text-white rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6 space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
                    <Coins size={16} />
                  </div>
                  <h3 className="font-extrabold text-base text-white">
                    {editingAsset ? 'Edit Asset Record' : 'Catalog New Asset'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1 rounded-full cursor-pointer"
                >
                  <X size={18} />
                </button>
              </div>

              <form onSubmit={handleSaveAsset} className="space-y-3.5">
                {/* Asset Category Selector */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1.5">Asset Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.keys(CATEGORY_CONFIG) as AssetCategory[]).map(typeKey => {
                      const cfg = CATEGORY_CONFIG[typeKey];
                      const Icon = cfg.icon;
                      const isSel = formType === typeKey;
                      return (
                        <button
                          key={typeKey}
                          type="button"
                          onClick={() => {
                            setFormType(typeKey);
                            setFormUnit(cfg.defaultUnit);
                          }}
                          className={`p-2.5 rounded-xl border text-xs font-bold flex items-center space-x-2 transition-all cursor-pointer ${
                            isSel
                              ? 'bg-amber-500 text-black border-amber-400 shadow-md'
                              : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                          }`}
                        >
                          <Icon size={15} />
                          <span className="truncate">{cfg.label.split(' ')[0]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Asset Name */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Asset Name / Title</label>
                  <input
                    type="text"
                    required
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    placeholder={
                      formType === 'GOLD_SILVER' ? 'e.g. 22K Gold Bangles & Necklace' :
                      formType === 'REAL_ESTATE' ? 'e.g. 3 Acres Agricultural Land (Survey #142)' :
                      formType === 'FINANCIAL' ? 'e.g. SBI 3-Year Fixed Deposit' :
                      'e.g. Mahindra Tractor 575 DI'
                    }
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:border-amber-500 outline-none"
                  />
                </div>

                {/* Quantity & Unit */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Quantity / Size</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={formQuantity}
                      onChange={e => setFormQuantity(e.target.value)}
                      placeholder="1"
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Measurement Unit</label>
                    <select
                      value={formUnit}
                      onChange={e => setFormUnit(e.target.value)}
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:border-amber-500 outline-none"
                    >
                      {CATEGORY_CONFIG[formType].units.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Valuation (Purchase vs Current) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Purchase / Cost (₹)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={formPurchaseValue}
                      onChange={e => {
                        setFormPurchaseValue(e.target.value);
                        if (!formCurrentValue) setFormCurrentValue(e.target.value);
                      }}
                      placeholder="Amount paid"
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">Current Value (₹)</label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={formCurrentValue}
                      onChange={e => setFormCurrentValue(e.target.value)}
                      placeholder="Market value"
                      className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-semibold text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                </div>

                {/* Physical Location / Locker */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Locker / Custody Location</label>
                  <input
                    type="text"
                    value={formLocation}
                    onChange={e => setFormLocation(e.target.value)}
                    placeholder="e.g. SBI Main Branch Locker #42 / Home Safe / Patta Passbook"
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-medium text-white focus:border-amber-500 outline-none"
                  />
                </div>

                {/* Date Acquired */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Date Acquired</label>
                  <input
                    type="date"
                    max={new Date().toISOString().split('T')[0]}
                    value={formDate}
                    onChange={e => setFormDate(e.target.value)}
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-medium text-white focus:border-amber-500 outline-none"
                  />
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Confidential Notes / Deed Details</label>
                  <input
                    type="text"
                    value={formNotes}
                    onChange={e => setFormNotes(e.target.value)}
                    placeholder="e.g. Registered in mother's name, Certificate #889"
                    className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-xl text-xs font-medium text-white focus:border-amber-500 outline-none"
                  />
                </div>

                {/* Save Buttons */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-black font-extrabold rounded-xl text-xs shadow-md transition-all active:scale-95 cursor-pointer"
                  >
                    {editingAsset ? 'Update Asset' : 'Save to Vault'}
                  </button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
};

export default AssetsPage;
