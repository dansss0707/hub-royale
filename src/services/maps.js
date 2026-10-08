import { supabase } from './supabase.js';

export async function saveMapToServer(creatorId, creatorName, title, mapData) {
  const safeTitle = (title && title.trim()) ? title.trim() : 'Untitled Sector';
  const safeCreator = (creatorName && creatorName.trim()) ? creatorName.trim() : 'Architect';
  const safeData = mapData && typeof mapData === 'object' ? mapData : { walls: [], spawns: [], crates: [] };

  const { data, error } = await supabase
    .from('custom_maps')
    .insert([
      {
        creator_id: creatorId,
        creator_name: safeCreator,
        name: safeTitle,    // <--- satisfies the 'name' NOT NULL constraint
        title: safeTitle,   // <--- satisfies the 'title' column
        data: safeData,
        is_verified: false
      }
    ])
    .select()
    .single();

  if (error) {
    console.error('Failed to save map to custom_maps:', error);
    throw error;
  }
  return data;
}

export async function getAllMaps() {
  const { data, error } = await supabase
    .from('custom_maps')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching custom maps:', error);
    throw error;
  }
  
  // Normalize title if the database row has 'name' instead of 'title'
  return (data || []).map(m => ({
    ...m,
    title: m.title || m.name || 'Untitled Sector'
  }));
}

export async function getMapById(mapId) {
  const { data, error } = await supabase
    .from('custom_maps')
    .select('*')
    .eq('id', mapId)
    .single();

  if (error) {
    console.error(`Error fetching map ID ${mapId}:`, error);
    throw error;
  }
  
  return {
    ...data,
    title: data.title || data.name || 'Untitled Sector'
  };
}

export async function toggleMapVerification(mapId, newStatus) {
  const { data, error } = await supabase
    .from('custom_maps')
    .update({ is_verified: Boolean(newStatus) })
    .eq('id', mapId)
    .select()
    .single();

  if (error) {
    console.error(`Error toggling verification for map ID ${mapId}:`, error);
    throw error;
  }
  return data;
}