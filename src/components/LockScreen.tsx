import React, { useState } from 'react';
import { Lock, Delete, ShieldCheck } from 'lucide-react';
import { verifyPin } from '@/lib/security';

interface LockScreenProps {
  onUnlock: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ onUnlock }) => {
  const [pin, setPinState] = useState('');
  const [error, setError] = useState(false);

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      const nextPin = pin + digit;
      setPinState(nextPin);
      setError(false);

      if (nextPin.length === 4) {
        setTimeout(() => {
          if (verifyPin(nextPin)) {
            onUnlock();
          } else {
            setError(true);
            setTimeout(() => {
              setPinState('');
              setError(false);
            }, 600);
          }
        }, 100);
      }
    }
  };

  const handleDelete = () => {
    if (pin.length > 0) {
      setPinState(pin.slice(0, -1));
      setError(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-between py-12 px-6">
      {/* Top Branding */}
      <div className="flex flex-col items-center mt-6">
        <div className="w-16 h-16 rounded-3xl bg-primary-100 flex items-center justify-center text-primary-600 mb-4 shadow-soft">
          <Lock size={32} />
        </div>
        <h2 className="text-2xl font-bold text-textMain tracking-tight">Hema Finance</h2>
        <p className="text-textMuted text-sm mt-1">Enter 4-Digit Security PIN</p>
      </div>

      {/* PIN Dots */}
      <div className="flex space-x-4 my-8">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition-all duration-200 ${
              error
                ? 'bg-red-500 scale-110'
                : i < pin.length
                ? 'bg-primary-600 scale-125 shadow-soft'
                : 'bg-borderLight border border-textMuted/30'
            }`}
          />
        ))}
      </div>

      {error && (
        <p className="text-red-500 text-xs font-semibold -mt-4 animate-shake">
          Incorrect PIN. Please try again.
        </p>
      )}

      {/* Numeric Keypad */}
      <div className="w-full max-w-xs grid grid-cols-3 gap-4 mb-6">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((num) => (
          <button
            key={num}
            onClick={() => handleDigit(num)}
            className="w-16 h-16 mx-auto rounded-full bg-surface border border-borderLight text-xl font-bold text-textMain flex items-center justify-center active:bg-primary-50 active:text-primary-600 active:scale-95 transition-all shadow-xs"
          >
            {num}
          </button>
        ))}
        <div className="w-16 h-16 mx-auto" />
        <button
          onClick={() => handleDigit('0')}
          className="w-16 h-16 mx-auto rounded-full bg-surface border border-borderLight text-xl font-bold text-textMain flex items-center justify-center active:bg-primary-50 active:text-primary-600 active:scale-95 transition-all shadow-xs"
        >
          0
        </button>
        <button
          onClick={handleDelete}
          className="w-16 h-16 mx-auto rounded-full bg-surface border border-borderLight text-textMuted flex items-center justify-center active:bg-red-50 active:text-red-600 active:scale-95 transition-all shadow-xs"
        >
          <Delete size={20} />
        </button>
      </div>

      <div className="flex items-center text-xs text-textMuted space-x-1.5 mb-2">
        <ShieldCheck size={14} className="text-primary-600" />
        <span>Household Data Protected On-Device</span>
      </div>
    </div>
  );
};
