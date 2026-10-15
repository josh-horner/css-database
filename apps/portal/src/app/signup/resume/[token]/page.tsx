"use client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { errorText } from "@css/ui/kit";
import { useTRPC } from "@css/ui/trpc";
import { Shell } from "../../../../components/shell";

/** Resume link from the reminder email or the owner's outreach: restores the draft, then continues. */
export default function Resume({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const trpc = useTRPC();
  const router = useRouter();
  const resume = useMutation(trpc.portal.signup.resume.mutationOptions({ onSuccess: (r) => router.replace(r.lifecycle === "draft" ? "/signup" : "/account") }));
  useEffect(() => {
    resume.mutate({ token });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  return <Shell>{resume.error ? <p className="text-slate-600">{errorText(resume.error)}</p> : <p className="text-slate-500">Picking up where you left off…</p>}</Shell>;
}
