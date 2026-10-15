import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, AlertTriangle, X } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title?: string;
  message?: string;
  itemName?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDangerous?: boolean;
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  title = "Confirm Deletion",
  message = "Are you sure you want to delete this item? This action cannot be undone.",
  itemName,
  confirmText = "Delete",
  cancelText = "Cancel",
  onConfirm,
  onCancel,
  isDangerous = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onCancel();
      }
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
      >
        <div className="p-5 sm:p-6 text-center space-y-4">
          {/* Warning Icon Badge */}
          <div className="mx-auto w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center shadow-inner">
            <Trash2 size={24} className="stroke-[2.2]" />
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
              {title}
            </h3>
            {itemName && (
              <p className="text-xs font-semibold text-slate-700 bg-slate-100 py-1 px-2.5 rounded-lg inline-block max-w-full truncate">
                {itemName}
              </p>
            )}
            <p className="text-xs text-slate-500 leading-relaxed">
              {message}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 rounded-xl font-bold text-xs transition-colors"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-xl font-bold text-xs shadow-md shadow-red-600/20 transition-all active:scale-95"
            >
              {confirmText}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
};
