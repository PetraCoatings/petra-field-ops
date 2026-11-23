"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { KeyRound, LogOut, Smartphone } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { TextField } from "@/components/ui/field";
import { signOut } from "@/lib/actions/auth";
import { createClient } from "@/lib/supabase/client";

type Setup = { factorId: string; qr: string; secret: string; uri: string };

/**
 * enroll: make a new authenticator entry (QR code, or a link that opens the
 * phone's authenticator), then confirm it with the first code.
 * verify: type the current code.
 * Either way a correct code upgrades this sign-in to two-step ("aal2").
 */
export function TwoStepForm({ mode, factorId, required, next }: { mode: "enroll" | "verify"; factorId: string | null; required: boolean; next: string }) {
  const t = useTranslations("twoStep");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const begin = () =>
    start(async () => {
      setError(null);
      const supabase = createClient();
      // Clear any half-finished setup from an earlier visit.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const f of existing?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: "totp", issuer: "Petra Field Ops", friendlyName: `Petra Field Ops ${Date.now()}` });
      if (e || !data) return setError(t("setupFailed"));
      setSetup({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = mode === "verify" ? factorId : setup?.factorId;
    const clean = code.replace(/\D/g, "");
    if (!id) return;
    if (clean.length !== 6) return setError(t("sixDigits"));
    start(async () => {
      setError(null);
      const { error: err } = await createClient().auth.mfa.challengeAndVerify({ factorId: id, code: clean });
      if (err) {
        setCode("");
        return setError(err.code === "over_request_rate_limit" ? t("tooManyTries") : err.code === "mfa_verification_failed" || err.code === "mfa_verification_rejected" ? t("wrongCode") : `${t("wrongCode")} (${err.code ?? err.status ?? "?"})`);
      }
      window.location.assign(next);
    });
  };

  const codeForm = (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <TextField
        label={t("codeLabel")}
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        help={t("codeHelp")}
        error={error ?? undefined}
        autoFocus
      />
      <button type="submit" disabled={busy} className={`${buttonClasses("primary", "lg")} w-full`}>
        <KeyRound aria-hidden className="size-5" />
        {busy ? t("checking") : t("confirm")}
      </button>
    </form>
  );

  return (
    <div className="space-y-5">
      {mode === "verify" ? (
        <>
          <p className="text-base text-neutral-700">{t("verifyIntro")}</p>
          {codeForm}
        </>
      ) : !setup ? (
        <>
          <p className="text-base text-neutral-700">{required ? t("requiredIntro") : t("optionalIntro")}</p>
          <ol className="list-decimal space-y-1 pl-5 text-base text-neutral-700">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          {error && (
            <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-base font-medium text-red-900">
              {error}
            </p>
          )}
          <button type="button" onClick={begin} disabled={busy} className={`${buttonClasses("primary", "lg")} w-full`}>
            <Smartphone aria-hidden className="size-5" />
            {busy ? t("working") : t("start")}
          </button>
        </>
      ) : (
        <>
          <p className="text-base text-neutral-700">{t("scan")}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL from Supabase */}
          <img src={setup.qr} alt={t("qrAlt")} width={200} height={200} className="mx-auto rounded-xl border border-neutral-200 bg-white p-2" />
          <a href={setup.uri} className={`${buttonClasses("secondary", "md")} w-full`}>
            {t("openOnPhone")}
          </a>
          <details className="rounded-xl bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
            <summary className="cursor-pointer font-semibold">{t("typeKey")}</summary>
            <p className="mt-2 break-all font-mono text-base" aria-label={t("keyLabel")} data-testid="totp-secret">
              {setup.secret}
            </p>
          </details>
          <p className="text-base text-neutral-700">{t("thenCode")}</p>
          {codeForm}
        </>
      )}
      <form action={signOut}>
        <button type="submit" className={`${buttonClasses("ghost", "md")} w-full`}>
          <LogOut aria-hidden className="size-5" />
          {t("signOut")}
        </button>
      </form>
    </div>
  );
}
