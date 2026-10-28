import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Card, CardContent } from '@/components/ui/Card';
import { 
  Globe, 
  Bell, 
  Shield, 
  Download, 
  Upload, 
  LogOut, 
  ChevronRight, 
  Lock, 
  Unlock, 
  X, 
  Check, 
  AlertTriangle, 
  FileText, 
  Database, 
  RefreshCw,
  Share2,
  Copy,
  ExternalLink,
  Smartphone,
  Cloud,
  CheckCircle2,
  RotateCcw,
  Settings as SettingsIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { 
  getTransactions, 
  getDebts, 
  getGifts, 
  exportFullBackup, 
  restoreFullBackup, 
  clearUserPartition,
  HemaBackupPayload,
  DebtRecordItem
} from '@/lib/db';
import { 
  isPinEnabled, 
  setPin, 
  disablePin, 
  verifyPin 
} from '@/lib/security';
import { exportAndSaveFile } from '@/lib/nativeFiles';
import { 
  requestNotificationPermission as requestNativeNotifPermission, 
  triggerSystemNotification, 
  checkNotificationPermission,
  checkAndNotifyDueDebts 
} from '@/lib/notifications';
import { useAuth } from '@/context/AuthContext';
import { 
  isSupabaseConfigured, 
  getSupabaseConfig, 
  saveSupabaseCredentials, 
  clearSupabaseCredentials, 
  testSupabaseConnection 
} from '@/lib/supabase';

const SCHEMA_SQL_SNIPPET = `-- Run this in Supabase SQL Editor:
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT, phone TEXT,
  avatar_url TEXT, currency TEXT DEFAULT 'INR',
  locale TEXT DEFAULT 'te',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own profile" ON public.profiles FOR ALL USING (auth.uid() = id);

CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL,
  category_id TEXT NOT NULL,
  label TEXT, type TEXT NOT NULL,
  date BIGINT NOT NULL, notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own transactions" ON public.transactions FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.debts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person TEXT NOT NULL, avatar_url TEXT,
  principal_amount NUMERIC(12, 2) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  type TEXT NOT NULL, status TEXT NOT NULL,
  interest_type TEXT DEFAULT 'NONE',
  interest_rate NUMERIC(6, 2) DEFAULT 0,
  custom_formula TEXT, tenure_months INT DEFAULT 0,
  interest_amount NUMERIC(12, 2) DEFAULT 0,
  due_date BIGINT NOT NULL, date_created BIGINT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
ALTER TABLE public.debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own debts" ON public.debts FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.debt_payments (
  id TEXT PRIMARY KEY,
  debt_id TEXT NOT NULL REFERENCES public.debts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL, date BIGINT NOT NULL,
  mode TEXT DEFAULT 'Cash', notes TEXT DEFAULT '',
  proof_photo TEXT, location JSONB, timestamp_verified BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
ALTER TABLE public.debt_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own payments" ON public.debt_payments FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.gifts (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  person_id TEXT, person TEXT NOT NULL, occasion TEXT NOT NULL,
  type TEXT NOT NULL, category TEXT NOT NULL, item TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL, weight_grams NUMERIC(8, 2), purity TEXT,
  date BIGINT NOT NULL, notes TEXT DEFAULT '', photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own gifts" ON public.gifts FOR ALL USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.people (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, relationship TEXT DEFAULT 'Family',
  phone TEXT, avatar_url TEXT, notes TEXT DEFAULT '',
  created_at BIGINT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users access own people" ON public.people FOR ALL USING (auth.uid() = user_id);
`;

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { user, logout, knownUsers, isCloudConfigured, cloudSyncState, triggerSync } = useAuth();

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' }
  ];

  // Modals
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showCloudModal, setShowCloudModal] = useState(false);

  // Security Form State
  const [pinEnabled, setPinEnabledState] = useState(isPinEnabled());
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);

  // Notifications State & Interactive in-app alert
  const [deviceAlertsActive, setDeviceAlertsActive] = useState(false);
  const [overdueDebts, setOverdueDebts] = useState<DebtRecordItem[]>([]);
  const [inAppAlert, setInAppAlert] = useState<string | null>(null);

  // Backup State
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  // Cloud Sync State
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudKey, setCloudKey] = useState('');
  const [testStatus, setTestStatus] = useState<{ testing: boolean; message?: string; success?: boolean } | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Account Reset Modal State
  const [showResetAccountModal, setShowResetAccountModal] = useState(false);
  const [resettingAccount, setResettingAccount] = useState(false);

  useEffect(() => {
    checkNotificationPermission().then(granted => {
      setDeviceAlertsActive(granted);
    });
    loadDebtAlerts();

    const config = getSupabaseConfig();
    setCloudUrl(config.url);
    setCloudKey(config.anonKey);
  }, [showCloudModal, user?.id]);

  const loadDebtAlerts = async () => {
    const debts = await getDebts();
    const now = Date.now();
    const urgent = debts.filter(d => 
      d.status !== 'SETTLED' && (d.status === 'OVERDUE' || d.dueDate <= now + 3 * 86400000)
    );
    setOverdueDebts(urgent);
  };

  const handleResetMyAccount = async () => {
    if (!user) return;
    setResettingAccount(true);
    try {
      await clearUserPartition(user.id);
      await loadDebtAlerts();
      setBackupStatus('Your personal ledger has been cleanly reset to zero.');
      setShowResetAccountModal(false);
    } catch (e: any) {
      setBackupStatus('Failed to reset ledger: ' + (e.message || 'Unknown error'));
    } finally {
      setResettingAccount(false);
    }
  };

  // CSV Export using Native Filesystem & Share Sheet
  const handleExportCSV = async () => {
    try {
      const txs = await getTransactions();
      const debts = await getDebts();
      const gifts = await getGifts();

      let csv = '--- TRANSACTIONS ---\n';
      csv += 'Date,Type,Category,Original Label,Amount,Notes\n';
      txs.forEach(tx => {
        const cleanLabel = (tx.label || tx.categoryId || '').replace(/"/g, '""');
        const cleanNotes = (tx.notes || '').replace(/"/g, '""');
        csv += `${new Date(tx.date).toISOString()},${tx.type},${tx.categoryId},"${cleanLabel}",${tx.amount},"${cleanNotes}"\n`;
      });

      csv += '\n--- DEBTS ---\n';
      csv += 'Date Created,Type,Person,Principal,Total Due,Status,Due Date\n';
      debts.forEach(d => {
        csv += `${new Date(d.dateCreated).toISOString()},${d.type},${d.person},${d.principalAmount || d.amount},${d.amount},${d.status},${new Date(d.dueDate).toISOString()}\n`;
      });

      csv += '\n--- GIFTS & FAMILY CONTRIBUTIONS ---\n';
      csv += 'Date,Type,Person,Category,Item,Amount,Occasion\n';
      gifts.forEach(g => {
        csv += `${new Date(g.date).toISOString()},${g.type},${g.person},${g.category || 'OTHER'},${g.item || ''},${g.amount},${g.occasion}\n`;
      });

      const filename = `hema_finance_export_${new Date().toISOString().slice(0, 10)}.csv`;
      const res = await exportAndSaveFile({
        filename,
        content: csv,
        mimeType: 'text/csv',
        title: 'Hema Finance CSV Ledger'
      });
      setBackupStatus(res.message);
    } catch (err: any) {
      setBackupStatus(`CSV Export failed: ${err.message}`);
    }
  };

  // Full JSON Backup Export using Native Filesystem & Share Sheet
  const handleExportJSON = async () => {
    try {
      const backup = await exportFullBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `hema_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
      const res = await exportAndSaveFile({
        filename,
        content: jsonStr,
        mimeType: 'application/json',
        title: 'Hema Full Backup JSON'
      });
      setBackupStatus(res.message);
    } catch (e: any) {
      setBackupStatus(`Backup export failed: ${e.message}`);
    }
  };

  // Full JSON Backup Import / Restore
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setBackupStatus('Reading backup file...');
      let content = '';
      if (typeof file.text === 'function') {
        content = await file.text();
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = (err) => reject(err);
          reader.readAsText(file);
        });
      }

      const parsed: HemaBackupPayload = JSON.parse(content);
      if (!parsed || (!parsed.transactions && !parsed.debts && !parsed.gifts)) {
        throw new Error('Invalid Hema backup format: missing transactions, debts, or gifts.');
      }
      await restoreFullBackup(parsed);
      setBackupStatus('✅ Backup restored successfully! Refreshing data in 1 second...');
      setTimeout(() => window.location.reload(), 1200);
    } catch (err: any) {
      setBackupStatus(`❌ Failed to restore backup: ${err.message || 'Invalid JSON file'}`);
    }
  };

  // 1-Tap Load Sample Backup for Testing
  const handleLoadSampleBackup = async () => {
    if (!window.confirm('Load sample test ledger (contains sample transactions, active & settled debts, and gifts)?')) {
      return;
    }
    try {
      setBackupStatus('Loading sample ledger...');
      const samplePayload: HemaBackupPayload = {
        version: 4,
        exportedAt: new Date().toISOString(),
        transactions: [
          { id: 'tx_sample_01', amount: 75000, categoryId: 'Salary', label: 'Monthly Household Salary', type: 'INCOME', date: Date.now() - 5 * 86400000, notes: 'Primary bank deposit' },
          { id: 'tx_sample_02', amount: 4500, categoryId: 'Groceries', label: 'Provisions & D-Mart', type: 'EXPENSE', date: Date.now() - 3 * 86400000, notes: 'Monthly household provisions' },
          { id: 'tx_sample_03', amount: 2200, categoryId: 'Bills', label: 'Electricity Bill', type: 'EXPENSE', date: Date.now() - 2 * 86400000, notes: 'Paid online via UPI' },
          { id: 'tx_sample_04', amount: 1800, categoryId: 'Transport', label: 'Petrol Refill', type: 'EXPENSE', date: Date.now() - 1 * 86400000, notes: 'Two-wheeler fuel' }
        ],
        people: [
          { id: 'person_sample_01', name: 'Elder Relative', relationship: 'Relative', phone: '+91 98765 43210', notes: 'Family Elder', createdAt: Date.now() - 30 * 86400000 },
          { id: 'person_sample_02', name: 'Suresh Cousin', relationship: 'Cousin', phone: '+91 98480 12345', notes: 'Family cousin', createdAt: Date.now() - 20 * 86400000 }
        ],
        debts: [
          {
            id: 'debt_sample_01',
            person: 'Elder Relative',
            principalAmount: 100000,
            amount: 160000,
            type: 'OWED_TO_US',
            status: 'SETTLED',
            interestType: 'VADDI_MONTHLY',
            interestRate: 5,
            tenureMonths: 12,
            interestAmount: 60000,
            dueDate: Date.now() - 10 * 86400000,
            dateCreated: Date.now() - 365 * 86400000,
            notes: 'Hand loan for agricultural harvest',
            payments: [
              {
                id: 'pay_sample_01',
                amount: 160000,
                date: Date.now() - 10 * 86400000,
                mode: 'Bank NEFT / IMPS',
                notes: 'Full final settlement',
                timestampVerified: Date.now() - 10 * 86400000
              }
            ]
          },
          {
            id: 'debt_sample_02',
            person: 'Suresh Cousin',
            principalAmount: 25000,
            amount: 25000,
            type: 'OWED_TO_US',
            status: 'PENDING',
            interestType: 'NONE',
            dueDate: Date.now() + 3 * 86400000,
            dateCreated: Date.now() - 15 * 86400000,
            notes: 'Short term family emergency assistance',
            payments: []
          }
        ],
        gifts: [
          {
            id: 'gift_sample_01',
            person: 'Elder Relative',
            personId: 'person_sample_01',
            occasion: 'Wedding (विवाह / పెళ్లి)',
            type: 'RECEIVED',
            category: 'GOLD',
            item: 'Gold Ring',
            weightGrams: 8,
            purity: '22K',
            amount: 62000,
            date: Date.now() - 60 * 86400000,
            notes: 'Blessed wedding gift'
          }
        ]
      };

      await restoreFullBackup(samplePayload);
      setBackupStatus('✅ Realistic sample ledger loaded successfully! Refreshing...');
      setTimeout(() => window.location.reload(), 1200);
    } catch (e: any) {
      setBackupStatus(`❌ Load sample failed: ${e.message}`);
    }
  };

  // Cloud Sync Handler
  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      await triggerSync();
      setInAppAlert('Cloud synchronization complete! Records up to date.');
    } catch (err: any) {
      setInAppAlert(`Sync failed: ${err.message || 'Offline'}`);
    } finally {
      setIsSyncing(false);
      setTimeout(() => setInAppAlert(null), 3500);
    }
  };

  const handleTestCloudConnection = async () => {
    setTestStatus({ testing: true });
    saveSupabaseCredentials(cloudUrl, cloudKey);
    const res = await testSupabaseConnection();
    setTestStatus({ testing: false, message: res.message, success: res.success });
  };

  const handleSaveCloudCredentials = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = saveSupabaseCredentials(cloudUrl, cloudKey);
    if (ok) {
      setInAppAlert('✅ Cloud credentials saved! Multi-device sync enabled.');
      setShowCloudModal(false);
    } else {
      setInAppAlert('❌ Invalid URL or Anon Key. Please check your credentials.');
    }
    setTimeout(() => setInAppAlert(null), 3500);
  };

  const handleClearCloudCredentials = () => {
    if (window.confirm('Disconnect from Supabase cloud? The app will operate in local offline vault mode.')) {
      clearSupabaseCredentials();
      setCloudUrl('');
      setCloudKey('');
      setShowCloudModal(false);
      setInAppAlert('Switched to local offline vault mode.');
      setTimeout(() => setInAppAlert(null), 3500);
    }
  };

  const handleCopySchema = () => {
    navigator.clipboard.writeText(SCHEMA_SQL_SNIPPET);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  // PIN security actions
  const handleSetPin = () => {
    if (pinInput.length !== 4 || isNaN(Number(pinInput))) {
      setSecurityMessage('PIN must be exactly 4 digits');
      return;
    }
    if (pinInput !== confirmPinInput) {
      setSecurityMessage('PINs do not match');
      return;
    }
    setPin(pinInput);
    setPinEnabledState(true);
    setPinInput('');
    setConfirmPinInput('');
    setSecurityMessage('PIN enabled successfully! Your app is now locked with a 4-digit PIN.');
  };

  const handleDisablePin = () => {
    if (!verifyPin(pinInput)) {
      setSecurityMessage('Incorrect PIN. Cannot disable.');
      return;
    }
    disablePin();
    setPinEnabledState(false);
    setPinInput('');
    setSecurityMessage('PIN protection disabled.');
  };

  const handleLockNow = () => {
    setShowSecurityModal(false);
    window.dispatchEvent(new Event('hema:lock'));
  };

  // Notification actions
  const handleEnableAlerts = async () => {
    const granted = await requestNativeNotifPermission();
    setDeviceAlertsActive(granted);
    if (granted) {
      await triggerSystemNotification({
        title: 'Hema Financial Alerts Enabled',
        body: 'You will receive status bar alerts for urgent loan repayments and budget thresholds.'
      });
      setInAppAlert('Notifications enabled! A confirmation notification was sent to your status bar.');
    } else {
      setInAppAlert('Notification permission was not granted by your device settings.');
    }
    setTimeout(() => setInAppAlert(null), 4000);
  };

  const handleTestAlert = async () => {
    try {
      const allDebts = await getDebts();
      const result = await checkAndNotifyDueDebts(allDebts, user?.name);
      if (result.sentCount > 0) {
        setInAppAlert(`🔔 Alert Sent: ${result.message}`);
      } else {
        setInAppAlert(`🔔 Status: ${result.message}`);
      }
    } catch (err: any) {
      const sent = await triggerSystemNotification({
        title: 'Hema Finance: Notification Test',
        body: `Hello ${user?.name || 'Family Member'}, your device alerts are working perfectly!`
      });
      setInAppAlert(sent ? '🔔 Test notification dispatched to device status bar!' : '🔔 In-App Alert verified.');
    }
    setTimeout(() => setInAppAlert(null), 4500);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-textMain tracking-tight">{t('settings.title')}</h2>
        <p className="text-textMuted text-sm">{t('settings.subtitle')}</p>
      </div>

      {/* Account Profile Card */}
      {user && (
        <Card className="border border-amber-200/90 bg-gradient-to-r from-amber-50/90 via-white to-primary-50/70 shadow-2xs mb-4 overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0">
                <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-600 to-amber-700 text-white flex items-center justify-center font-black text-lg shadow-xs shrink-0">
                  {user.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <h3 className="font-bold text-slate-900 text-base truncate">{user.name}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold uppercase tracking-wider shrink-0">
                      Active
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 truncate">{user.email}</p>
                  {user.phone && <p className="text-[11px] text-slate-400 mt-0.5">{user.phone}</p>}
                </div>
              </div>

              <button
                type="button"
                onClick={logout}
                className="px-3 py-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 text-red-700 text-xs font-bold transition-all flex items-center space-x-1 shrink-0 cursor-pointer shadow-2xs"
                title="Sign out of current account"
              >
                <LogOut size={13} />
                <span>Sign Out</span>
              </button>
            </div>

            {/* Privacy & Tenant Isolation Status */}
            <div className="mt-3.5 pt-3 border-t border-amber-200/60 flex items-center justify-between text-[11px] text-slate-500">
              <span className="flex items-center space-x-1.5 truncate">
                <Shield size={12} className="text-amber-600 shrink-0" />
                <span className="font-semibold text-slate-700">Storage Security:</span>
                <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60 text-[10px]">
                  Private Vault
                </span>
              </span>
              <span className="text-[10px] text-emerald-700 font-bold flex items-center space-x-1 shrink-0">
                <span>🔒 Strict Data Isolation</span>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cloud Multi-Device Sync Card */}
      <Card className="border border-slate-200 shadow-2xs overflow-hidden bg-white">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2.5">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold ${
                isCloudConfigured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                <Cloud size={18} />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-sm">Cloud Sync & Multi-Device</h3>
                <p className="text-[11px] text-slate-500">Secure Backup & Instant Device Sync</p>
              </div>
            </div>

            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              isCloudConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}>
              {isCloudConfigured ? 'Cloud Active' : 'Offline Vault'}
            </span>
          </div>

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 mb-3 text-xs flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Sync Status:</span>
              <span className="font-semibold text-slate-800 truncate block">
                {cloudSyncState.status === 'syncing' ? '🔄 Synchronizing with cloud...' :
                 cloudSyncState.status === 'synced' ? '✅ All records up to date' :
                 cloudSyncState.status === 'error' ? `⚠️ Error: ${cloudSyncState.errorMessage}` :
                 isCloudConfigured ? 'Cloud connected (idle)' : 'Local offline storage (no cloud configured)'}
              </span>
              {cloudSyncState.lastSyncedAt && (
                <span className="text-[10px] text-slate-400">
                  Last synced: {new Date(cloudSyncState.lastSyncedAt).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2 ml-3">
              {isCloudConfigured && (
                <button
                  type="button"
                  disabled={isSyncing}
                  onClick={handleManualSync}
                  className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs transition-colors flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                  <span>Sync Now</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCloudModal(true)}
                className="px-2.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-lg font-bold text-xs transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <SettingsIcon size={12} />
                <span>{isCloudConfigured ? 'Cloud Settings' : 'Connect Cloud'}</span>
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {/* Language Selection */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-textMain px-1 flex items-center">
            <Globe size={16} className="mr-2 text-primary-600" /> {t('settings.language')}
          </label>
          <div className="flex overflow-x-auto space-x-2 pb-2 scrollbar-hide">
            {languages.map(lang => (
              <button
                key={lang.code}
                onClick={() => i18n.changeLanguage(lang.code)}
                className={cn(
                  "px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap",
                  i18n.language === lang.code 
                    ? "bg-primary-600 text-white shadow-soft" 
                    : "bg-surface text-textMuted border border-borderLight hover:bg-slate-50"
                )}
              >
                {lang.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action List */}
        <Card className="border-none shadow-sm mt-4">
          <CardContent className="p-0 divide-y divide-borderLight">
            <SettingRow 
              icon={<Bell size={18} />} 
              title={t('settings.notifications')} 
              badge={overdueDebts.length > 0 ? `${overdueDebts.length} Due` : undefined}
              badgeColor="bg-amber-100 text-amber-800"
              onClick={() => setShowNotificationsModal(true)}
            />
            <SettingRow 
              icon={<Shield size={18} />} 
              title={t('settings.privacy')} 
              badge={pinEnabled ? 'PIN Active' : 'Off'}
              badgeColor={pinEnabled ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}
              onClick={() => setShowSecurityModal(true)}
            />
            <SettingRow 
              icon={<Database size={18} />} 
              title="Backup, Sync & Restore (JSON / Cloud)" 
              onClick={() => setShowBackupModal(true)} 
            />
            <SettingRow 
              icon={<Download size={18} />} 
              title={t('settings.export')} 
              onClick={handleExportCSV} 
            />
            <SettingRow 
              icon={<RotateCcw size={18} className="text-amber-600" />} 
              title="Reset Account Ledger (రీసెట్ / రీ-స్టార్ట్)" 
              badge="Zero Slate"
              badgeColor="bg-amber-100 text-amber-900 border border-amber-200"
              onClick={() => setShowResetAccountModal(true)} 
            />
          </CardContent>
        </Card>

        {/* Sign Out / Reset session */}
        <button 
          onClick={logout}
          className="w-full flex items-center justify-center space-x-2 py-3.5 bg-red-50 hover:bg-red-100 text-red-700 font-bold rounded-xl mt-6 transition-colors shadow-2xs cursor-pointer text-sm"
        >
          <LogOut size={16} />
          <span>Sign Out / Switch Account</span>
        </button>

      </div>

      {/* ================= MODAL 1: PRIVACY & SECURITY (PIN LOCK) ================= */}
      {showSecurityModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                    <Shield size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-textMain text-base">App PIN Lock</h3>
                    <p className="text-xs text-textMuted">Protect your household finances</p>
                  </div>
                </div>
                <button onClick={() => setShowSecurityModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              {securityMessage && (
                <div className="mb-4 p-2.5 rounded-xl bg-primary-50 text-primary-800 text-xs font-semibold text-center border border-primary-200">
                  {securityMessage}
                </div>
              )}

              <div className="space-y-4">
                {!pinEnabled ? (
                  <>
                    <p className="text-xs text-textMuted">
                      Set a 4-digit PIN to prevent unauthorized access when lending your phone to others.
                    </p>
                    <div>
                      <label className="text-xs font-bold text-textMain mb-1 block">New 4-Digit PIN</label>
                      <input 
                        type="password"
                        maxLength={4}
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        className="w-full text-center text-xl tracking-widest p-2.5 rounded-xl border border-borderLight focus:border-primary-500 focus:outline-none bg-surface"
                        placeholder="••••"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-textMain mb-1 block">Confirm PIN</label>
                      <input 
                        type="password"
                        maxLength={4}
                        value={confirmPinInput}
                        onChange={e => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                        className="w-full text-center text-xl tracking-widest p-2.5 rounded-xl border border-borderLight focus:border-primary-500 focus:outline-none bg-surface"
                        placeholder="••••"
                      />
                    </div>
                    <button 
                      onClick={handleSetPin}
                      disabled={pinInput.length !== 4 || confirmPinInput.length !== 4}
                      className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl text-xs shadow-soft disabled:opacity-50 transition-colors"
                    >
                      Enable App PIN Lock
                    </button>
                  </>
                ) : (
                  <>
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl flex items-center space-x-2 text-green-800 text-xs font-semibold">
                      <Lock size={16} className="text-green-600 shrink-0" />
                      <span>PIN Protection is Currently ACTIVE</span>
                    </div>

                    <div>
                      <label className="text-xs font-bold text-textMain mb-1 block">Enter Current PIN to Disable or Lock</label>
                      <input 
                        type="password"
                        maxLength={4}
                        value={pinInput}
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        className="w-full text-center text-xl tracking-widest p-2.5 rounded-xl border border-borderLight focus:border-primary-500 focus:outline-none bg-surface"
                        placeholder="••••"
                      />
                    </div>

                    <div className="flex space-x-2">
                      <button 
                        onClick={handleLockNow}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-textMain font-bold rounded-xl text-xs transition-colors"
                      >
                        Lock Now
                      </button>
                      <button 
                        onClick={handleDisablePin}
                        disabled={pinInput.length !== 4}
                        className="flex-1 py-2.5 bg-red-100 hover:bg-red-200 text-red-700 font-bold rounded-xl text-xs disabled:opacity-50 transition-colors"
                      >
                        Disable PIN
                      </button>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 2: NOTIFICATIONS & ALERTS ================= */}
      {showNotificationsModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                    <Bell size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-textMain text-base">Notifications & Alerts</h3>
                    <p className="text-xs text-textMuted">Due dates & loan reminders</p>
                  </div>
                </div>
                <button onClick={() => setShowNotificationsModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                {/* Permission status card */}
                <div className="p-3 bg-slate-50 rounded-xl border border-borderLight flex items-center justify-between text-xs">
                  <div>
                    <p className="font-semibold text-textMain">Device Alerts Status:</p>
                    <p className="text-textMuted capitalize">{deviceAlertsActive ? 'Active & System Enabled' : 'Disabled (Tap to Enable)'}</p>
                  </div>
                  <button 
                    onClick={handleEnableAlerts}
                    className="px-3 py-1.5 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 text-xs shadow-xs"
                  >
                    {deviceAlertsActive ? 'Alerts Active' : 'Enable Alerts'}
                  </button>
                </div>

                {/* Overdue / Urgent debts list */}
                <div>
                  <h4 className="text-xs font-bold text-textMain uppercase tracking-wider mb-2">
                    Active Reminders ({overdueDebts.length})
                  </h4>
                  {overdueDebts.length === 0 ? (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-center text-xs text-green-800">
                      <Check size={18} className="mx-auto mb-1 text-green-600" />
                      All loans are currently up to date!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {overdueDebts.map(d => (
                        <div key={d.id} className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs flex items-center justify-between">
                          <div>
                            <p className="font-bold text-amber-950">{d.person}</p>
                            <p className="text-amber-800 text-[11px]">
                              {d.type === 'WE_OWE' ? 'We Owe:' : 'Collect:'} ₹{d.amount.toLocaleString('en-IN')}
                            </p>
                          </div>
                          <span className="text-[10px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                            Due Soon
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <button 
                  onClick={handleTestAlert}
                  className="w-full py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-800 font-bold rounded-xl text-xs transition-colors border border-primary-200 flex items-center justify-center space-x-1.5"
                >
                  <Bell size={14} className="text-primary-700" />
                  <span>Test Mobile Notification (Status Bar Alert)</span>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 3: BACKUP, RESTORE & SYNC ================= */}
      {showBackupModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center">
                    <Database size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-textMain text-base">Backup & Restore</h3>
                    <p className="text-xs text-textMuted">Transfer or save your entire ledger</p>
                  </div>
                </div>
                <button onClick={() => setShowBackupModal(false)} className="text-textMuted hover:text-textMain p-1">
                  <X size={18} />
                </button>
              </div>

              {backupStatus && (
                <div className="mb-4 p-2.5 rounded-xl bg-primary-50 text-primary-800 text-xs font-semibold text-center border border-primary-200">
                  {backupStatus}
                </div>
              )}

              <div className="space-y-3">
                {/* Export JSON Button */}
                <button
                  onClick={handleExportJSON}
                  className="w-full p-3.5 bg-surface border border-borderLight hover:border-primary-400 rounded-xl flex items-center space-x-3 text-left transition-colors group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                    <Download size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-textMain">Create Full JSON Backup</p>
                    <p className="text-[10px] text-textMuted">Saves to Downloads or opens Android Share Sheet (Drive, WhatsApp, Files).</p>
                  </div>
                </button>

                {/* Import JSON Button */}
                <label className="w-full p-3.5 bg-surface border border-borderLight hover:border-primary-400 rounded-xl flex items-center space-x-3 text-left transition-colors cursor-pointer group">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <Upload size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-textMain">Restore from JSON File</p>
                    <p className="text-[10px] text-textMuted">Upload a previous Hema backup to restore data onto this phone or browser.</p>
                  </div>
                  <input type="file" accept=".json,application/json" onChange={handleImportJSON} className="hidden" />
                </label>

                {/* 1-Tap Sample Test Backup Button */}
                <button
                  type="button"
                  onClick={handleLoadSampleBackup}
                  className="w-full p-3.5 bg-amber-50/60 border border-amber-200 hover:border-amber-400 rounded-xl flex items-center space-x-3 text-left transition-colors group cursor-pointer"
                >
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <RefreshCw size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-amber-950">Load Sample Test Backup (1-Tap)</p>
                    <p className="text-[10px] text-amber-800">Populate realistic test data (Loans, Gifts, Transactions) to test restore.</p>
                  </div>
                </button>

                {/* Cloud & Drive Info */}
                <div className="p-3 bg-slate-50 border border-borderLight rounded-xl text-[11px] text-textMuted space-y-1">
                  <p className="font-semibold text-textMain flex items-center">
                    <RefreshCw size={12} className="mr-1 text-primary-600" />
                    How to Sync Across Family Phones:
                  </p>
                  <p>1. Tap <strong>Create Full JSON Backup</strong> and share the file to your family WhatsApp or Google Drive.</p>
                  <p>2. On another phone, open Hema and tap <strong>Restore from JSON File</strong>.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 4: CLOUD CONFIGURATION & SQL SETUP ================= */}
      {showCloudModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-md border-none shadow-2xl bg-surface animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-borderLight">
                <div className="flex items-center space-x-2.5">
                  <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center font-bold">
                    <Cloud size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-textMain text-base">Cloud Backup & Device Sync</h3>
                    <p className="text-xs text-textMuted">Keep data safe and synced across your devices</p>
                  </div>
                </div>
                <button onClick={() => setShowCloudModal(false)} className="text-textMuted hover:text-textMain p-1 cursor-pointer">
                  <X size={18} />
                </button>
              </div>

              {/* Consumer Sync Status Overview */}
              <div className="space-y-3 mb-4">
                <div className={`p-3.5 rounded-2xl border text-xs ${
                  isCloudConfigured 
                    ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950' 
                    : 'bg-amber-50/80 border-amber-200 text-amber-950'
                }`}>
                  <div className="flex items-center space-x-2 font-bold mb-1">
                    {isCloudConfigured ? <CheckCircle2 size={16} className="text-emerald-600" /> : <Shield size={16} className="text-amber-600" />}
                    <span>{isCloudConfigured ? 'Cloud Connection Active' : 'Offline Vault Mode Active'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed opacity-90">
                    {isCloudConfigured
                      ? 'Your transactions, debts, and gifts are synced securely to your private account partition in real-time.'
                      : 'All records are saved securely inside this phone’s encrypted offline storage. You can enable cloud backup below.'}
                  </p>
                </div>

                {isCloudConfigured && (
                  <button
                    type="button"
                    disabled={isSyncing}
                    onClick={() => {
                      handleManualSync();
                      setShowCloudModal(false);
                    }}
                    className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-2 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                    <span>Sync Entire Ledger Now</span>
                  </button>
                )}
              </div>

              {/* Collapsible Advanced Developer Setup */}
              <details className="border border-slate-200 rounded-2xl bg-slate-50 overflow-hidden text-xs">
                <summary className="p-3.5 font-bold text-slate-700 cursor-pointer hover:bg-slate-100/80 flex items-center justify-between select-none">
                  <div className="flex items-center space-x-2">
                    <Database size={14} className="text-slate-500" />
                    <span>Advanced Database & Cloud Settings</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-normal">Click to Expand</span>
                </summary>

                <div className="p-4 border-t border-slate-200 bg-white space-y-4">
                  <form onSubmit={handleSaveCloudCredentials} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Supabase Project URL
                      </label>
                      <input
                        type="url"
                        required
                        value={cloudUrl}
                        onChange={e => setCloudUrl(e.target.value)}
                        placeholder="https://your-project-id.supabase.co"
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Supabase Public Anon Key
                      </label>
                      <textarea
                        required
                        rows={3}
                        value={cloudKey}
                        onChange={e => setCloudKey(e.target.value)}
                        placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                        className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-[11px] font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                      />
                    </div>

                    {testStatus && (
                      <div className={`p-3 rounded-xl text-xs font-medium ${
                        testStatus.testing 
                          ? 'bg-blue-50 text-blue-700 border border-blue-200' 
                          : testStatus.success 
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
                            : 'bg-red-50 text-red-800 border border-red-200'
                      }`}>
                        {testStatus.testing ? 'Testing connection to Supabase...' : testStatus.message}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleTestCloudConnection}
                        disabled={!cloudUrl || !cloudKey || testStatus?.testing}
                        className="flex-1 py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Test Ping
                      </button>
                      <button
                        type="submit"
                        disabled={!cloudUrl || !cloudKey}
                        className="flex-1 py-2.5 px-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold text-xs shadow-md transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50"
                      >
                        Save & Connect
                      </button>
                      {isCloudConfigured && (
                        <button
                          type="button"
                          onClick={handleClearCloudCredentials}
                          className="py-2.5 px-3 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                        >
                          Disconnect
                        </button>
                      )}
                    </div>

                    {/* SQL Schema 1-Click Copy */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800 text-xs">Database Schema (SQL):</span>
                        <button
                          type="button"
                          onClick={handleCopySchema}
                          className="px-2.5 py-1 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg font-bold text-[10px] flex items-center space-x-1 transition-colors cursor-pointer"
                        >
                          {copySuccess ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                          <span>{copySuccess ? 'Copied!' : 'Copy SQL Schema'}</span>
                        </button>
                      </div>
                      <p className="text-[11px] text-slate-600 leading-relaxed">
                        Paste this SQL in your <strong>Supabase Dashboard → SQL Editor</strong> if configuring a custom project.
                      </p>
                    </div>
                  </form>
                </div>
              </details>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* ================= MODAL 5: RESET ACCOUNT LEDGER CONFIRMATION ================= */}
      {showResetAccountModal && createPortal(
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95">
            <CardContent className="p-6">
              <div className="flex justify-between items-center mb-4">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <h3 className="font-bold text-textMain text-base">Reset Account Ledger</h3>
                    <p className="text-xs text-textMuted">Clean isolated slate</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowResetAccountModal(false)}
                  className="text-textMuted hover:text-textMain p-1"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-4">
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-900 text-xs space-y-2">
                  <p className="font-bold">⚠️ Warning: Irreversible Action</p>
                  <p>
                    This will permanently clear all recorded <strong>transactions, debts, and gifts</strong> in the active partition for <strong>{user?.name}</strong>.
                  </p>
                  <p className="text-[11px] text-red-700">
                    🔒 Other user accounts on this phone (and their private ledgers) will <strong>NOT</strong> be touched.
                  </p>
                </div>

                <div className="flex space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowResetAccountModal(false)}
                    className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={resettingAccount}
                    onClick={handleResetMyAccount}
                    className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl text-xs shadow-md transition-colors disabled:opacity-50"
                  >
                    {resettingAccount ? 'Purging...' : 'Yes, Reset to Zero'}
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body
      )}

      {/* Floating In-App Alert Toast */}
      {inAppAlert && createPortal(
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[1000] w-[90%] max-w-sm p-3.5 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 flex items-center space-x-2.5 animate-in slide-in-from-top duration-300">
          <Bell size={18} className="text-amber-400 shrink-0 animate-bounce" />
          <span className="text-xs font-semibold leading-snug">{inAppAlert}</span>
        </div>,
        document.body
      )}

    </div>
  );
};

function SettingRow({ 
  icon, 
  title, 
  badge, 
  badgeColor, 
  onClick 
}: { 
  icon: React.ReactNode; 
  title: string; 
  badge?: string; 
  badgeColor?: string; 
  onClick?: () => void; 
}) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center space-x-3 text-textMain">
        <div className="text-primary-600 bg-primary-50 p-2 rounded-lg">
          {icon}
        </div>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <div className="flex items-center space-x-2">
        {badge && (
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${badgeColor || 'bg-slate-100 text-slate-700'}`}>
            {badge}
          </span>
        )}
        <ChevronRight size={18} className="text-textMuted" />
      </div>
    </button>
  );
}

export default Settings;
