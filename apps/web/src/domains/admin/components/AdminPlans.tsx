import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  adminFetch,
  centsToWon,
  formatNum,
  formatWon,
  wonToCents,
  type AdminApiError,
  type Plan,
} from "./admin-client";
import { AdminNotice, AdminSpinner, Field, adminInputClass } from "./admin-ui";
import { adminButtonClass } from "./admin-ui-utils";

import { useT } from "@/shared/lib/i18n";

const planFormSchema = z.object({
  code: z.string().trim().min(1, "Code & name are required."),
  name: z.string().trim().min(1, "Code & name are required."),
  description: z.string(),
  intervalDays: z.string(),
  priceWon: z.string(),
  perks: z.string(),
  isActive: z.boolean(),
});

type PlanFormValues = z.infer<typeof planFormSchema>;

const emptyDraft: PlanFormValues = {
  code: "",
  name: "",
  description: "",
  intervalDays: "30",
  priceWon: "",
  perks: "",
  isActive: true,
};

function toDraft(plan: Plan): PlanFormValues {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description ?? "",
    intervalDays: String(plan.intervalDays ?? 30),
    priceWon: String(centsToWon(plan.priceCents)),
    perks: (plan.perks ?? []).join(", "),
    isActive: plan.isActive,
  };
}
export function AdminPlans({ uid }: { uid: string }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const t = useT();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planFormSchema),
    defaultValues: emptyDraft,
  });

  const load = useCallback(() => {
    setError(null);
    adminFetch<{ items: Plan[] }>("/plans", uid)
      .then((d) => setPlans(d.items))
      .catch((e: AdminApiError) => setError(e.message));
  }, [uid]);

  useEffect(() => {
    setPlans(null);
    load();
  }, [load]);

  const openNew = () => {
    setFormError(null);
    reset(emptyDraft);
    setEditing({});
  };

  const openEdit = (plan: Plan) => {
    setFormError(null);
    reset(toDraft(plan));
    setEditing({ id: plan.id });
  };

  const close = () => {
    setEditing(null);
    setFormError(null);
  };

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await adminFetch("/plans", uid, {
        method: "POST",
        body: JSON.stringify({
          id: editing?.id,
          code: values.code.trim(),
          name: values.name.trim(),
          description: values.description.trim(),
          intervalDays: Number(values.intervalDays) || 30,
          currency: "KRW",
          priceCents: wonToCents(Number(values.priceWon)),
          perks: values.perks.split(",").map((p) => p.trim()).filter(Boolean),
          isActive: values.isActive,
        }),
      });
      setEditing(null);
      load();
    } catch (e) {
      setFormError((e as AdminApiError).message);
    }
  });

  if (error) return <AdminNotice title={t("admin.plans.loadError")} body={error} />;
  if (!plans) return <AdminSpinner />;

  const validationError = errors.code?.message ?? errors.name?.message ?? null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-fg-3">
          {t("admin.plans.count").replace("{count}", formatNum(plans.length))}
        </p>
        {!editing && (
          <button className={adminButtonClass("accent")} onClick={openNew}>
            <Plus size={15} /> {t("admin.plans.new")}
          </button>
        )}
      </div>

      {editing && (
        <form
          className="grid grid-cols-1 gap-3 rounded-2xl border border-line-strong bg-panel p-5 sm:grid-cols-2"
          onSubmit={submit}
        >
          <div className="flex items-center justify-between sm:col-span-2">
            <h3 className="text-sm font-semibold text-fg">{editing.id ? t("admin.plans.edit") : t("admin.plans.new")}</h3>
            <button type="button" aria-label="Close" className="text-fg-3 hover:text-fg" onClick={close}>
              <X size={16} />
            </button>
          </div>
          <Field label={t("admin.plans.code")}>
            <input className={adminInputClass} {...register("code")} />
          </Field>
          <Field label={t("admin.plans.name")}>
            <input className={adminInputClass} {...register("name")} />
          </Field>
          <Field label={t("admin.plans.description")} full>
            <input className={adminInputClass} {...register("description")} />
          </Field>
          <Field label={t("admin.plans.interval")}>
            <input type="number" min={1} className={adminInputClass} {...register("intervalDays")} />
          </Field>
          <Field label={t("admin.plans.price")}>
            <input type="number" min={0} className={adminInputClass} {...register("priceWon")} />
          </Field>
          <Field label={t("admin.plans.perks")} full>
            <input className={adminInputClass} {...register("perks")} placeholder={t("admin.plans.perksPlaceholder")} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" {...register("isActive")} />
            {t("admin.plans.active")}
          </label>
          <div className="flex items-center justify-end gap-2 sm:col-span-2">
            {(validationError || formError) && (
              <span className="mr-auto text-xs text-bad">{validationError ?? formError}</span>
            )}
            <button type="button" className={adminButtonClass("ghost")} onClick={close}>
              {t("admin.plans.cancel")}
            </button>
            <button type="submit" className={adminButtonClass("accent")} disabled={isSubmitting}>
              {isSubmitting ? t("admin.plans.saving") : t("admin.plans.save")}
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-2xl border border-line">
        <table className="w-full text-sm">
          <thead className="bg-raised/50 text-left text-xs text-fg-3">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t("admin.plans.tableHeaderPlan")}</th>
              <th className="px-4 py-2.5 font-medium">{t("admin.plans.tableHeaderPrice")}</th>
              <th className="px-4 py-2.5 font-medium">{t("admin.plans.tableHeaderPerks")}</th>
              <th className="px-4 py-2.5 font-medium">{t("admin.plans.tableHeaderStatus")}</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {plans.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-fg-3">
                  {t("admin.plans.empty")}
                </td>
              </tr>
            )}
            {plans.map((plan) => (
              <tr key={plan.id} className="border-t border-line">
                <td className="px-4 py-3">
                  <div className="font-medium text-fg">{plan.name}</div>
                  <div className="text-xs text-fg-3">{plan.code}</div>
                </td>
                <td className="px-4 py-3 text-fg-2">
                  <span className="numeral">{formatWon(plan.priceCents)}</span>
                  <span className="text-fg-3"> / {formatNum(plan.intervalDays)}</span>
                </td>
                <td className="px-4 py-3 text-fg-3">{(plan.perks ?? []).length}</td>
                <td className="px-4 py-3">
                  <span className={plan.isActive ? "text-good" : "text-fg-3"}>
                    {plan.isActive ? t("admin.plans.statusActive") : t("admin.plans.statusInactive")}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button className={adminButtonClass("ghost")} onClick={() => openEdit(plan)}>
                    <Pencil size={13} /> {t("admin.plans.tableHeaderAction")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
