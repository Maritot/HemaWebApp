import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Shield, Lock, Eye, EyeOff, X, ArrowRight, KeyRound } from 'lucide-react';
import { verifyVaultAccess, hasVaultPinConfigured } from '@/lib/security';
import { useAuth } from '@/context/AuthContext';

interface VaultLockModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const VaultLockModal: React.FC<VaultLockModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const { user } = useAuth();
  const [passcode, setPasscode] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [shake, setShake] = useState(false);
  const isFirstTime = !hasVaultPinConfigured();

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!passcode.trim()) {
      setErrorMsg('Please enter your passcode');
      triggerShake();
      return;
    }

    const verified = verifyVaultAccess(passcode.trim(), (user as any)?.password);
    if (verified) {
      setPasscode('');
      setErrorMsg('');
      onSuccess();
    } else {
      setErrorMsg('Incorrect passcode. Access denied.');
      triggerShake();
      setPasscode('');
    }
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 500);
  };

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className={`w-full max-w-xs border border-amber-500/30 shadow-2xl bg-slate-900 text-white rounded-3xl overflow-hidden ${shake ? 'animate-shake' : ''}`}>
        <CardContent className="p-6 space-y-4">
          <div className="flex justify-between items-center pb-1">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-400 flex items-center justify-center">
              <Shield size={20} />
            </div>
            <button 
              type="button"
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-full cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          <div>
            <h3 className="font-extrabold text-base text-white tracking-tight flex items-center gap-1.5">
              <span>Confidential Assets Vault</span>
              <Lock size={14} className="text-amber-400" />
            </h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              {isFirstTime 
                ? 'Create a 4-digit PIN to secure your family assets vault.' 
                : 'Enter your 4-digit security PIN or password to unlock.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3.5">
            <div className="relative">
              <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPass ? 'text' : 'password'}
                autoFocus
                maxLength={20}
                value={passcode}
                onChange={e => {
                  setPasscode(e.target.value);
                  setErrorMsg('');
                }}
                placeholder={isFirstTime ? 'Set 4-digit PIN (e.g. 1234)' : 'Enter PIN or password'}
                className="w-full pl-10 pr-10 py-3 bg-slate-800/90 border border-slate-700 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-xl text-center text-sm font-mono tracking-widest text-white outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
              >
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {errorMsg && (
              <p className="text-[11px] text-red-400 font-semibold text-center animate-in fade-in">
                {errorMsg}
              </p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800 text-white font-bold rounded-xl text-xs shadow-md transition-all active:scale-[0.98] flex items-center justify-center space-x-1 cursor-pointer"
              >
                <span>Unlock</span>
                <ArrowRight size={14} />
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};
