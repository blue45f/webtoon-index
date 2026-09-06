import { Ticket, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

import { adminFetch, formatDate } from "./admin-client";

import { useT } from "@/shared/lib/i18n";

export interface PromoItem {
  id: string;
  code: string;
  discountType: "percent" | "fixed";
  discountValue: number;
  maxUses: number;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
}

interface AdminPromosProps {
  userId: string;
}

export function AdminPromos({ userId }: AdminPromosProps) {
  const [promos, setPromos] = useState<PromoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  // New promo modal
  const [showModal, setShowModal] = useState(false);
  const [code, setCode] = useState("");
  const [discountType, setDiscountType] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState(10);
  const [maxUses, setMaxUses] = useState(100);
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await adminFetch<{ items: PromoItem[] }>("/promos", userId);
      setPromos(res.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.promos.loadError"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      setSubmitting(true);
      await adminFetch("/promos", userId, {
        method: "POST",
        body: JSON.stringify({
          code,
          discountType,
          discountValue,
          maxUses,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        }),
      });
      setShowModal(false);
      setCode("");
      setDiscountValue(10);
      setMaxUses(100);
      setExpiresAt("");
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id: string) => {
    try {
      await adminFetch(`/promos/${id}/toggle`, userId, { method: "POST" });
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t("admin.promos.confirmDelete"))) return;
    try {
      await adminFetch(`/promos/${id}`, userId, { method: "DELETE" });
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-6 rounded-2xl backdrop-blur-xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Ticket className="w-5 h-5 text-indigo-400" />
            {t("admin.promos.title")}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {t("admin.promos.desc")}
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition-all flex items-center gap-2 self-start sm:self-auto shadow-lg shadow-indigo-600/20"
        >
          <Plus className="w-4 h-4" />
          {t("admin.promos.create")}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-400">{t("admin.promos.loading")}</div>
      ) : promos.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/30 border border-slate-800 rounded-2xl text-slate-400">
          {t("admin.promos.empty")}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 font-medium uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="p-4">{t("admin.promos.thCode")}</th>
                <th className="p-4">{t("admin.promos.thBenefit")}</th>
                <th className="p-4">{t("admin.promos.thUsage")}</th>
                <th className="p-4">{t("admin.plans.tableHeaderStatus")}</th>
                <th className="p-4">{t("admin.campaigns.endsAt")}</th>
                <th className="p-4 text-right">{t("admin.plans.tableHeaderAction")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {promos.map((item) => (
                <tr key={item.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono font-bold text-indigo-300">{item.code}</td>
                  <td className="p-4 font-semibold text-white">
                    {item.discountType === "percent"
                      ? `${item.discountValue}%`
                      : `₩${item.discountValue.toLocaleString()}`}
                  </td>
                  <td className="p-4 text-slate-300">
                    {item.usedCount} / {item.maxUses}
                  </td>
                  <td className="p-4">
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        item.isActive
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-400 border border-slate-700"
                      }`}
                    >
                      {item.isActive ? t("admin.plans.statusActive") : t("admin.plans.statusInactive")}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-xs font-mono">
                    {item.expiresAt ? formatDate(item.expiresAt) : "Unlimited"}
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => void handleToggle(item.id)}
                        className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                      >
                        {item.isActive ? (
                          <ToggleRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-slate-600" />
                        )}
                      </button>
                      <button
                        onClick={() => void handleDelete(item.id)}
                        className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-white">{t("admin.promos.modalTitle")}</h3>

            <div>
              <label htmlFor="promo-code" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.promos.inputCode")}</label>
              <input
                id="promo-code"
                type="text"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="WELCOME2026"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="promo-discount-type" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.promos.inputType")}</label>
                <select
                  id="promo-discount-type"
                  value={discountType}
                  onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="percent">{t("admin.promos.typePercent")}</option>
                  <option value="fixed">{t("admin.promos.typeFixed")}</option>
                </select>
              </div>

              <div>
                <label htmlFor="promo-discount-val" className="text-xs font-medium text-slate-400 block mb-1">
                  {discountType === "percent" ? t("admin.promos.inputValuePercent") : t("admin.promos.inputValueFixed")}
                </label>
                <input
                  id="promo-discount-val"
                  type="number"
                  required
                  min={1}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="promo-max-uses" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.promos.inputMaxUses")}</label>
                <input
                  id="promo-max-uses"
                  type="number"
                  required
                  min={1}
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label htmlFor="promo-expires-at" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.promos.inputExpiresAt")}</label>
                <input
                  id="promo-expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-2 bg-slate-800 text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-700"
              >
                {t("admin.plans.cancel")}
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-indigo-600/20"
              >
                {submitting ? t("admin.announcements.submitting") : t("admin.promos.submit")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
