import { supabase } from './supabase.js';

// Legacy fallbacks so lobbyView or older references do not throw export errors
export const NAME_COLORS = [];
export const AURA_EFFECTS = [];
export const ROLL_COST = 50;

// Default presets players can select or unlock
export const DEFAULT_SKINS = [
  { id: 'skin_default', name: 'Recruit', url: '', border: '#ffb000' },
  { id: 'skin_soldier', name: 'Combine Guard', url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=150', border: '#00d2ff' },
  { id: 'skin_rebel', name: 'Resistance Rebel', url: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=150', border: '#3cd446' },
  { id: 'skin_gman', name: 'Mysterious Suit', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=150', border: '#b026ff' }
];

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, coins, wins, equipped_skin, is_verified')
    .eq('id', userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('getProfile query error:', error);
    throw error;
  }
  return data;
}

// Equip a skin image URL or data URI
export async function equipSkin(userId, skinUrl) {
  const { data, error } = await supabase
    .from('profiles')
    .update({
      equipped_skin: skinUrl
    })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.warn('Could not update remote database, saving locally:', error);
  }
  return data || { equipped_skin: skinUrl };
}

// --- CS2 CRATE SYSTEM SERVICES ---

export async function getCrateItems(crateId = 'standard_crate') {
  const { data, error } = await supabase
    .from('crate_items')
    .select('*')
    .eq('crate_id', crateId);

  if (error) throw error;
  return data || [];
}

// Weighted random skin roll calculation
export function rollFromCrate(items) {
  if (!items || !items.length) return null;
  const totalWeight = items.reduce((sum, item) => sum + (item.weight || 10), 0);
  let random = Math.random() * totalWeight;

  for (const item of items) {
    if (random < item.weight) {
      return item;
    }
    random -= item.weight;
  }
  return items[0];
}

// Deduct coins for unboxing
export async function deductCoins(userId, amount) {
  const { data: profile, error: fetchErr } = await supabase
    .from('profiles')
    .select('coins')
    .eq('id', userId)
    .single();

  if (fetchErr) throw fetchErr;
  if ((profile.coins ?? 0) < amount) {
    throw new Error('Not enough coins to unlock this crate!');
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ coins: profile.coins - amount })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// --- ADMIN VERIFICATION & ITEM INSERTION SERVICES ---

export async function addCrateItem(crateItem) {
  const { data, error } = await supabase
    .from('crate_items')
    .insert([crateItem])
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function verifyUserByUsername(targetUsername) {
  const cleanName = targetUsername.trim();

  // Call the database function directly (bypasses table RLS locks)
  const { data, error } = await supabase
    .rpc('verify_user_by_username', { target_username: cleanName });

  if (error) {
    console.error('RPC verify error:', error);
    throw new Error(error.message || 'Failed to verify user.');
  }

  return data;
}