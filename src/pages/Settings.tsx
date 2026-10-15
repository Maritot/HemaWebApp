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
  Share2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { 
  getTransactions, 
  getDebts, 
  getGifts, 
  exportFullBackup, 
  restoreFullBackup, 
  HemaBackupPayload,
  DebtRecordItem
} from '@/lib/db';
import { 
  isPinEnabled, 
  setPin, 
  disablePin, 
  verifyPin 
} from '@/lib/security';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' }
  ];

  // Modals
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showBackupModal, setShowBackupModal] = useState(false);

  // Security Form State
  const [pinEnabled, setPinEnabledState] = useState(isPinEnabled());
  const [pinInput, setPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);

  // Notifications State & Interactive in-app alert
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
  const [overdueDebts, setOverdueDebts] = useState<DebtRecordItem[]>([]);
  const [inAppAlert, setInAppAlert] = useState<string | null>(null);

  // Backup State
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    }
    loadDebtAlerts();
  }, []);

  const loadDebtAlerts = async () => {
    const debts = await getDebts();
    const now = Date.now();
    const urgent = debts.filter(d => 
      d.status !== 'SETTLED' && (d.status === 'OVERDUE' || d.dueDate <= now + 3 * 86400000)
    );
    setOverdueDebts(urgent);
  };

  // Universal helper for Android WebView & Web file export / sharing
  const shareOrDownloadFile = async (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    
    // 1. Try Native Android Share Sheet (Capacitor / Mobile Web)
    if (typeof navigator !== 'undefined' && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: mimeType });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: filename,
            text: 'Hema Finance Data Export'
          });
          return true;
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.warn('File share failed, falling back', err);
      }
    }

    // 2. Try Web Share API with text
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: filename,
          text: content.length < 50000 ? content : content.slice(0, 50000)
        });
        return true;
      } catch (err: any) {
        if (err.name !== 'AbortError') console.warn('Text share failed, falling back', err);
      }
    }

    // 3. Standard browser anchor download
    try {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 1000);
      return true;
    } catch (err) {
      console.warn('Anchor download failed, copying to clipboard', err);
    }

    // 4. Clipboard fallback
    try {
      await navigator.clipboard.writeText(content);
      alert('Content copied to clipboard! You can paste it into any document or messaging app.');
      return true;
    } catch {
      return false;
    }
  };

  // CSV Export
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
      await shareOrDownloadFile(csv, filename, 'text/csv');
      setBackupStatus('CSV Export ready! Shared or saved.');
    } catch (err: any) {
      setBackupStatus(`CSV Export failed: ${err.message}`);
    }
  };

  // Full JSON Backup Export
  const handleExportJSON = async () => {
    try {
      const backup = await exportFullBackup();
      const jsonStr = JSON.stringify(backup, null, 2);
      const filename = `hema_full_backup_${new Date().toISOString().slice(0, 10)}.json`;
      await shareOrDownloadFile(jsonStr, filename, 'application/json');
      setBackupStatus('Backup exported successfully! File shared or saved.');
    } catch (e: any) {
      setBackupStatus(`Backup export failed: ${e.message}`);
    }
  };

  // Full JSON Backup Import / Restore
  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed: HemaBackupPayload = JSON.parse(event.target?.result as string);
        await restoreFullBackup(parsed);
        setBackupStatus('Backup restored successfully! Refreshing...');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err: any) {
        setBackupStatus(`Failed to restore backup: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  // Security Handlers
  const handleSavePin = () => {
    if (pinInput.length !== 4) {
      setSecurityMessage('PIN must be exactly 4 digits');
      return;
    }
    if (pinInput !== confirmPinInput) {
      setSecurityMessage('PINs do not match');
      return;
    }
    setPin(pinInput);
    setPinEnabledState(true);
    setSecurityMessage('Security PIN enabled successfully!');
    setPinInput('');
    setConfirmPinInput('');
    setTimeout(() => {
      setShowSecurityModal(false);
      setSecurityMessage(null);
    }, 1200);
  };

  const handleDisablePin = () => {
    if (disablePin(pinInput)) {
      setPinEnabledState(false);
      setSecurityMessage('Security PIN disabled');
      setPinInput('');
      setTimeout(() => {
        setShowSecurityModal(false);
        setSecurityMessage(null);
      }, 1000);
    } else {
      setSecurityMessage('Incorrect current PIN');
    }
  };

  const handleLockNow = () => {
    setShowSecurityModal(false);
    window.dispatchEvent(new CustomEvent('hema:lock'));
  };

  // Notification Permission Request with haptic and in-app feedback
  const requestNotificationPermission = async () => {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([80, 40, 80]);
    }
    if ('Notification' in window) {
      try {
        const res = await Notification.requestPermission();
        setNotifPermission(res);
        if (res === 'granted') {
          new Notification('Hema Finance Alerts Active', {
            body: 'You will receive timely reminders for due loans and upcoming family gifts.',
            icon: '/hema-icon-192.png'
          });
        }
      } catch (e) {
        console.warn('Notification permission error', e);
      }
    }
    setInAppAlert('🔔 Notification Alerts Active! Hema will monitor your loans and gifts.');
    setTimeout(() => setInAppAlert(null), 4500);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-20">
      
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-textMain tracking-tight">{t('settings.title')}</h2>
        <p className="text-textMuted text-sm">{t('settings.subtitle')}</p>
      </div>

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
          </CardContent>
        </Card>

        {/* Sign Out / Reset session */}
        <button 
          onClick={() => {
            if (pinEnabled) {
              handleLockNow();
            } else {
              window.location.reload();
            }
          }}
          className="w-full flex items-center justify-center space-x-2 py-4 bg-red-50 text-red-600 font-bold rounded-xl mt-6 hover:bg-red-100 transition-colors shadow-xs"
        >
          <LogOut size={18} />
          <span>{pinEnabled ? 'Lock App Session' : t('settings.logout')}</span>
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
                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-borderLight">
                  <div className="flex items-center space-x-2">
                    {pinEnabled ? <Lock size={16} className="text-green-600" /> : <Unlock size={16} className="text-textMuted" />}
                    <span className="text-xs font-semibold text-textMain">PIN Protection Status:</span>
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${pinEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-700'}`}>
                    {pinEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>

                {!pinEnabled ? (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-textMuted">Set 4-Digit PIN</label>
                      <input 
                        type="password" 
                        maxLength={4}
                        inputMode="numeric"
                        value={pinInput} 
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••" 
                        className="w-full mt-1 p-3 text-center tracking-widest text-lg font-bold bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-textMuted">Confirm 4-Digit PIN</label>
                      <input 
                        type="password" 
                        maxLength={4}
                        inputMode="numeric"
                        value={confirmPinInput} 
                        onChange={e => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••" 
                        className="w-full mt-1 p-3 text-center tracking-widest text-lg font-bold bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none" 
                      />
                    </div>
                    <button 
                      onClick={handleSavePin}
                      disabled={pinInput.length !== 4 || confirmPinInput.length !== 4}
                      className="w-full py-3 bg-primary-600 hover:bg-primary-700 text-white font-bold rounded-xl text-xs disabled:opacity-50 transition-colors shadow-soft"
                    >
                      Enable Security PIN
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-textMuted">Enter Current PIN to Disable</label>
                      <input 
                        type="password" 
                        maxLength={4}
                        inputMode="numeric"
                        value={pinInput} 
                        onChange={e => setPinInput(e.target.value.replace(/\D/g, ''))}
                        placeholder="••••" 
                        className="w-full mt-1 p-3 text-center tracking-widest text-lg font-bold bg-background rounded-xl border border-borderLight focus:border-primary-400 outline-none" 
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
                    <p className="text-textMuted capitalize">Active & In-App Enabled</p>
                  </div>
                  <button 
                    onClick={requestNotificationPermission}
                    className="px-3 py-1.5 bg-primary-600 text-white font-bold rounded-lg hover:bg-primary-700 text-xs shadow-xs"
                  >
                    Enable Alerts
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
                  onClick={() => {
                    if (typeof navigator !== 'undefined' && navigator.vibrate) {
                      navigator.vibrate([100, 50, 100, 50, 200]);
                    }
                    setInAppAlert('🔔 Due Date Alert: Ramesh Uncle repayment of ₹10,000 is due in 3 days!');
                    setTimeout(() => setInAppAlert(null), 4500);

                    if (notifPermission === 'granted' && 'Notification' in window) {
                      new Notification('Hema Reminder Test', {
                        body: 'Reminders are functioning properly on your device.',
                        icon: '/hema-icon-192.png'
                      });
                    } else {
                      requestNotificationPermission();
                    }
                  }}
                  className="w-full py-2.5 bg-primary-50 hover:bg-primary-100 text-primary-800 font-bold rounded-xl text-xs transition-colors border border-primary-200"
                >
                  🔔 Test Device Reminder
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
          <Card className="w-full max-w-sm border-none shadow-2xl bg-surface animate-in zoom-in-95">
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
                  className="w-full p-3.5 bg-surface border border-borderLight hover:border-primary-400 rounded-xl flex items-center space-x-3 text-left transition-colors group"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                    <Download size={18} />
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-xs text-textMain">Create Full JSON Backup</p>
                    <p className="text-[10px] text-textMuted">Downloads or shares complete ledger (Gifts, Debts, Transactions, People) as a single file.</p>
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
