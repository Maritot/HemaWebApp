import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Globe, Bell, Shield, Download, LogOut, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { getTransactions, getDebts, getGifts } from '@/lib/db';

const Settings: React.FC = () => {
  const { t, i18n } = useTranslation();

  const languages = [
    { code: 'en', label: 'English' },
    { code: 'hi', label: 'हिंदी (Hindi)' },
    { code: 'te', label: 'తెలుగు (Telugu)' }
  ];

  const handleExportCSV = async () => {
    // Fetch all data
    const txs = await getTransactions();
    const debts = await getDebts();
    const gifts = await getGifts();

    // Generate CSV string
    let csv = '--- TRANSACTIONS ---\n';
    csv += 'Date,Type,Category,Amount,Notes\n';
    txs.forEach(tx => {
      csv += `${new Date(tx.date).toISOString()},${tx.type},${tx.categoryId},${tx.amount},${tx.notes || ''}\n`;
    });

    csv += '\n--- DEBTS ---\n';
    csv += 'Date Created,Type,Person,Amount,Status,Due Date\n';
    debts.forEach(d => {
      csv += `${new Date(d.dateCreated).toISOString()},${d.type},${d.person},${d.amount},${d.status},${new Date(d.dueDate).toISOString()}\n`;
    });

    csv += '\n--- GIFTS (SHAGUN) ---\n';
    csv += 'Date,Type,Person,Occasion,Amount,Item\n';
    gifts.forEach(g => {
      csv += `${new Date(g.date).toISOString()},${g.type},${g.person},${g.occasion},${g.amount},${g.item || ''}\n`;
    });

    // Create a Blob and download it
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'hema_finance_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
            <SettingRow icon={<Bell size={18} />} title={t('settings.notifications')} />
            <SettingRow icon={<Shield size={18} />} title={t('settings.privacy')} />
            <SettingRow 
              icon={<Download size={18} />} 
              title={t('settings.export')} 
              onClick={handleExportCSV} 
            />
          </CardContent>
        </Card>

        {/* Logout */}
        <button className="w-full flex items-center justify-center space-x-2 py-4 bg-red-50 text-red-600 font-bold rounded-xl mt-6 hover:bg-red-100 transition-colors">
          <LogOut size={18} />
          <span>{t('settings.logout')}</span>
        </button>

      </div>
    </div>
  );
};

function SettingRow({ icon, title, onClick }: { icon: React.ReactNode, title: string, onClick?: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors">
      <div className="flex items-center space-x-3 text-textMain">
        <div className="text-primary-600 bg-primary-50 p-2 rounded-lg">
          {icon}
        </div>
        <span className="font-semibold text-sm">{title}</span>
      </div>
      <ChevronRight size={18} className="text-textMuted" />
    </button>
  );
}

export default Settings;
