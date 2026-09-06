import { ShieldCheck, Plus, Trash2, Key, AlertOctagon } from "lucide-react";
import { useState, useEffect, useCallback } from "react";

import { adminFetch, formatDate } from "./admin-client";

import { useT } from "@/shared/lib/i18n";

export interface IpRuleItem {
  id: string;
  ipAddress: string;
  reason: string;
  action: string;
  createdAt: string;
}
interface AdminSecurityProps {
  userId: string;
}

export function AdminSecurity({ userId }: AdminSecurityProps) {
  const [ipRules, setIpRules] = useState<IpRuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  // New IP form
  const [showModal, setShowModal] = useState(false);
  const [ipAddress, setIpAddress] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await adminFetch<{ items: IpRuleItem[] }>("/security/ip-rules", userId);
      setIpRules(res.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.security.loadError"));
    } finally {
      setLoading(false);
    }
  }, [userId, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleAddIp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ipAddress.trim()) return;
    try {
      setSubmitting(true);
      await adminFetch("/security/ip-rules", userId, {
        method: "POST",
        body: JSON.stringify({ ipAddress, reason }),
      });
      setShowModal(false);
      setIpAddress("");
      setReason("");
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteIp = async (id: string) => {
    if (!confirm(t("admin.security.confirmDeleteIp"))) return;
    try {
      await adminFetch(`/security/ip-rules/${id}`, userId, { method: "DELETE" });
      void loadData();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm(t("admin.security.confirmRevokeSessions"))) return;
    try {
      setRevoking(true);
      const res = await adminFetch<{ message: string }>("/system/revoke-sessions", userId, { method: "POST" });
      alert(res.message);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error");
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 border border-slate-800 p-6 rounded-2xl backdrop-blur-xl">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            {t("admin.security.title")}
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            {t("admin.security.desc")}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleRevokeAllSessions()}
            disabled={revoking}
            className="px-4 py-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-xl text-sm font-medium transition-all flex items-center gap-2"
          >
            <Key className="w-4 h-4 text-rose-400" />
            {revoking ? t("admin.security.revoking") : t("admin.security.revokeSessions")}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-600/20"
          >
            <Plus className="w-4 h-4" />
            {t("admin.security.addIp")}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-400">{t("admin.security.loading")}</div>
      ) : ipRules.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/30 border border-slate-800 rounded-2xl text-slate-400">
          {t("admin.security.empty")}
        </div>
      ) : (
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-xl">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-slate-400 font-medium uppercase text-xs border-b border-slate-800">
              <tr>
                <th className="p-4">{t("admin.security.thIp")}</th>
                <th className="p-4">{t("admin.security.thReason")}</th>
                <th className="p-4">{t("admin.security.thAction")}</th>
                <th className="p-4">{t("admin.security.thDate")}</th>
                <th className="p-4 text-right">{t("admin.plans.tableHeaderAction")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {ipRules.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="p-4 font-mono text-white font-semibold flex items-center gap-2">
                    <AlertOctagon className="w-4 h-4 text-rose-400" />
                    {rule.ipAddress}
                  </td>
                  <td className="p-4 text-slate-300">{rule.reason || "—"}</td>
                  <td className="p-4">
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase">
                      {rule.action}
                    </span>
                  </td>
                  <td className="p-4 text-slate-400 text-xs">{formatDate(rule.createdAt)}</td>
                  <td className="p-4 text-right">
                    <button
                      onClick={() => void handleDeleteIp(rule.id)}
                      className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                      title="Unblock"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
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
            onSubmit={(e) => void handleAddIp(e)}
            className="bg-slate-900 border border-slate-800 p-6 rounded-2xl w-full max-w-md space-y-4 shadow-2xl"
          >
            <h3 className="text-lg font-bold text-white">{t("admin.security.modalTitle")}</h3>
            <div>
              <label htmlFor="security-ip" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.security.thIp")}</label>
              <input
                id="security-ip"
                type="text"
                required
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="192.168.1.100"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
            <div>
              <label htmlFor="security-reason" className="text-xs font-medium text-slate-400 block mb-1">{t("admin.security.thReason")}</label>
              <input
                id="security-reason"
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("admin.security.reasonPlaceholder")}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
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
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-rose-600/20"
              >
                {submitting ? t("admin.announcements.submitting") : t("admin.security.submitAddIp")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
