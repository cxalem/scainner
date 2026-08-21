// The Supabase client for the hosted `scainner` project — same project and
// same credential model as the desktop app (apps/desktop/src/lib/supabase.ts):
//
// These two values are PUBLIC BY DESIGN — same as a web app's client
// bundle, where anyone can read them in DevTools. Security does not come
// from hiding them: it comes from the database's row-level security
// policies, which evaluate the signed-in user's JWT on every single row
// (supabase/migrations/20260821000000_schema_v2.sql). With no login, these
// credentials can read and write exactly nothing. The keys that WOULD be
// dangerous (service_role, the DB password) never ship in this app.
//
// Mobile is a read-only companion in v1: it only ever SELECTs the rows RLS
// grants this user; the desktop app is what writes/syncs data up.
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pqaqwbsahjaoadxyccfg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JL4EUKkKpvoGNpdQx3qk-A_PuoxLKG8";

// Session persists in AsyncStorage and auto-refreshes — signing in once on
// this phone survives app restarts, mirroring the desktop's localStorage
// persistence.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// Token refresh only runs while the app is foregrounded (Supabase's
// recommended React Native pattern) — a backgrounded app can't rely on
// timers, so refresh restarts on every return to the foreground.
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
