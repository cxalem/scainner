// The Supabase client for the hosted `scainner` project.
//
// These two values are PUBLIC BY DESIGN — same as a web app's client
// bundle, where anyone can read them in DevTools. Security does not come
// from hiding them: it comes from the database's row-level security
// policies, which evaluate the signed-in user's JWT on every single row
// (supabase/migrations/20260821000000_schema_v2.sql). With no login, these
// credentials can read and write exactly nothing. The keys that WOULD be
// dangerous (service_role, the DB password) never ship in this app and
// never appear in this repo — see docs/workflows/data-core/plan.md's
// credential model.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pqaqwbsahjaoadxyccfg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JL4EUKkKpvoGNpdQx3qk-A_PuoxLKG8";

// Session persists in the webview's localStorage and auto-refreshes —
// signing in once on this machine survives app restarts.
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
