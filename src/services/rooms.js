import { supabase } from './supabase.js';

// Generate a random 6-character room code (e.g. BR-8A2K)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'BR-';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function createRoom(hostUserId, title, maxPlayers = 8) {
  const code = generateRoomCode();

  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .insert([
      {
        host_id: hostUserId,
        title: title || 'Battle Royale Room',
        code: code,
        max_players: maxPlayers,
        status: 'waiting'
      }
    ])
    .select()
    .single();

  if (roomError) throw roomError;

  const { error: memberError } = await supabase
    .from('room_members')
    .insert([
      {
        room_id: room.id,
        user_id: hostUserId,
        status: 'accepted'
      }
    ]);

  if (memberError) throw memberError;

  return room;
}

export async function getOpenRooms() {
  const { data, error } = await supabase
    .from('game_rooms')
    .select(`
      *,
      profiles:host_id (username, equipped_skin),
      room_members (
        id,
        user_id,
        status,
        profiles (username, equipped_skin)
      )
    `)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function getRoomMembers(roomId) {
  const { data, error } = await supabase
    .from('room_members')
    .select(`
      id,
      room_id,
      user_id,
      status,
      profiles:user_id (
        id,
        username,
        equipped_skin
      )
    `)
    .eq('room_id', roomId);

  if (error) {
    console.error('Error fetching room members:', error);
    throw error;
  }
  return data || [];
}

export async function requestJoinByCode(code, userId) {
  const cleanCode = code.trim().toUpperCase();

  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('id, host_id, status, max_players')
    .eq('code', cleanCode)
    .single();

  if (roomError || !room) {
    throw new Error('Room not found. Check the code and try again.');
  }

  if (room.status !== 'waiting') {
    throw new Error('This match has already started or concluded.');
  }

  const { data: existing, error: existError } = await supabase
    .from('room_members')
    .select('id, status')
    .eq('room_id', room.id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existError) throw existError;

  if (existing) {
    return { roomId: room.id, status: existing.status };
  }

  const { data: currentMembers } = await supabase
    .from('room_members')
    .select('id')
    .eq('room_id', room.id)
    .eq('status', 'accepted');

  if (currentMembers && currentMembers.length >= room.max_players) {
    throw new Error('Room is full.');
  }

  const initialStatus = room.host_id === userId ? 'accepted' : 'accepted';

  const { error: insertError } = await supabase
    .from('room_members')
    .insert([
      {
        room_id: room.id,
        user_id: userId,
        status: initialStatus
      }
    ]);

  if (insertError) throw insertError;

  return { roomId: room.id, status: initialStatus };
}

export async function updateMemberStatus(memberId, status) {
  const { data, error } = await supabase
    .from('room_members')
    .update({ status })
    .eq('id', memberId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function setRoomStatus(roomId, status) {
  const { data, error } = await supabase
    .from('game_rooms')
    .update({ status })
    .eq('id', roomId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function leaveOrDisbandRoom(roomId, userId, isHost) {
  if (isHost) {
    await supabase
      .from('game_rooms')
      .update({ status: 'finished' })
      .eq('id', roomId);

    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId);
  } else {
    await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', userId);
  }
}

export async function getActiveRoomForUser(userId) {
  // Removed .order('created_at', { ascending: false }) to avoid 400 error
  const { data: memberRecord, error: memError } = await supabase
    .from('room_members')
    .select('room_id, status')
    .eq('user_id', userId)
    .eq('status', 'accepted')
    .limit(1)
    .maybeSingle();

  if (memError || !memberRecord) return null;

  const { data: room, error: roomError } = await supabase
    .from('game_rooms')
    .select('*')
    .eq('id', memberRecord.room_id)
    .neq('status', 'finished')
    .maybeSingle();

  if (roomError || !room) return null;

  return room;
}

export function subscribeToRoom(roomId, onMembersChange, onRoomChange) {
  const channel = supabase
    .channel(`room_events:${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'room_members',
        filter: `room_id=eq.${roomId}`
      },
      () => {
        if (onMembersChange) onMembersChange();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'game_rooms',
        filter: `id=eq.${roomId}`
      },
      (payload) => {
        if (onRoomChange) onRoomChange(payload);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}