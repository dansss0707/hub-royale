import { supabase } from './supabase.js';

// Format username into an internal mock email for Supabase Auth
function usernameToEmail(username) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  return `${clean}@battleroyale.local`;
}

// Check if call-sign is already registered
export async function isUsernameTaken(username) {
  const clean = username.trim();
  if (!clean) return false;

  const { data, error } = await supabase
    .from('profiles')
    .select('username')
    .ilike('username', clean)
    .limit(1);

  if (error) {
    console.error('Username check error from Supabase:', error);
    // Treat query failures safely to prevent duplicate collisions
    return true;
  }

  return Array.isArray(data) && data.length > 0;
}

// Register new player account & initialize profile
export async function registerUser(username, password) {
  const cleanUsername = username.trim();
  const email = usernameToEmail(cleanUsername);

  // 1. Guard against duplicate call-sign
  const taken = await isUsernameTaken(cleanUsername);
  if (taken) {
    throw new Error('Call-sign is already taken! Pick another one.');
  }

  // 2. Create auth user with username in metadata
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: cleanUsername }
    }
  });

  if (authError) throw authError;

  // 3. Upsert initial player profile with default inventory & coins
  const user = authData.user;
  if (user) {
    const { error: profileError } = await supabase.from('profiles').upsert([
      {
        id: user.id,
        username: cleanUsername,
        coins: 250,
        wins: 0,
        inventory: ['skin_default'],
        equipped_skin: 'skin_default'
      }
    ]);
    if (profileError) throw profileError;
  }

  return authData;
}

// Log in existing player by username & password
export async function loginUser(username, password) {
  const cleanUsername = username.trim();
  const email = usernameToEmail(cleanUsername);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('Incorrect call-sign or password.');
    }
    throw error;
  }

  return data;
}

// Log out current player
export async function logoutUser() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// Fetch player profile (using maybeSingle to prevent 406/PGRST116 race errors)
export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}