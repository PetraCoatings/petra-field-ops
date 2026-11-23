import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import type { EmployeeRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";
import { makeSignUpLink, resendInvite, resetTwoStep, sendInvite, updateEmployee } from "../actions";
import { SignUpLink } from "../sign-up-link";
import { PayRateForm } from "../pay-rate-form";
import { addPayRate, deletePayRate } from "@/lib/actions/pay-rates";
import { localDate } from "@/domain/time/zoned";
import { serverNow } from "@/lib/time/my-time";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmployeeForm } from "../employee-form";
import { InviteButton } from "../invite-button";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("employees");
  return { title: t("editTitle") };
}

export default async function EditEmployeePage({ params, searchParams }: PageProps<"/manage/employees/[id]">) {
  const me = await requireRole("office_admin");
  const { id } = await params;
  const { created, invite } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("employees").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const employee = data as EmployeeRow;
  const t = await getTranslations();
  const format = await getFormatter();
  const account = employee.user_id ? await accountStatus(employee.user_id) : null;
  const { data: rateRows } = await supabase.from("pay_rates").select("id, category, hourly_rate, effective_from, note").eq("employee_id", employee.id).order("category").order("effective_from", { ascending: false });
  const rates = (rateRows ?? []) as { id: string; category: string; hourly_rate: string; effective_from: string; note: string | null }[];
  const { data: tzRow } = await supabase.from("app_settings").select("company_timezone").single();
  const today = localDate(serverNow(), (tzRow?.company_timezone as string) || "America/Chicago");
  const currentIds = new Set(
    ["job", "drive", "ride"].map((c) => rates.find((r) => r.category === c && r.effective_from <= today)?.id).filter((x): x is string => Boolean(x)),
  );

  return (
    <div className="space-y-4">
      <PageHeader title={employee.display_name} backHref="/manage/employees" backLabel={t("employees.title")} />
      {created && <Alert tone="success">{t("employees.created")}</Alert>}
      {invite === "sent" && <Alert tone="success">{t("employees.inviteSent", { email: employee.email })}</Alert>}
      {invite === "failed" && (
        <Alert tone="warning">{t("employees.inviteRetry")}</Alert>
      )}
      <Card title={t("employees.editTitle")}>
        <EmployeeForm action={updateEmployee.bind(null, employee.id)} employee={employee} />
      </Card>
      <Card title={t("payRates.title")}>
        <div className="space-y-4">
          <p className="text-sm text-neutral-700">{t("payRates.adminHelp")}</p>
          {employee.flsa_status === "exempt" && <p className="text-base font-semibold text-neutral-800">{t("payRates.salaried")}</p>}
          {rates.length === 0 ? (
            employee.flsa_status === "exempt" ? null : <p className="text-base text-neutral-700">{t("payRates.none")}</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-neutral-600">
                  <th className="py-2 pr-2 font-semibold">{t("payRates.category")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("payRates.rate")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("payRates.effectiveFrom")}</th>
                  <th className="py-2 pr-2 font-semibold">{t("payRates.note")}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => {
                  const current = currentIds.has(r.id);
                  return (
                    <tr key={r.id} className={`border-b border-neutral-100 ${current ? "font-semibold" : "text-neutral-600"}`}>
                      <td className="py-2 pr-2">{t(`timeClock.categories.${r.category as "job"}`)}</td>
                      <td className="py-2 pr-2 tabular-nums">{format.number(Number(r.hourly_rate), { style: "currency", currency: "USD" })}</td>
                      <td className="py-2 pr-2">
                        {format.dateTime(new Date(`${r.effective_from}T12:00:00Z`), { dateStyle: "medium", timeZone: "UTC" })}
                        {current && <span className="ml-1 text-green-800">({t("payRates.inEffect")})</span>}
                        {r.effective_from > today && <span className="ml-1 text-brand-700">({t("payRates.upcomingLabel")})</span>}
                      </td>
                      <td className="py-2 pr-2">{r.note}</td>
                      <td className="py-2 text-right">
                        <form action={deletePayRate}>
                          <input type="hidden" name="id" value={r.id} />
                          <input type="hidden" name="employeeId" value={employee.id} />
                          <button type="submit" className="text-sm font-semibold text-red-800 underline" aria-label={t("payRates.removeLabel", { category: t(`timeClock.categories.${r.category as "job"}`), date: r.effective_from })}>
                            {t("common.remove")}
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <PayRateForm action={addPayRate.bind(null, employee.id)} today={today} />
        </div>
      </Card>
      <Card title={t("employees.account")}>
        {employee.user_id && account?.lastSignInAt ? (
          <div className="space-y-3">
            <p className="text-base">{t("employees.accountLinked")}</p>
            <p className="text-sm text-neutral-700">{t("employees.signInLinkHelp")}</p>
            <SignUpLink action={makeSignUpLink.bind(null, employee.id)} name={employee.first_name} />
            <div className="space-y-2 border-t border-neutral-200 pt-3">
              <p className="text-base">
                {account.hasTwoStep ? t("employees.twoStepOn") : employee.role === "office_admin" ? t("employees.twoStepAdminPending") : t("employees.twoStepOff")}
              </p>
              {account.hasTwoStep && employee.id !== me.employeeId && (
                <>
                  <p className="text-sm text-neutral-700">{t("employees.twoStepResetHelp")}</p>
                  <InviteButton action={resetTwoStep.bind(null, employee.id)} label={t("employees.twoStepResetButton")} />
                </>
              )}
            </div>
          </div>
        ) : employee.user_id ? (
          <div className="space-y-3">
            <p className="text-base text-neutral-700">
              {account?.invitedAt
                ? t("employees.invitedNotSignedIn", { when: format.dateTime(new Date(account.invitedAt), { dateStyle: "medium", timeStyle: "short" }) })
                : t("employees.notSignedIn")}
            </p>
            <InviteButton action={resendInvite.bind(null, employee.id)} label={t("employees.resendEmail")} />
            <SignUpLink action={makeSignUpLink.bind(null, employee.id)} name={employee.first_name} />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-base text-neutral-700">{t("employees.accountNotLinked")}</p>
            <InviteButton action={sendInvite.bind(null, employee.id)} />
            <SignUpLink action={makeSignUpLink.bind(null, employee.id)} name={employee.first_name} />
          </div>
        )}
      </Card>
    </div>
  );
}

/** Has this person ever signed in? (Read with the server-only secret key; office admins only reach this page.) */
async function accountStatus(userId: string): Promise<{ invitedAt: string | null; lastSignInAt: string | null; hasTwoStep: boolean } | null> {
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const { data } = await createAdminClient().auth.admin.getUserById(userId);
  return data.user
    ? {
        invitedAt: data.user.invited_at ?? null,
        lastSignInAt: data.user.last_sign_in_at ?? null,
        hasTwoStep: (data.user.factors ?? []).some((f) => f.status === "verified"),
      }
    : null;
}
