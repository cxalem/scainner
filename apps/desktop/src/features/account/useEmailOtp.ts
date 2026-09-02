import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { requestSync } from "@/lib/sync";

export function useEmailOtp() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setUserEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const sendCode = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setAuthError(error.message);
    else setStep("code");
  };

  const verify = async () => {
    setBusy(true);
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) setAuthError(error.message);
    else {
      setStep("email");
      setCode("");
      requestSync();
    }
  };

  const signOut = () => void supabase.auth.signOut();

  return { email, setEmail, code, setCode, step, setStep, busy, authError, userEmail, sendCode, verify, signOut };
}
