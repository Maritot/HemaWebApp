import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { BrowserRouter as Router, Routes, Route, NavLink } from 'react-router-dom';
import { Home, IndianRupee, Users, Gift, Bot, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Debts from './pages/Debts';
import Gifts from './pages/Gifts';
import Assistant from './pages/Assistant';
import SettingsPage from './pages/Settings';
import { LockScreen } from './components/LockScreen';
import { isSessionUnlocked, lockSession, isPinEnabled } from './lib/security';

const App: React.FC = () => {
  const { t } = useTranslation();
  const [isLocked, setIsLocked] = useState(!isSessionUnlocked());

  useEffect(() => {
    const handleLock = () => {
      lockSession();
      setIsLocked(true);
    };
    window.addEventListener('hema:lock', handleLock);
    return () => window.removeEventListener('hema:lock', handleLock);
  }, []);

  if (isLocked && isPinEnabled()) {
    return <LockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <Router>
      <div className="flex flex-col h-screen bg-background text-textMain font-sans overflow-hidden">
        {/* Header */}
        <header className="bg-surface shadow-sm py-4 px-6 flex justify-between items-center z-10">
          <h1 className="text-2xl font-bold text-primary-600 tracking-tight">Hema</h1>
          <div className="flex items-center space-x-2">
            {isPinEnabled() && (
              <button
                onClick={() => {
                  lockSession();
                  setIsLocked(true);
                }}
                className="p-1.5 rounded-full hover:bg-slate-100 text-textMuted"
                title="Lock App"
              >
                <Lock size={18} />
              </button>
            )}
            <NavLink to="/settings" className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold cursor-pointer">
              US
            </NavLink>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto pb-24 p-4 md:p-6 lg:max-w-3xl lg:mx-auto lg:w-full">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/debts" element={<Debts />} />
            <Route path="/gifts" element={<Gifts />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>

        {/* Bottom Navigation */}
        <nav className="absolute bottom-0 w-full bg-surface border-t border-borderLight shadow-[0_-4px_20px_-2px_rgba(0,0,0,0.05)] pb-safe z-20">
          <div className="flex justify-around items-center h-16 max-w-md mx-auto">
            <NavItem to="/" icon={<Home size={22} />} label={t('nav.home')} />
            <NavItem to="/expenses" icon={<IndianRupee size={22} />} label={t('nav.expenses')} />
            <NavItem to="/debts" icon={<Users size={22} />} label={t('nav.debts')} />
            <NavItem to="/gifts" icon={<Gift size={22} />} label={t('nav.gifts')} />
            <NavItem to="/assistant" icon={<Bot size={22} />} label={t('nav.ai')} />
          </div>
        </nav>
      </div>
    </Router>
  );
};

function NavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink 
      to={to} 
      className={({ isActive }) => cn(
        "flex flex-col items-center justify-center w-16 h-full transition-colors duration-200",
        isActive ? "text-primary-600" : "text-textMuted hover:text-primary-400"
      )}
    >
      {icon}
      <span className="text-[10px] mt-1 font-medium">{label}</span>
    </NavLink>
  );
}

export default App;
