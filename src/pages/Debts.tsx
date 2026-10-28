import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  Users, 
  AlertCircle, 
  CheckCircle2, 
  ChevronRight, 
  Phone, 
  Plus, 
  X, 
  Calculator, 
  Percent, 
  Calendar, 
  TrendingUp, 
  Trash2,
  Edit2,
  CreditCard,
  History,
  Camera,
  MapPin,
  Clock,
  Eye,
  Check,
  ShieldCheck,
  Navigation,
  RotateCcw,
  Image as ImageIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { 
  getDebts, 
  addDebt, 
  updateDebt,
  deleteDebt,
  updateDebtStatus, 
  recordDebtPayment,
  recordAtomicDebtPaymentAndCashflow,
  deleteDebtPayment,
  DebtRecordItem, 
  DebtPayment 
} from '@/lib/db';
import { ConfirmDeleteModal } from '@/components/ConfirmDeleteModal';
import { format } from 'date-fns';
import { capturePhoto } from '@/lib/camera';
import { useAuth } from '@/context/AuthContext';

const PAYMENT_MODES = ['UPI (GPay / PhonePe / Paytm)', 'Cash (Hand-to-Hand)', 'Bank NEFT / IMPS', 'Cheque', 'Other'];

const Debts: React.FC = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'SETTLED'>('PENDING');
  const [debts, setDebts] = useState<DebtRecordItem[]>([]);
  
  // Modals
  const [showModal, setShowModal] = useState(false);
  const [editingDebt, setEditingDebt] = useState<DebtRecordItem | null>(null);
  
  // Repayment Modal
  const [repaymentDebt, setRepaymentDebt] = useState<DebtRecordItem | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayStr);
  const [payMode, setPayMode] = useState(PAYMENT_MODES[0]);
  const [payNotes, setPayNotes] = useState('');

  // Proof Camera & Geo-Location States
  const [proofPhoto, setProofPhoto] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number; accuracy?: number } | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [verifiedTimestamp, setVerifiedTimestamp] = useState<number | null>(null);

  // Proof Preview Modal
  const [viewProofPayment, setViewProofPayment] = useState<DebtPayment | null>(null);

  // Deletion and Reopen Confirmation Modals
  const [deleteTargetDebt, setDeleteTargetDebt] = useState<DebtRecordItem | null>(null);
  const [deleteTargetPayment, setDeleteTargetPayment] = useState<{ debtId: string; payment: DebtPayment } | null>(null);
  const [reopenTargetDebt, setReopenTargetDebt] = useState<DebtRecordItem | null>(null);

  // Form State (Add / Edit)
  const [person, setPerson] = useState('');
  const [avatarPhoto, setAvatarPhoto] = useState<string | null>(null);
  const [principal, setPrincipal] = useState('');
  const [debtType, setDebtType] = useState<'WE_OWE' | 'OWED_TO_US'>('OWED_TO_US');
  const [dueDateStr, setDueDateStr] = useState('');
  const [startDateStr, setStartDateStr] = useState(todayStr);
  const [notes, setNotes] = useState('');

  // Interest & Formula Engine State
  const [interestType, setInterestType] = useState<'NONE' | 'VADDI_MONTHLY' | 'SIMPLE_ANNUAL' | 'COMPOUND_ANNUAL' | 'CUSTOM'>('NONE');
  const [interestRate, setInterestRate] = useState('2'); // default 2% / 2 rupees
  const [tenureMonths, setTenureMonths] = useState('6');
  const [customFormula, setCustomFormula] = useState('P * 0.02 * M');

  useEffect(() => {
    fetchDebts();
  }, [user?.id]);

  const fetchDebts = async () => {
    const data = await getDebts();
    setDebts(data.sort((a, b) => b.dateCreated - a.dateCreated));
  };

  // Calculation Engine
  const calculateFinalAmounts = () => {
    const P = Number(principal) || 0;
    const R = Number(interestRate) || 0;
    const M = Number(tenureMonths) || 0;

    if (P <= 0) return { interest: 0, finalTotal: 0, explanation: '' };

    if (interestType === 'NONE') {
      return { interest: 0, finalTotal: P, explanation: 'No interest applicable (Friendly / Zero interest)' };
    }

    if (interestType === 'VADDI_MONTHLY') {
      const monthlyRate = R / 100;
      const interest = P * monthlyRate * M;
      return { 
        interest: Math.round(interest), 
        finalTotal: Math.round(P + interest), 
        explanation: `₹${R} per ₹100/mo = ₹${Math.round(P * monthlyRate)}/mo × ${M} months` 
      };
    }

    if (interestType === 'SIMPLE_ANNUAL') {
      const T = M / 12;
      const interest = (P * R * T) / 100;
      return { 
        interest: Math.round(interest), 
        finalTotal: Math.round(P + interest), 
        explanation: `${R}% per annum for ${M} months (${T.toFixed(1)} years)` 
      };
    }

    if (interestType === 'COMPOUND_ANNUAL') {
      const T = M / 12;
      const compoundTotal = P * Math.pow(1 + R / 100, T);
      const interest = compoundTotal - P;
      return { 
        interest: Math.round(interest), 
        finalTotal: Math.round(compoundTotal), 
        explanation: `${R}% annual compound interest over ${M} months` 
      };
    }

    if (interestType === 'CUSTOM') {
      try {
        const sanitized = customFormula.replace(/\s+/g, '');
        if (/^[0-9+\-*/().PRM]+$/.test(sanitized)) {
          const expr = sanitized
            .replace(/P/g, String(P))
            .replace(/R/g, String(R))
            .replace(/M/g, String(M));
          const calcResult = Function(`"use strict"; return (${expr})`)();
          const interest = Number(calcResult) || 0;
          return { 
            interest: Math.round(interest), 
            finalTotal: Math.round(P + interest), 
            explanation: `Formula [${customFormula}] evaluated with P=${P}, R=${R}, M=${M}` 
          };
        }
      } catch {
        // Fallback
      }
      return { interest: 0, finalTotal: P, explanation: 'Custom expression error' };
    }

    return { interest: 0, finalTotal: P, explanation: '' };
  };

  const calculated = calculateFinalAmounts();

  // Camera & Geolocation Handlers
  const captureGeoLocation = () => {
    if (!navigator.geolocation) {
      setLocError('Geolocation not supported on this device/browser.');
      return;
    }
    setLocLoading(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy)
        });
        setVerifiedTimestamp(Date.now());
        setLocLoading(false);
      },
      (err) => {
        setLocLoading(false);
        setLocError(err.message || 'Location permission denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const processProofImageData = (dataUrl: string) => {
    const now = Date.now();
    setVerifiedTimestamp(now);

    const img = new Image();
    img.onload = () => {
      // Off-screen canvas to watermark timestamp onto image directly
      const canvas = document.createElement('canvas');
      const maxDim = 800;
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
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);

        // Watermark overlay banner at bottom
        const bannerHeight = 36;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
        ctx.fillRect(0, h - bannerHeight, w, bannerHeight);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 13px Inter, sans-serif';
        const stampText = `HEMA VERIFIED PROOF • ${format(now, 'dd MMM yyyy, hh:mm:ss a')}`;
        ctx.fillText(stampText, 12, h - 14);

        setProofPhoto(canvas.toDataURL('image/jpeg', 0.82));
      }
    };
    img.src = dataUrl;
  };

  const handlePickProofPhoto = async (source: 'camera' | 'photos') => {
    captureGeoLocation();
    try {
      const dataUrl = await capturePhoto(source);
      if (dataUrl) {
        processProofImageData(dataUrl);
      }
    } catch (e) {
      console.warn('Native proof capture failed, fallback to file input:', e);
    }
  };

  const handleProofPhotoCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      captureGeoLocation();
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processProofImageData(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const processAvatarImageData = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxDim = 300;
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
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        setAvatarPhoto(canvas.toDataURL('image/jpeg', 0.8));
      }
    };
    img.src = dataUrl;
  };

  const handlePickAvatar = async (source: 'camera' | 'photos') => {
    try {
      const dataUrl = await capturePhoto(source);
      if (dataUrl) {
        processAvatarImageData(dataUrl);
      }
    } catch (e) {
      console.warn('Native avatar capture failed:', e);
    }
  };

  const handleAvatarCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          processAvatarImageData(event.target.result as string);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // Open Edit Modal populated with existing values
  const handleOpenEdit = (debt: DebtRecordItem) => {
    setEditingDebt(debt);
    setPerson(debt.person);
    setAvatarPhoto(debt.avatarUrl || null);
    setPrincipal(String(debt.principalAmount || debt.amount));
    setDebtType(debt.type);
    setDueDateStr(debt.dueDate ? new Date(debt.dueDate).toISOString().split('T')[0] : '');
    setStartDateStr(debt.dateCreated ? new Date(debt.dateCreated).toISOString().split('T')[0] : todayStr);
    setNotes(debt.notes || '');
    setInterestType(debt.interestType || 'NONE');
    setInterestRate(String(debt.interestRate ?? 2));
    setTenureMonths(String(debt.tenureMonths ?? 6));
    setCustomFormula(debt.customFormula || 'P * 0.02 * M');
    setShowModal(true);
  };

  const handleOpenAdd = () => {
    setEditingDebt(null);
    setPerson('');
    setAvatarPhoto(null);
    setPrincipal('');
    setDueDateStr('');
    setStartDateStr(todayStr);
    setNotes('');
    setInterestType('NONE');
    setInterestRate('2');
    setTenureMonths('6');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!person || !principal) return;

    const P = Number(principal);
    const totalRepayable = calculated.finalTotal > 0 ? calculated.finalTotal : P;
    const startTimestamp = startDateStr ? new Date(startDateStr).getTime() : Date.now();
    const defaultDueTimestamp = startTimestamp + (Number(tenureMonths) || 1) * 30 * 86400000;
    const finalDueDate = dueDateStr ? new Date(dueDateStr).getTime() : defaultDueTimestamp;

    if (editingDebt) {
      const updatedItem: DebtRecordItem = {
        ...editingDebt,
        person: person.trim(),
        avatarUrl: avatarPhoto || undefined,
        principalAmount: P,
        amount: totalRepayable,
        type: debtType,
        interestType,
        interestRate: interestType !== 'NONE' ? Number(interestRate) : undefined,
        tenureMonths: interestType !== 'NONE' ? Number(tenureMonths) : undefined,
        interestAmount: calculated.interest,
        customFormula: interestType === 'CUSTOM' ? customFormula : undefined,
        dueDate: finalDueDate,
        dateCreated: startTimestamp,
        notes: notes.trim()
      };
      await updateDebt(updatedItem);
    } else {
      const newItem: DebtRecordItem = {
        id: crypto.randomUUID(),
        person: person.trim(),
        avatarUrl: avatarPhoto || undefined,
        principalAmount: P,
        amount: totalRepayable,
        type: debtType,
        status: 'PENDING',
        interestType,
        interestRate: interestType !== 'NONE' ? Number(interestRate) : undefined,
        tenureMonths: interestType !== 'NONE' ? Number(tenureMonths) : undefined,
        interestAmount: calculated.interest,
        customFormula: interestType === 'CUSTOM' ? customFormula : undefined,
        dueDate: finalDueDate,
        dateCreated: startTimestamp,
        notes: notes.trim(),
        payments: []
      };
      await addDebt(newItem);
    }

    setShowModal(false);
    setEditingDebt(null);
    setAvatarPhoto(null);
    fetchDebts();
  };

  const handleDelete = (debt: DebtRecordItem) => {
    setDeleteTargetDebt(debt);
  };

  const handleOpenSettleWithProof = (debt: DebtRecordItem) => {
    const { remaining } = getDebtBalance(debt);
    setRepaymentDebt(debt);
    setPayAmount(String(remaining > 0 ? remaining : debt.amount));
    setPayDate(todayStr);
    setPayNotes('Full final settlement');
    setProofPhoto(null);
    setCoords(null);
    setVerifiedTimestamp(Date.now());
  };

  const handleReopenDebt = (debt: DebtRecordItem) => {
    setReopenTargetDebt(debt);
  };

  // Record Payment with Proof Photo + Geolocation + Timestamp
  const handleRecordPayment = async () => {
    if (!repaymentDebt || !payAmount || Number(payAmount) <= 0) return;

    const safeDate = payDate ? new Date(payDate).getTime() : Date.now();

    await recordAtomicDebtPaymentAndCashflow({
      debtId: repaymentDebt.id,
      amount: Number(payAmount),
      date: safeDate,
      notes: payNotes.trim() || undefined,
      paymentMode: payMode,
      syncToCashflow: true
    });

    // Reset repayment state
    setRepaymentDebt(null);
    setPayAmount('');
    setPayNotes('');
    setProofPhoto(null);
    setCoords(null);
    setVerifiedTimestamp(null);
    fetchDebts();
  };

  const filtered = debts.filter(d => 
    activeTab === 'PENDING' ? d.status !== 'SETTLED' : d.status === 'SETTLED'
  );

  const getDebtBalance = (debt: DebtRecordItem) => {
    const totalDue = debt.amount || debt.principalAmount || 0;
    const paidSoFar = (debt.payments || []).reduce((sum, p) => sum + p.amount, 0);
    const remaining = Math.max(0, totalDue - paidSoFar);
    return { totalDue, paidSoFar, remaining };
  };

  const weOweTotal = debts
    .filter(d => d.type === 'WE_OWE' && d.status !== 'SETTLED')
    .reduce((acc, d) => acc + getDebtBalance(d).remaining, 0);

  const owedToUsTotal = debts
    .filter(d => d.type === 'OWED_TO_US' && d.status !== 'SETTLED')
    .reduce((acc, d) => acc + getDebtBalance(d).remaining, 0);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20 relative">
      
      {/* Header */}
      <div className="flex justify-between items-end mb-2">
        <div>
          <h2 className="text-2xl font-bold text-textMain tracking-tight">{t('debts.title')}</h2>
          <p className="text-textMuted text-sm">Loan Register & Proof-Verified Payments</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="bg-primary-600 hover:bg-primary-700 text-white p-3 rounded-full shadow-lg transition-transform active:scale-95"
          title="Add New Loan or Borrowing"
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
            <p className="text-[10px] text-red-500/80 mt-0.5">Remaining to Pay</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-100 shadow-none">
          <CardContent className="p-4 text-center">
            <p className="text-xs font-semibold text-green-600 uppercase tracking-wider mb-1">{t('debts.owed_to_us')}</p>
            <p className="text-xl font-bold text-green-700">₹{owedToUsTotal.toLocaleString('en-IN')}</p>
            <p className="text-[10px] text-green-600/80 mt-0.5">Remaining to Collect</p>
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
      <div className="space-y-3.5 pt-2">
        {filtered.length === 0 ? (
          <p className="text-center text-textMuted py-10 bg-surface rounded-xl border border-borderLight">
            No records found in this category.
          </p>
        ) : (
          filtered.map(debt => {
            const { totalDue, paidSoFar, remaining } = getDebtBalance(debt);
            const payments = debt.payments || [];

            // ================= DEDICATED SETTLED CARD (ISSUE 2 FIX) =================
            if (debt.status === 'SETTLED') {
              const principalVal = debt.principalAmount || (debt.amount - (debt.interestAmount || 0));
              const interestVal = debt.interestAmount || 0;
              const clearedTotal = debt.amount || (principalVal + interestVal);
              const isWeOwe = debt.type === 'WE_OWE';
              const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
              const settledDate = lastPayment ? lastPayment.date : (debt.dueDate || debt.dateCreated);

              return (
                <div 
                  key={debt.id} 
                  className="flex flex-col p-4 rounded-2xl bg-gradient-to-b from-emerald-50/50 via-surface to-emerald-50/20 border border-emerald-200 shadow-sm space-y-3.5 transition-all"
                >
                  {/* Header Row */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      {debt.avatarUrl ? (
                        <img 
                          src={debt.avatarUrl} 
                          alt={debt.person} 
                          className="w-11 h-11 rounded-full object-cover border-2 border-emerald-200 shadow-xs shrink-0" 
                        />
                      ) : (
                        <div className="w-11 h-11 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-base shadow-xs shrink-0">
                          {debt.person.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 className="font-extrabold text-textMain text-base tracking-tight">{debt.person}</h3>
                          <span className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                            isWeOwe ? "bg-amber-100 text-amber-900 border border-amber-200" : "bg-emerald-100 text-emerald-900 border border-emerald-200"
                          )}>
                            {isWeOwe ? 'Borrowing Repaid' : 'Loan Recovered'}
                          </span>
                        </div>
                        <p className="text-[11px] text-textMuted flex items-center space-x-1.5 mt-0.5">
                          <span>Started: {format(new Date(debt.dateCreated), 'dd MMM yyyy')}</span>
                          <span>•</span>
                          <span className="text-emerald-700 font-semibold">Settled: {format(new Date(settledDate), 'dd MMM yyyy')}</span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1">
                      <button 
                        onClick={() => handleDelete(debt)} 
                        className="text-slate-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Delete Settled Record"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* 3-Column Financial Reconciliation Ledger (Original Principal, Interest, Cleared Total) */}
                  <div className="grid grid-cols-3 gap-2 bg-surface p-3 rounded-xl border border-emerald-200/90 shadow-2xs divide-x divide-borderLight">
                    {/* Col 1: Original Principal */}
                    <div className="flex flex-col items-center justify-center text-center px-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                        Original Principal
                      </span>
                      <span className="font-extrabold text-sm text-textMain mt-0.5">
                        ₹{principalVal.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[9px] text-textMuted mt-0.5">
                        Initial {isWeOwe ? 'Borrowed' : 'Given'}
                      </span>
                    </div>

                    {/* Col 2: Total Interest */}
                    <div className="flex flex-col items-center justify-center text-center px-1">
                      <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">
                        Total Interest
                      </span>
                      <span className="font-extrabold text-sm text-amber-800 mt-0.5">
                        +₹{interestVal.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[9px] text-amber-700 font-medium mt-0.5">
                        {debt.interestType === 'VADDI_MONTHLY' 
                          ? `₹${debt.interestRate} Vaddi / mo` 
                          : debt.interestType && debt.interestType !== 'NONE' 
                            ? `${debt.interestRate}% interest` 
                            : 'Zero Interest'}
                      </span>
                    </div>

                    {/* Col 3: Total Cleared */}
                    <div className="flex flex-col items-center justify-center text-center px-1">
                      <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
                        Total Cleared
                      </span>
                      <span className="font-extrabold text-sm text-emerald-700 mt-0.5">
                        ₹{clearedTotal.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[9px] font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.2 rounded-full mt-0.5">
                        100% Repaid
                      </span>
                    </div>
                  </div>

                  {/* Verified Settlement Receipts (if payments exist) */}
                  {payments.length > 0 && (
                    <div className="bg-slate-50/80 border border-borderLight rounded-xl p-2.5 space-y-1.5">
                      <p className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center">
                        <History size={12} className="mr-1 text-emerald-700" />
                        Settlement Receipts & Proofs ({payments.length}):
                      </p>
                      <div className="space-y-1">
                        {payments.map(p => (
                          <div key={p.id} className="bg-surface border border-borderLight/80 rounded-lg p-2 flex items-center justify-between text-xs">
                            <div>
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-emerald-700">₹{p.amount.toLocaleString('en-IN')}</span>
                                <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                                  {p.mode || 'Cash'}
                                </span>
                              </div>
                              <p className="text-[10px] text-textMuted mt-0.5">
                                {format(new Date(p.date), 'dd MMM yyyy')} {p.notes ? `• ${p.notes}` : ''}
                              </p>
                              {(p.location || p.timestampVerified) && (
                                <div className="flex items-center space-x-2 text-[9px] text-textMuted pt-0.5">
                                  {p.location && (
                                    <span className="flex items-center text-emerald-700">
                                      <MapPin size={9} className="mr-0.5" />
                                      {p.location.latitude.toFixed(3)}°, {p.location.longitude.toFixed(3)}°
                                    </span>
                                  )}
                                  {p.timestampVerified && (
                                    <span className="flex items-center">
                                      <Clock size={9} className="mr-0.5" />
                                      {format(new Date(p.timestampVerified), 'hh:mm a')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center space-x-1.5">
                              {p.proofPhoto && (
                                <button 
                                  onClick={() => setViewProofPayment(p)}
                                  className="flex items-center space-x-1 px-2 py-1 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-[10px] font-bold hover:bg-emerald-100 transition-colors"
                                >
                                  <Eye size={11} />
                                  <span>Proof</span>
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {debt.notes && (
                    <p className="text-[11px] text-textMuted italic bg-background/80 p-2 rounded-lg border border-borderLight/60">
                      "{debt.notes}"
                    </p>
                  )}

                  {/* Footer Row */}
                  <div className="flex items-center justify-between border-t border-emerald-200/80 pt-2.5">
                    <span className="text-xs font-bold text-emerald-900 flex items-center">
                      <ShieldCheck size={14} className="mr-1 text-emerald-600" />
                      <span>Closed Ledger • ₹0 Pending</span>
                    </span>

                    <button 
                      onClick={() => handleReopenDebt(debt)}
                      className="flex items-center space-x-1.5 px-3 py-1.5 bg-white hover:bg-amber-50 text-amber-800 border border-amber-300 rounded-lg text-xs font-bold transition-all shadow-2xs active:scale-95"
                      title="Move back to Active loans to edit or adjust payments"
                    >
                      <RotateCcw size={12} className="text-amber-700" />
                      <span>Reopen to Active</span>
                    </button>
                  </div>
                </div>
              );
            }

            // ================= ACTIVE DEBT CARD =================
            return (
              <div 
                key={debt.id} 
                className="flex flex-col p-4 rounded-2xl border transition-all space-y-3 bg-surface border-borderLight shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3">
                    {/* Person Avatar Photo or Silhouette Icon */}
                    {debt.avatarUrl ? (
                      <img 
                        src={debt.avatarUrl} 
                        alt={debt.person} 
                        className="w-10 h-10 rounded-full object-cover shrink-0 mt-0.5 border border-borderLight shadow-xs" 
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5 bg-slate-100 text-slate-600">
                        <Users size={18} />
                      </div>
                    )}

                    <div>
                      <div className="flex items-center space-x-2">
                        <p className="font-bold text-textMain text-sm">{debt.person}</p>
                        <button 
                          onClick={() => handleOpenEdit(debt)} 
                          className="text-textMuted hover:text-primary-600 p-1"
                          title="Edit Loan Details"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button 
                          onClick={() => handleDelete(debt)} 
                          className="text-textMuted hover:text-red-500 p-1"
                          title="Delete Loan"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
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
                  
                  {/* Amount Breakdown (Active remaining) */}
                  <div className="flex flex-col items-end text-right">
                    <span className="font-bold text-lg text-textMain">₹{remaining.toLocaleString('en-IN')}</span>
                    <span className="text-[11px] text-textMuted">
                      Total: ₹{totalDue.toLocaleString('en-IN')} {paidSoFar > 0 && `(Paid: ₹${paidSoFar.toLocaleString('en-IN')})`}
                    </span>
                    {debt.status === 'OVERDUE' && (
                      <span className="flex items-center text-[10px] text-red-500 font-bold mt-1">
                        <AlertCircle size={10} className="mr-1" /> {t('debts.overdue')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Interest Badge info */}
                {debt.interestType && debt.interestType !== 'NONE' && (
                  <div className="bg-amber-50/70 border border-amber-200/80 rounded-xl p-2.5 text-xs flex items-center justify-between text-amber-900">
                    <span className="font-semibold">
                      {debt.interestType === 'VADDI_MONTHLY' && `₹${debt.interestRate} Vaddi / month (${debt.tenureMonths || 0} mos)`}
                      {debt.interestType === 'SIMPLE_ANNUAL' && `${debt.interestRate}% Simple Annual (${debt.tenureMonths || 0} mos)`}
                      {debt.interestType === 'COMPOUND_ANNUAL' && `${debt.interestRate}% Compound Annual (${debt.tenureMonths || 0} mos)`}
                      {debt.interestType === 'CUSTOM' && `Formula: ${debt.customFormula || ''}`}
                    </span>
                    <span className="text-amber-700 font-bold text-[11px]">
                      +₹{(debt.interestAmount || 0).toLocaleString('en-IN')} Interest
                    </span>
                  </div>
                )}

                {/* Partial Payments History with Proof & Geolocation Badges */}
                {payments.length > 0 && (
                  <div className="bg-slate-50 border border-borderLight rounded-xl p-3 space-y-2">
                    <p className="text-[10px] font-bold text-textMuted uppercase tracking-wider flex items-center">
                      <History size={12} className="mr-1 text-primary-600" />
                      Verified Repayment Records ({payments.length}):
                    </p>
                    <div className="space-y-1.5">
                      {payments.map(p => (
                        <div key={p.id} className="bg-surface border border-borderLight/80 rounded-lg p-2 flex items-center justify-between text-xs">
                          <div className="space-y-0.5">
                            <div className="flex items-center space-x-1.5">
                              <span className="font-bold text-green-700">₹{p.amount.toLocaleString('en-IN')}</span>
                              <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                                {p.mode || 'Cash'}
                              </span>
                            </div>
                            <p className="text-[11px] text-textMuted">
                              {format(new Date(p.date), 'dd MMM yyyy')} {p.notes ? `• ${p.notes}` : ''}
                            </p>
                            {/* Geo & Timestamp Tag */}
                            {(p.location || p.proofPhoto) && (
                              <div className="flex items-center space-x-2 text-[10px] text-primary-700 pt-0.5">
                                {p.location && (
                                  <span className="flex items-center">
                                    <MapPin size={10} className="mr-0.5" />
                                    {p.location.latitude.toFixed(3)}°, {p.location.longitude.toFixed(3)}°
                                  </span>
                                )}
                                {p.timestampVerified && (
                                  <span className="flex items-center text-textMuted">
                                    <Clock size={10} className="mr-0.5" />
                                    {format(new Date(p.timestampVerified), 'hh:mm a')}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center space-x-1.5 shrink-0">
                            {/* View Proof Button */}
                            {p.proofPhoto ? (
                              <button 
                                onClick={() => setViewProofPayment(p)}
                                className="flex items-center space-x-1 px-2.5 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg text-[11px] font-bold hover:bg-primary-100 transition-colors"
                              >
                                <Eye size={12} />
                                <span>Proof</span>
                              </button>
                            ) : (
                              <span className="text-[10px] text-textMuted italic">No Photo</span>
                            )}

                            {/* Delete partial payment button */}
                            <button
                              type="button"
                              onClick={() => setDeleteTargetPayment({ debtId: debt.id, payment: p })}
                              className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                              title="Delete mistaken payment entry"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {debt.notes && (
                  <p className="text-xs text-textMuted italic bg-background p-2 rounded-lg">
                    "{debt.notes}"
                  </p>
                )}

                {/* Actions: Partial Payment, WhatsApp Remind, Settle with Proof */}
                <div className="flex items-center justify-end space-x-2 border-t border-borderLight pt-2.5">
                  <button 
                    onClick={() => {
                      setRepaymentDebt(debt);
                      setPayAmount('');
                      setPayNotes('');
                      setProofPhoto(null);
                      setCoords(null);
                      setVerifiedTimestamp(null);
                    }}
                    className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg px-3 py-2 flex items-center justify-center hover:bg-emerald-100 transition-colors"
                    title="Record partial payment with proof"
                  >
                    <Camera size={14} className="mr-1" />
                    <span className="text-xs font-bold">Record Payment</span>
                  </button>

                  <a 
                    href={`https://wa.me/?text=Hi ${debt.person}, reminder regarding balance ₹${remaining.toLocaleString('en-IN')} of total ₹${totalDue.toLocaleString('en-IN')} (Due: ${format(new Date(debt.dueDate), 'dd MMM yyyy')}).`} 
                    target="_blank" 
                    rel="noreferrer" 
                    className="flex-1 bg-[#25D366]/10 border border-[#25D366]/30 rounded-lg py-2 flex items-center justify-center hover:bg-[#25D366]/20 transition-colors"
                  >
                    <Phone size={14} className="text-[#128C7E] mr-1" />
                    <span className="text-xs font-bold text-[#128C7E]">{t('debts.send_reminder', 'Remind')}</span>
                  </a>

                  <button 
                    onClick={() => handleOpenSettleWithProof(debt)}
                    className="bg-primary-600 hover:bg-primary-700 text-white rounded-lg px-3 py-2 flex items-center justify-center transition-all shadow-soft active:scale-95"
                    title="Mark as completely settled with proof verification"
                  >
                    <CheckCircle2 size={14} className="mr-1 text-white" />
                    <span className="text-xs font-bold">Settle with Proof</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ================= MODAL 1: ADD / EDIT LOAN ================= */}
      {showModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-md animate-in zoom-in-95 border-none shadow-2xl max-h-[90vh] overflow-y-auto bg-surface">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-textMain">{editingDebt ? 'Edit Loan Record' : 'Add Debt / Loan'}</h3>
                  <p className="text-xs text-textMuted">With Live Interest & Formula Calculator</p>
                </div>
                <button onClick={() => setShowModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="flex bg-borderLight p-1 rounded-full space-x-1">
                  <button 
                    type="button"
                    onClick={() => setDebtType('OWED_TO_US')}
                    className={cn(
                      "flex-1 py-1.5 rounded-full text-xs font-bold transition-all", 
                      debtType === 'OWED_TO_US' ? "bg-surface shadow text-green-700" : "text-textMuted"
                    )}
                  >
                    We Lent (Owed to Us)
                  </button>
                  <button 
                    type="button"
                    onClick={() => setDebtType('WE_OWE')}
                    className={cn(
                      "flex-1 py-1.5 rounded-full text-xs font-bold transition-all", 
                      debtType === 'WE_OWE' ? "bg-surface shadow text-red-700" : "text-textMuted"
                    )}
                  >
                    We Borrowed (We Owe)
                  </button>
                </div>

                {/* Person Photo Uploader (Feedback 6) */}
                <div className="flex items-center space-x-3 bg-slate-50 p-3 rounded-xl border border-borderLight">
                  <div className="relative shrink-0">
                    {avatarPhoto ? (
                      <img src={avatarPhoto} alt="Person" className="w-12 h-12 rounded-full object-cover border-2 border-primary-400" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center border border-borderLight">
                        <Users size={22} />
                      </div>
                    )}
                  </div>
                  <div className="text-xs min-w-0 flex-1">
                    <p className="font-bold text-textMain">Person Photo (Optional)</p>
                    <div className="flex items-center space-x-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => handlePickAvatar('camera')}
                        className="px-2.5 py-1 bg-primary-50 text-primary-700 border border-primary-200 rounded-lg text-[11px] font-bold hover:bg-primary-100 flex items-center space-x-1"
                      >
                        <Camera size={12} />
                        <span>Live Camera</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePickAvatar('photos')}
                        className="px-2.5 py-1 bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-[11px] font-bold hover:bg-slate-200 flex items-center space-x-1"
                      >
                        <ImageIcon size={12} />
                        <span>Gallery</span>
                      </button>
                      {avatarPhoto && (
                        <button 
                          type="button" 
                          onClick={() => setAvatarPhoto(null)} 
                          className="text-[10px] text-red-600 font-bold hover:underline ml-1"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Person Name *</label>
                  <input 
                    type="text" 
                    value={person} 
                    onChange={e => setPerson(e.target.value)} 
                    placeholder="e.g. Ravi (Milkman), Suresh Cousin, Kirana Merchant" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-sm" 
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-textMuted">Principal Amount (₹) *</label>
                  <input 
                    type="number" 
                    value={principal} 
                    onChange={e => setPrincipal(e.target.value)} 
                    placeholder="e.g. 50000" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-base font-bold" 
                  />
                </div>

                {/* Interest Picker */}
                <div className="bg-primary-50/60 border border-primary-200/80 p-3.5 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-primary-900 flex items-center">
                      <Calculator size={15} className="mr-1.5 text-primary-700" />
                      Interest Method & Formula
                    </span>
                    <span className="text-[10px] text-primary-700 font-semibold bg-white/80 px-2 py-0.5 rounded-full border border-primary-200">
                      Auto-Calculated
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    {[
                      { id: 'NONE', label: '0% Friendly (No Int)' },
                      { id: 'VADDI_MONTHLY', label: '₹ Vaddi / month (వడ్డీ)' },
                      { id: 'SIMPLE_ANNUAL', label: 'Simple Annual (%)' },
                      { id: 'COMPOUND_ANNUAL', label: 'Compound Annual (%)' },
                      { id: 'CUSTOM', label: '⚙️ Custom Formula' },
                    ].map(type => (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setInterestType(type.id as any)}
                        className={cn(
                          "py-2 px-2.5 rounded-lg text-[11px] font-bold border transition-all text-left",
                          interestType === type.id 
                            ? "bg-primary-600 text-white border-primary-600 shadow-xs" 
                            : "bg-surface text-textMain border-borderLight hover:bg-slate-50"
                        )}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>

                  {interestType !== 'NONE' && (
                    <div className="pt-2 border-t border-primary-200/60 space-y-3">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="text-[11px] font-semibold text-primary-900">
                            {interestType === 'VADDI_MONTHLY' ? 'Vaddi Rate (₹ / ₹100 / mo)' : 'Interest Rate (%)'}
                          </label>
                          <div className="relative mt-1">
                            <input 
                              type="number" 
                              step="0.1"
                              value={interestRate} 
                              onChange={e => setInterestRate(e.target.value)} 
                              placeholder="2" 
                              className="w-full p-2 bg-surface rounded-lg border border-primary-300 outline-none text-xs font-bold pr-8"
                            />
                            <span className="absolute right-2.5 top-2 text-xs font-semibold text-textMuted">
                              {interestType === 'VADDI_MONTHLY' ? '₹' : '%'}
                            </span>
                          </div>
                        </div>

                        <div>
                          <label className="text-[11px] font-semibold text-primary-900">Duration (Months)</label>
                          <input 
                            type="number" 
                            value={tenureMonths} 
                            onChange={e => setTenureMonths(e.target.value)} 
                            placeholder="6" 
                            className="w-full mt-1 p-2 bg-surface rounded-lg border border-primary-300 outline-none text-xs font-bold"
                          />
                        </div>
                      </div>

                      {interestType === 'CUSTOM' && (
                        <div className="space-y-1 bg-surface p-2.5 rounded-lg border border-primary-200">
                          <label className="text-[11px] font-bold text-textMain flex items-center justify-between">
                            <span>Your Custom Expression</span>
                            <span className="text-[10px] text-textMuted font-normal">Vars: P=Principal, R=Rate, M=Months</span>
                          </label>
                          <input 
                            type="text" 
                            value={customFormula} 
                            onChange={e => setCustomFormula(e.target.value)} 
                            placeholder="e.g. P * (R / 100) * M" 
                            className="w-full p-2 font-mono text-xs bg-background rounded border border-borderLight focus:border-primary-400 outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Live Calculation Preview */}
                  <div className="bg-surface rounded-xl p-3 border border-primary-200 shadow-xs space-y-1 mt-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-textMuted">Principal:</span>
                      <span className="font-semibold text-textMain">₹{(Number(principal) || 0).toLocaleString('en-IN')}</span>
                    </div>
                    {interestType !== 'NONE' && (
                      <div className="flex items-center justify-between text-xs text-primary-800">
                        <span>Total Interest ({calculated.explanation}):</span>
                        <span className="font-bold">+₹{calculated.interest.toLocaleString('en-IN')}</span>
                      </div>
                    )}
                    <div className="pt-1.5 border-t border-borderLight flex items-center justify-between">
                      <span className="text-xs font-bold text-textMain uppercase tracking-wide">Final Amount:</span>
                      <span className="text-base font-extrabold text-primary-700">
                        ₹{calculated.finalTotal.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Dates (Start date restricted from future dates) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Loan Start Date</label>
                    <input 
                      type="date" 
                      value={startDateStr} 
                      max={todayStr}
                      onChange={e => setStartDateStr(e.target.value)} 
                      className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain" 
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-textMuted">Due Date</label>
                    <input 
                      type="date" 
                      value={dueDateStr} 
                      onChange={e => setDueDateStr(e.target.value)} 
                      className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain" 
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Notes & Terms (Optional)</label>
                  <input 
                    type="text" 
                    value={notes} 
                    onChange={e => setNotes(e.target.value)} 
                    placeholder="e.g. Promissory note, Cheque, monthly interest" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs" 
                  />
                </div>
                
                <button 
                  onClick={handleSave} 
                  disabled={!person || !principal} 
                  className="w-full mt-2 py-3 bg-primary-600 disabled:opacity-50 text-white font-bold rounded-xl hover:bg-primary-700 transition-colors shadow-soft text-sm"
                >
                  {editingDebt ? 'Update Loan Record' : `Save Loan Record (₹${calculated.finalTotal.toLocaleString('en-IN')})`}
                </button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 2: RECORD PAYMENT WITH PHOTO PROOF + GEOLOCATION ================= */}
      {repaymentDebt && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm animate-in zoom-in-95 border-none shadow-2xl bg-surface max-h-[92vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <h3 className="text-lg font-bold text-textMain">Record Payment & Proof</h3>
                  <p className="text-xs text-textMuted">For {repaymentDebt.person}</p>
                </div>
                <button onClick={() => setRepaymentDebt(null)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              {/* Status banner */}
              {(() => {
                const { totalDue, paidSoFar, remaining } = getDebtBalance(repaymentDebt);
                return (
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-textMuted">Total Due:</span>
                      <span className="font-bold text-textMain">₹{totalDue.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-textMuted">Already Paid:</span>
                      <span className="font-bold text-emerald-700">₹{paidSoFar.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between border-t border-emerald-200 pt-1 font-bold">
                      <span className="text-emerald-900">Current Balance:</span>
                      <span className="text-emerald-800 text-sm">₹{remaining.toLocaleString('en-IN')}</span>
                    </div>
                  </div>
                );
              })()}

              <div className="space-y-4">
                {/* Amount */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Amount Paid Now (₹) *</label>
                  <input 
                    type="number" 
                    value={payAmount} 
                    onChange={e => setPayAmount(e.target.value)} 
                    placeholder="e.g. 10000" 
                    className="w-full mt-1 p-3 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-base font-bold text-emerald-700" 
                  />
                </div>

                {/* Payment Mode Selector */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Payment Mode</label>
                  <select 
                    value={payMode}
                    onChange={e => setPayMode(e.target.value)}
                    className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain font-medium"
                  >
                    {PAYMENT_MODES.map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>

                {/* Date (Cannot select future dates - Feedback 7) */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Payment Date</label>
                  <input 
                    type="date" 
                    value={payDate} 
                    max={todayStr}
                    onChange={e => setPayDate(e.target.value)} 
                    className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs text-textMain" 
                  />
                </div>

                {/* ================= CAMERA / PHOTO PROOF WITH GEOLOCATION ================= */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-textMain flex items-center">
                      <Camera size={14} className="mr-1.5 text-primary-600" />
                      Receipt / Transaction Proof
                    </span>
                    <span className="text-[10px] text-primary-700 font-semibold bg-primary-100/70 px-2 py-0.5 rounded-full">
                      Watermarked
                    </span>
                  </div>

                  {/* Photo picker & Preview */}
                  {proofPhoto ? (
                    <div className="relative rounded-xl overflow-hidden border border-borderLight shadow-sm">
                      <img src={proofPhoto} alt="Proof" className="w-full h-36 object-cover" />
                      <button 
                        onClick={() => setProofPhoto(null)} 
                        className="absolute top-2 right-2 p-1 bg-black/60 text-white rounded-full hover:bg-black/80"
                        title="Remove photo"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => handlePickProofPhoto('camera')}
                        className="p-3 bg-surface border border-primary-200 hover:border-primary-500 rounded-xl flex flex-col items-center justify-center transition-all group shadow-2xs active:scale-95"
                      >
                        <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center mb-1">
                          <Camera size={18} />
                        </div>
                        <span className="text-xs font-bold text-textMain">Live Camera</span>
                        <span className="text-[10px] text-textMuted">Capture receipt now</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handlePickProofPhoto('photos')}
                        className="p-3 bg-surface border border-borderLight hover:border-primary-400 rounded-xl flex flex-col items-center justify-center transition-all group shadow-2xs active:scale-95"
                      >
                        <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center mb-1">
                          <ImageIcon size={18} />
                        </div>
                        <span className="text-xs font-bold text-textMain">Photo Gallery</span>
                        <span className="text-[10px] text-textMuted">Select image file</span>
                      </button>
                    </div>
                  )}

                  {/* Geolocation & Timestamp Info */}
                  <div className="space-y-1.5 text-[11px] pt-1">
                    <div className="flex items-center justify-between text-textMuted">
                      <span className="flex items-center">
                        <MapPin size={12} className="mr-1 text-primary-600" />
                        Geolocation Stamp:
                      </span>
                      {coords ? (
                        <span className="text-green-700 font-bold flex items-center">
                          <Check size={11} className="mr-0.5" />
                          {coords.latitude.toFixed(4)}°, {coords.longitude.toFixed(4)}°
                        </span>
                      ) : locLoading ? (
                        <span className="text-primary-600 animate-pulse">Detecting GPS...</span>
                      ) : (
                        <button 
                          type="button" 
                          onClick={captureGeoLocation} 
                          className="text-primary-600 font-bold hover:underline"
                        >
                          + Tag GPS Location
                        </button>
                      )}
                    </div>

                    {verifiedTimestamp && (
                      <div className="flex items-center justify-between text-textMuted">
                        <span className="flex items-center">
                          <Clock size={12} className="mr-1 text-primary-600" />
                          Timestamp Verified:
                        </span>
                        <span className="font-semibold text-textMain">
                          {format(verifiedTimestamp, 'dd MMM yyyy, hh:mm a')}
                        </span>
                      </div>
                    )}

                    {locError && (
                      <p className="text-[10px] text-amber-700 italic">
                        {locError} (Photo proof still valid)
                      </p>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="text-xs font-semibold text-textMuted">Remarks (Optional)</label>
                  <input 
                    type="text" 
                    value={payNotes} 
                    onChange={e => setPayNotes(e.target.value)} 
                    placeholder="e.g. Paid via GPay, Cash received by brother" 
                    className="w-full mt-1 p-2.5 bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none text-xs" 
                  />
                </div>

                <button 
                  onClick={handleRecordPayment}
                  disabled={!payAmount || Number(payAmount) <= 0}
                  className="w-full mt-2 py-3 bg-emerald-600 disabled:opacity-50 text-white font-bold rounded-xl hover:bg-emerald-700 transition-colors shadow-soft text-sm"
                >
                  Save Verified Payment (₹{(Number(payAmount) || 0).toLocaleString('en-IN')})
                </button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 3: VIEW PROOF MODAL ================= */}
      {viewProofPayment && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm animate-in zoom-in-95 border-none shadow-2xl bg-surface overflow-hidden">
            <CardContent className="p-5 space-y-3.5">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-bold text-textMain flex items-center">
                    <ShieldCheck size={16} className="text-green-600 mr-1.5" />
                    Verified Proof of Payment
                  </h3>
                  <p className="text-xs text-textMuted">
                    ₹{viewProofPayment.amount.toLocaleString('en-IN')} via {viewProofPayment.mode || 'Cash'}
                  </p>
                </div>
                <button onClick={() => setViewProofPayment(null)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              {/* Proof Image */}
              {viewProofPayment.proofPhoto && (
                <div className="rounded-xl overflow-hidden border border-borderLight bg-black/5 max-h-72 flex items-center justify-center">
                  <img src={viewProofPayment.proofPhoto} alt="Payment Proof" className="w-full h-auto object-contain" />
                </div>
              )}

              {/* Verification Metadata Box */}
              <div className="bg-slate-50 border border-borderLight rounded-xl p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-textMuted flex items-center">
                    <Clock size={12} className="mr-1 text-primary-600" />
                    Captured At:
                  </span>
                  <span className="font-semibold text-textMain">
                    {format(new Date(viewProofPayment.timestampVerified || viewProofPayment.date), 'dd MMM yyyy, hh:mm:ss a')}
                  </span>
                </div>

                {viewProofPayment.location && (
                  <div className="flex items-center justify-between">
                    <span className="text-textMuted flex items-center">
                      <MapPin size={12} className="mr-1 text-primary-600" />
                      GPS Coordinates:
                    </span>
                    <a 
                      href={`https://maps.google.com/?q=${viewProofPayment.location.latitude},${viewProofPayment.location.longitude}`} 
                      target="_blank" 
                      rel="noreferrer"
                      className="font-bold text-primary-700 hover:underline flex items-center"
                    >
                      {viewProofPayment.location.latitude.toFixed(4)}°, {viewProofPayment.location.longitude.toFixed(4)}°
                      <Navigation size={10} className="ml-1" />
                    </a>
                  </div>
                )}

                {viewProofPayment.notes && (
                  <p className="text-textMuted pt-1 border-t border-borderLight italic">
                    "{viewProofPayment.notes}"
                  </p>
                )}
              </div>

              <button 
                onClick={() => setViewProofPayment(null)}
                className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-textMain font-bold rounded-xl text-xs transition-colors"
              >
                Close Proof
              </button>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= CONFIRMATION MODALS ================= */}

      {/* Delete Loan Record Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!deleteTargetDebt}
        title="Delete Loan Record"
        itemName={deleteTargetDebt ? `${deleteTargetDebt.person} (₹${(deleteTargetDebt.amount || deleteTargetDebt.principalAmount).toLocaleString('en-IN')})` : ''}
        message="Are you sure you want to permanently delete this loan record and all associated repayment records? This action cannot be undone."
        onConfirm={async () => {
          if (deleteTargetDebt) {
            await deleteDebt(deleteTargetDebt.id);
            setDeleteTargetDebt(null);
            await fetchDebts();
          }
        }}
        onCancel={() => setDeleteTargetDebt(null)}
      />

      {/* Delete Repayment Record Confirmation Modal (Allows fixing mistakes - Feedback 5) */}
      <ConfirmDeleteModal
        isOpen={!!deleteTargetPayment}
        title="Delete Payment Entry"
        itemName={deleteTargetPayment ? `₹${deleteTargetPayment.payment.amount.toLocaleString('en-IN')} (${deleteTargetPayment.payment.mode || 'Cash'})` : ''}
        message="Are you sure you want to delete this recorded payment? The loan balance will be restored automatically."
        onConfirm={async () => {
          if (deleteTargetPayment) {
            await deleteDebtPayment(deleteTargetPayment.debtId, deleteTargetPayment.payment.id);
            setDeleteTargetPayment(null);
            await fetchDebts();
          }
        }}
        onCancel={() => setDeleteTargetPayment(null)}
      />

      {/* Reopen Loan Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={!!reopenTargetDebt}
        title="Reopen Loan to Active"
        confirmText="Reopen"
        isDangerous={false}
        itemName={reopenTargetDebt ? `${reopenTargetDebt.person} (Total: ₹${(reopenTargetDebt.amount || reopenTargetDebt.principalAmount).toLocaleString('en-IN')})` : ''}
        message="This will move the loan back to the Active tab so you can modify loan details, delete mistaken repayment entries, or record further payments."
        onConfirm={async () => {
          if (reopenTargetDebt) {
            await updateDebtStatus(reopenTargetDebt.id, 'PENDING');
            setReopenTargetDebt(null);
            await fetchDebts();
          }
        }}
        onCancel={() => setReopenTargetDebt(null)}
      />

    </div>
  );
};

export default Debts;
