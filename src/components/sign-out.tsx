"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/logout", { method: "POST" });
          router.replace("/login");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
      className="btn btn-ghost !py-1 text-[12px]"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
