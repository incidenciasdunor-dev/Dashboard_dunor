import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, Info, X, HelpCircle, Trash2 } from 'lucide-react';

export interface SystemModalState {
  isOpen: boolean;
  type: 'success' | 'error' | 'info' | 'confirm' | 'danger';
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface SystemModalProps {
  modal?: SystemModalState;
  state?: SystemModalState;
  onClose: () => void;
}

export const SystemModal: React.FC<SystemModalProps> = ({ modal, state, onClose }) => {
  const activeModal = modal || state;
  if (!activeModal || !activeModal.isOpen) return null;

  const handleConfirm = () => {
    if (activeModal.onConfirm) {
      activeModal.onConfirm();
    }
    onClose();
  };

  const handleCancel = () => {
    if (activeModal.onCancel) {
      activeModal.onCancel();
    }
    onClose();
  };

  const getIcon = () => {
    switch (activeModal.type) {
      case 'success':
        return <CheckCircle2 className="w-10 h-10 text-emerald-500" />;
      case 'error':
      case 'danger':
        return <Trash2 className="w-10 h-10 text-rose-500" />;
      case 'info':
        return <Info className="w-10 h-10 text-indigo-500" />;
      case 'confirm':
        return <HelpCircle className="w-10 h-10 text-amber-500" />;
      default:
        return <Info className="w-10 h-10 text-indigo-500" />;
    }
  };

  const getHeaderBg = () => {
    switch (activeModal.type) {
      case 'success':
        return 'bg-emerald-50 border-emerald-100 text-emerald-900';
      case 'error':
      case 'danger':
        return 'bg-rose-50 border-rose-100 text-rose-900';
      case 'info':
        return 'bg-indigo-50 border-indigo-100 text-indigo-900';
      case 'confirm':
        return 'bg-amber-50 border-amber-100 text-amber-900';
      default:
        return 'bg-slate-50 border-slate-100 text-slate-900';
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          transition={{ duration: 0.2 }}
          className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-md w-full overflow-hidden"
        >
          <div className="p-6 text-center space-y-4">
            <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center border ${getHeaderBg()}`}>
              {getIcon()}
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                {activeModal.title}
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line leading-relaxed">
                {activeModal.message}
              </p>
            </div>

            <div className="pt-2 flex items-center justify-center gap-3">
              {(activeModal.type === 'confirm' || activeModal.type === 'danger') && (
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 px-5 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all cursor-pointer"
                >
                  {activeModal.cancelText || 'Cancelar'}
                </button>
              )}

              <button
                type="button"
                onClick={handleConfirm}
                className={`flex-1 px-5 py-3 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer ${
                  activeModal.type === 'danger'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : activeModal.type === 'confirm'
                    ? 'bg-amber-600 hover:bg-amber-700'
                    : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {activeModal.confirmText || (activeModal.type === 'confirm' || activeModal.type === 'danger' ? 'Confirmar' : 'Aceptar')}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
