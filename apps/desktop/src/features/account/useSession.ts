import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { MOCK_MODE } from "@/lib/tauri";

export function useSession(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(MOCK_MODE ? "demo@sonda.test" : undefined);
  useEffect(() => {
    if (MOCK_MODE) return;
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return email;
}

export function signOut() {
  if (MOCK_MODE) return Promise.resolve({ error: null });
  return supabase.auth.signOut();
}
