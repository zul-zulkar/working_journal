import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import LoginForm from "@/components/LoginForm";
import { SESSION_COOKIE, isAuthConfigured, safeNextPath, verifySessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Masuk — Jurnal Kegiatan",
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { next?: string };
}) {
  const next = safeNextPath(searchParams.next);
  // Already signed in (e.g. reopened the bookmark) — skip the form.
  if ((await verifySessionToken(cookies().get(SESSION_COOKIE)?.value)) !== null) redirect(next);
  return <LoginForm next={next} configured={isAuthConfigured()} />;
}
