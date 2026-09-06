import { CheckCircle2, AlertCircle, Info, AlertTriangle, X } from "lucide-react";
import { useState, useCallback } from "react";

import { ToastContext, type ToastMessage, type ToastType } from "./use-admin-toast";

export function AdminToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((title: string, message?: string, type: ToastType = "success") => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, title, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto p-4 rounded-2xl border backdrop-blur-xl shadow-2xl flex items-start gap-3 transition-all duration-300 animate-in slide-in-from-bottom-3 ${
              toast.type === "success"
                ? "bg-slate-900/90 border-emerald-500/30 text-emerald-300"
                : toast.type === "error"
                ? "bg-slate-900/90 border-rose-500/30 text-rose-300"
                : toast.type === "warning"
                ? "bg-slate-900/90 border-amber-500/30 text-amber-300"
                : "bg-slate-900/90 border-indigo-500/30 text-indigo-300"
            }`}
          >
            <div className="mt-0.5">
              {toast.type === "success" && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
              {toast.type === "error" && <AlertCircle className="w-5 h-5 text-rose-400" />}
              {toast.type === "warning" && <AlertTriangle className="w-5 h-5 text-amber-400" />}
              {toast.type === "info" && <Info className="w-5 h-5 text-indigo-400" />}
            </div>
            <div className="flex-1 space-y-0.5">
              <h4 className="text-sm font-semibold text-white">{toast.title}</h4>
              {toast.message && <p className="text-xs text-slate-300">{toast.message}</p>}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
