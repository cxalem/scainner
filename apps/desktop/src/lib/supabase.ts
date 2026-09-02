import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://pqaqwbsahjaoadxyccfg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_JL4EUKkKpvoGNpdQx3qk-A_PuoxLKG8";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
