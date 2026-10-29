"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  AuthError,
  deleteSession,
  loginWithEmail,
  requestPhoneOtp,
  signUpWithEmail,
  verifyPhoneOtp,
} from "@tapserve/db";
import { isLocale, type Locale } from "@tapserve/i18n";
import { db } from "@/server/db";
import { sessionToken, startSession } from "@/server/session";
import { smsProvider } from "@/server/sms";
import { cookies } from "next/headers";

function localeOf(form: FormData): Locale {
  const value = form.get("locale");
  return typeof value === "string" && isLocale(value) ? value : "am";
}

function errorCode(err: unknown): string {
  if (err instanceof AuthError) return err.code;
  if (err instanceof z.ZodError) return "invalid_input";
  console.error(err);
  return "unknown";
}

const emailLogin = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(200) });
const emailSignup = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().max(200),
  fullName: z.string().trim().min(1).max(120),
});
const phoneForm = z.object({ phone: z.string().trim().min(9).max(20) });
const codeForm = z.object({ phone: z.string().trim().min(9).max(20), code: z.string().trim().regex(/^\d{6}$/) });

export async function loginWithEmailAction(form: FormData) {
  const locale = localeOf(form);
  let error: string | null = null;
  try {
    const input = emailLogin.parse(Object.fromEntries(form));
    const user = await loginWithEmail(db(), input.email, input.password);
    await startSession(user.id);
  } catch (err) {
    error = errorCode(err);
  }
  redirect(error ? `/${locale}/login?method=email&error=${error}` : `/${locale}/dashboard`);
}

export async function signUpWithEmailAction(form: FormData) {
  const locale = localeOf(form);
  let error: string | null = null;
  try {
    const input = emailSignup.parse(Object.fromEntries(form));
    const user = await signUpWithEmail(db(), { ...input, locale });
    await startSession(user.id);
  } catch (err) {
    error = errorCode(err);
  }
  redirect(error ? `/${locale}/signup?error=${error}` : `/${locale}/onboarding`);
}

export async function requestOtpAction(form: FormData) {
  const locale = localeOf(form);
  let phone = "";
  let error: string | null = null;
  try {
    phone = await requestPhoneOtp(db(), smsProvider(), phoneForm.parse(Object.fromEntries(form)).phone);
  } catch (err) {
    error = errorCode(err);
  }
  redirect(error ? `/${locale}/login?error=${error}` : `/${locale}/verify?phone=${encodeURIComponent(phone)}`);
}

export async function verifyOtpAction(form: FormData) {
  const locale = localeOf(form);
  const phone = String(form.get("phone") ?? "");
  let error: string | null = null;
  try {
    const input = codeForm.parse(Object.fromEntries(form));
    const user = await verifyPhoneOtp(db(), input.phone, input.code);
    await startSession(user.id);
  } catch (err) {
    error = errorCode(err);
  }
  redirect(error ? `/${locale}/verify?phone=${encodeURIComponent(phone)}&error=${error}` : `/${locale}/dashboard`);
}

export async function logoutAction(form: FormData) {
  const token = await sessionToken();
  if (token) await deleteSession(db(), token);
  (await cookies()).delete("tapserve_session");
  redirect(`/${localeOf(form)}/login`);
}
