// Who is signed in, app-wide. `undefined` while the stored session is still
// being read (so the login gate doesn't flash for a returning user), then
// the email or null.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export function useSession(): string | null | undefined {
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);
  return email;
}

export function signOut() {
  return supabase.auth.signOut();
}
