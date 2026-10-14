import React, { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { Home, IndianRupee, Users, Gift, Bot, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Keyboard } from '@capacitor/keyboard';
import Dashboard from './pages/Dashboard';
import Expenses from './pages/Expenses';
import Debts from './pages/Debts';
import Gifts from './pages/Gifts';
import Assistant from './pages/Assistant';
import SettingsPage from './pages/Settings';
import { LockScreen } from './components/LockScreen';
import { isSessionUnlocked, lockSession, isPinEnabled } from './lib/security';

const AppContent: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const isAssistantPage = location.pathname === '/assistant';
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);

  useEffect(() => {
    let showListener: any;
    let hideListener: any;

    try {
      showListener = Keyboard.addListener('keyboardWillShow', () => setIsKeyboardOpen(true));
      hideListener = Keyboard.addListener('keyboardWillHide', () => setIsKeyboardOpen(false));
    } catch (e) {}

    const handleResize = () => {
      if (window.visualViewport) {
        // When soft keyboard opens on mobile, visualViewport height shrinks significantly
        const isShrunk = window.visualViewport.height < window.innerHeight * 0.82;
        setIsKeyboardOpen(isShrunk);
      }
    };

    window.visualViewport?.addEventListener('resize', handleResize);
    window.addEventListener('resize', handleResize);

    return () => {
      showListener?.remove?.();
      hideListener?.remove?.();
      window.visualViewport?.removeEventListener('resize', handleResize);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen bg-background text-textMain font-sans overflow-hidden">
      {/* Header */}
      <header className="bg-surface shadow-xs py-3 px-5 sm:px-6 flex justify-between items-center z-10 shrink-0 border-b border-borderLight">
        <h1 className="text-xl sm:text-2xl font-bold text-primary-600 tracking-tight">Hema</h1>
        <div className="flex items-center space-x-2">
          {isPinEnabled() && (
            <button
              onClick={() => {
                lockSession();
                window.dispatchEvent(new Event('hema:lock'));
              }}
              className="p-1.5 rounded-full hover:bg-slate-100 text-textMuted"
              title="Lock App"
            >
              <Lock size={18} />
            </button>
          )}
          <NavLink to="/settings" className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 font-semibold cursor-pointer text-xs">
            US
          </NavLink>
        </div>
      </header>

      {/* Main Content Area:
          For Assistant: strictly flex-1 min-h-0 overflow-hidden with zero outer scroll so the top AI header never goes under the header.
          For Standard pages: overflow-y-auto pb-24 for scrollable dashboard cards.
      */}
      <main className={cn(
        "flex-1 min-h-0",
        isAssistantPage 
          ? "flex flex-col overflow-hidden px-2.5 sm:px-4 pt-1 sm:pt-2 pb-0 lg:max-w-3xl lg:mx-auto lg:w-full"
          : "overflow-y-auto pb-24 p-4 md:p-6 lg:max-w-3xl lg:mx-auto lg:w-full"
      )}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/expenses" element={<Expenses />} />
          <Route path="/debts" element={<Debts />} />
          <Route path="/gifts" element={<Gifts />} />
          <Route path="/assistant" element={<Assistant isKeyboardOpen={isKeyboardOpen} />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Bottom Navigation:
          - Docked relatively under the Assistant container when keyboard is closed.
          - Completely hidden when keyboard is open to give 100% vertical space to the chat and avoid floating nav clutter.
      */}
      <nav className={cn(
        "w-full bg-surface border-t border-borderLight shadow-[0_-4px_20px_-2px_rgba(0,0,0,0.05)] pb-safe z-20 transition-all duration-150",
        isAssistantPage ? "relative shrink-0" : "absolute bottom-0",
        isKeyboardOpen ? "hidden" : "block"
      )}>
        <div className="flex justify-around items-center h-14 sm:h-16 max-w-md mx-auto">
          <NavItem to="/" icon={<Home size={20} />} label={t('nav.home')} />
          <NavItem to="/expenses" icon={<IndianRupee size={20} />} label={t('nav.expenses')} />
          <NavItem to="/debts" icon={<Users size={20} />} label={t('nav.debts')} />
          <NavItem to="/gifts" icon={<Gift size={20} />} label={t('nav.gifts')} />
          <NavItem to="/assistant" icon={<Bot size={20} />} label={t('nav.ai')} />
        </div>
      </nav>
    </div>
  );
};

const App: React.FC = () => {
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
      <AppContent />
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
