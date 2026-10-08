import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

// Assign this specific browser tab a permanent random ID
if (!window.name || !window.name.startsWith('br_player_tab_')) {
  window.name = 'br_player_tab_' + Math.random().toString(36).slice(2, 9);
}

export const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Unique key per tab so they never overwrite each other
    storageKey: `sb_session_${window.name}`,
    storage: window.localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});