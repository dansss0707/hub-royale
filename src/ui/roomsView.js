import { AppState, navigateTo } from '../main.js';
import { 
  createRoom, 
  getOpenRooms, 
  requestJoinByCode, 
  getRoomMembers, 
  updateMemberStatus, 
  setRoomStatus, 
  leaveOrDisbandRoom,
  subscribeToRoom 
} from '../services/rooms.js';
import { getAllMaps, toggleMapVerification } from '../services/maps.js';
import { showToast } from '../utils/helpers.js';
import { supabase } from '../services/supabase.js';

let activeRoomChannelCleanup = null;
let currentRoomData = null;
let pendingRoomChannelCleanup = null;

function renderPartyPod(member, currentUserId, hostId, localSkin) {
  const isSelf = member.user_id === currentUserId;
  const username = member.profiles?.username || 'Player';
  const isLeader = member.user_id === hostId;

  // Resolve skin URL from the profiles relation
  let rawSkin = '';
  if (isSelf) {
    rawSkin = localSkin || AppState.profile?.equipped_skin || localStorage.getItem('br_custom_skin') || '';
  } else {
    rawSkin = member.profiles?.equipped_skin || '';
  }

  const isValidImg = typeof rawSkin === 'string' && (
    rawSkin.startsWith('http://') || 
    rawSkin.startsWith('https://') || 
    rawSkin.startsWith('data:image/')
  );

  return `
    <div class="party-pod ${isSelf ? 'is-local' : ''}">
      ${isLeader ? `<span class="leader-crown-badge" title="Party Leader">👑</span>` : ''}
      <div class="character-sprite">
        ${isValidImg 
          ? `<img src="${rawSkin}" alt="${username}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';" /><span class="avatar-icon" style="display: none; font-size: 2.2rem;">👤</span>` 
          : `<span class="avatar-icon" style="font-size: 2.2rem;">👤</span>`
        }
      </div>
      <div class="pod-disk"></div>
      
      <!-- NAME & STATUS UNDER SKIN -->
      <div class="pod-nameplate">
        <span class="pod-player-name">${username}${isSelf ? ' (You)' : ''}</span>
        <span class="pod-player-status" style="color: ${isLeader ? 'var(--hl2-amber)' : 'var(--terminal-green)'};">
          ${isLeader ? 'LEADER' : 'READY'}
        </span>
      </div>
    </div>
  `;
}

export function mountRoomsView(container, params = {}) {
  if (params.room && (params.isHost || params.initialStatus === 'accepted')) {
    renderRoomLobby(container, params.room, params.isHost, params.initialStatus);
  } else {
    renderRoomsBrowser(container);
  }
}

// 1. Room Browser
export async function renderRoomsBrowser(container) {
  if (activeRoomChannelCleanup) {
    activeRoomChannelCleanup();
    activeRoomChannelCleanup = null;
  }
  currentRoomData = null;
  AppState.currentRoom = null;

  container.innerHTML = `
    <section id="view-rooms" class="view" style="padding: 32px; max-width: 1000px; margin: 0 auto; gap: 24px;">
      <div class="rooms-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <button id="btn-rooms-back" class="btn secondary-btn small" type="button">← Main Menu</button>
        <h2 style="font-family: var(--font-display); letter-spacing: 1px;">Game Lobbies</h2>
        <button id="btn-create-room-modal" class="btn primary-btn small" type="button">+ Create Room</button>
      </div>

      <div class="rooms-grid">
        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 14px;">Open Games</h3>
          <div id="room-list-loading" style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.85rem;">Finding games...</div>
          <div id="room-list" class="room-list"></div>
        </div>

        <div class="room-panel">
          <h3 style="font-family: var(--font-display); margin-bottom: 12px;">Join Private Game</h3>
          <p style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); margin-bottom: 14px;">
            Got a code from a friend? Enter it below to join their party:
          </p>
          <div class="invite-box">
            <input type="text" id="input-room-code" placeholder="e.g. BR-8A2K" maxlength="8" />
            <button id="btn-join-code" class="btn primary-btn small" type="button">Join</button>
          </div>
          <div id="request-pending-notice" style="display: none; margin-top: 16px; padding: 12px; background: rgba(255, 179, 0, 0.1); border: 1px solid var(--tactical-amber); font-family: var(--font-mono); font-size: 0.8rem; color: var(--tactical-amber); border-radius: 4px;">
            ⏳ Request sent! Waiting for host to let you in...
          </div>
        </div>
      </div>
    </section>
  `;

  document.getElementById('btn-rooms-back')?.addEventListener('click', () => {
    if (pendingRoomChannelCleanup) {
      pendingRoomChannelCleanup();
      pendingRoomChannelCleanup = null;
    }
    navigateTo('lobby');
  });

  document.getElementById('btn-create-room-modal')?.addEventListener('click', () => handleCreateRoom(container));
  document.getElementById('btn-join-code')?.addEventListener('click', () => handleJoinByCode(container));

  await loadRoomList(container);
}

async function loadRoomList(container) {
  const listEl = document.getElementById('room-list');
  const loader = document.getElementById('room-list-loading');
  if (!listEl) return;

  try {
    const rooms = await getOpenRooms();
    if (loader) loader.style.display = 'none';
    listEl.innerHTML = '';

    if (!rooms || rooms.length === 0) {
      listEl.innerHTML = `<p style="font-family: var(--font-mono); color: var(--text-muted); font-size: 0.82rem;">No active games right now. Click "+ Create Room" to start one!</p>`;
      return;
    }

    rooms.forEach(room => {
      const acceptedCount = room.room_members?.filter(m => m.status === 'accepted').length || 1;
      const isMyRoom = room.host_id === AppState.user?.id;
      const myMembership = room.room_members?.find(m => m.user_id === AppState.user?.id);

      const card = document.createElement('div');
      card.className = 'room-item';
      card.innerHTML = `
        <div>
          <strong style="font-family: var(--font-display); letter-spacing: 0.5px;">${room.title}</strong>
          <div class="meta" style="font-family: var(--font-mono); font-size: 0.75rem; margin-top: 4px;">
            <span>Code: <b style="color: var(--tactical-amber);">${room.code}</b></span>
            <span>Host: ${room.profiles?.username || 'Player'}</span>
            <span>Players: ${acceptedCount}/${room.max_players}</span>
          </div>
        </div>
        <button class="btn secondary-btn small btn-action-room" data-code="${room.code}" type="button">
          ${isMyRoom ? 'Your Lobby' : (myMembership?.status === 'pending' ? 'Pending...' : 'Join Game')}
        </button>
      `;

      const btn = card.querySelector('.btn-action-room');
      if (myMembership?.status === 'pending') {
        btn.disabled = true;
        btn.style.opacity = '0.6';
      }

      btn.addEventListener('click', () => {
        handleJoinDirect(container, room.code, btn);
      });

      listEl.appendChild(card);
    });
  } catch (err) {
    if (loader) loader.textContent = 'Could not load games.';
    showToast(err.message, 'error');
  }
}

async function handleCreateRoom(container) {
  const defaultTitle = `${AppState.profile?.username || 'Player'}'s Match`;
  const title = prompt('Enter a room name:', defaultTitle) || defaultTitle;

  try {
    const room = await createRoom(AppState.user.id, title, 10);
    showToast(`Room created! Code: ${room.code}`, 'success');
    AppState.currentRoom = room;
    renderRoomLobby(container, room, true, 'accepted');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleJoinByCode(container) {
  const input = document.getElementById('input-room-code');
  const code = input?.value;
  if (!code) {
    showToast('Please type in a room code', 'error');
    return;
  }
  const submitBtn = document.getElementById('btn-join-code');
  handleJoinDirect(container, code, submitBtn);
}

async function handleJoinDirect(container, code, buttonEl) {
  try {
    if (buttonEl) {
      buttonEl.disabled = true;
      buttonEl.textContent = 'Sending...';
    }

    const { roomId, status } = await requestJoinByCode(code, AppState.user.id);
    
    const { data: room, error } = await supabase
      .from('game_rooms')
      .select('*')
      .eq('id', roomId)
      .single();

    if (error || !room) throw new Error('Could not find that room.');

    if (room.host_id === AppState.user.id || status === 'accepted') {
      AppState.currentRoom = room;
      renderRoomLobby(container, room, room.host_id === AppState.user.id, 'accepted');
      return;
    }

    showToast('Join request sent! Waiting for host...', 'info');

    if (buttonEl) {
      buttonEl.textContent = 'Pending...';
    }

    const pendingNotice = document.getElementById('request-pending-notice');
    if (pendingNotice) pendingNotice.style.display = 'block';

    if (pendingRoomChannelCleanup) pendingRoomChannelCleanup();

    pendingRoomChannelCleanup = subscribeToRoom(
      room.id,
      async () => {
        const { data: membership } = await supabase
          .from('room_members')
          .select('status')
          .eq('room_id', room.id)
          .eq('user_id', AppState.user.id)
          .maybeSingle();

        if (membership?.status === 'accepted') {
          showToast('Accepted! Joining lobby...', 'success');
          if (pendingRoomChannelCleanup) {
            pendingRoomChannelCleanup();
            pendingRoomChannelCleanup = null;
          }
          AppState.currentRoom = room;
          renderRoomLobby(container, room, false, 'accepted');
        } else if (membership?.status === 'rejected') {
          showToast('The host declined your join request.', 'error');
          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Join Game';
          }
          if (pendingNotice) pendingNotice.style.display = 'none';
        }
      },
      (payload) => {
        if (payload.new && payload.new.status === 'finished') {
          showToast('This room was closed by the host.', 'info');
          if (buttonEl) {
            buttonEl.disabled = false;
            buttonEl.textContent = 'Join Game';
          }
          if (pendingNotice) pendingNotice.style.display = 'none';
        }
      }
    );

  } catch (err) {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = 'Join Game';
    }
    showToast(err.message, 'error');
  }
}

// 2. Active Party Room Screen with Map Selector Modal
export async function renderRoomLobby(container, room, isHost, initialStatus = 'accepted') {
  currentRoomData = room;
  AppState.currentRoom = room;

  container.innerHTML = `
    <section id="view-rooms" class="view" style="padding: 32px; max-width: 1000px; margin: 0 auto; gap: 20px;">
      <div class="rooms-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <button id="btn-leave-room" class="btn secondary-btn small" type="button">← Leave Party</button>
        <div>
          <h2 style="font-family: var(--font-display); letter-spacing: 1px;">
            ${room.title} <span style="color: var(--tactical-amber); font-family: var(--font-mono); font-size: 1rem;">[${room.code}]</span>
          </h2>
          <p id="room-status-badge" style="font-family: var(--font-mono); font-size: 0.78rem; color: var(--terminal-green); margin-top: 4px;">
            Status: ${initialStatus === 'accepted' ? 'Ready in Lobby' : 'Waiting for Host'}
          </p>
        </div>
        ${isHost ? `<button id="btn-start-match" class="btn primary-btn small" type="button">🚀 Start Game</button>` : ''}
      </div>

      <!-- MAIN PARTY STAGE -->
      <div class="room-panel" style="width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 style="font-family: var(--font-display); margin-bottom: 0;">
            Party Roster (<span id="member-count">1</span>/${room.max_players})
          </h3>
          <span style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--tactical-amber);">
            SQUAD STAGE
          </span>
        </div>

        <div class="party-stage-container">
          <div id="party-stage-grid-target" class="room-party-grid" data-count="1"></div>
        </div>
      </div>

      <!-- HOST CONTROLS OR JOIN REQUESTS -->
      ${isHost ? `
      <div class="room-panel" style="margin-top: 14px;">
        <h3 style="font-family: var(--font-display); margin-bottom: 12px;">Join Requests</h3>
        <div id="pending-members-list" class="room-list"></div>
      </div>
      ` : ''}

      <!-- HOST MAP PICKER MODAL -->
      <div id="modal-map-picker" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 100; align-items: center; justify-content: center; backdrop-filter: blur(3px);">
        <div class="room-panel" style="width: 100%; max-width: 760px; max-height: 85vh; display: flex; flex-direction: column; border: 2px solid var(--hl2-amber); background: #1a212b;">
          
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #36404d; padding-bottom: 10px; margin-bottom: 14px;">
            <div>
              <h3 style="color: #ffb000; margin-bottom: 2px;">SELECT MATCH SECTOR</h3>
              <p style="font-family: var(--font-mono); font-size: 0.72rem; color: #8b9bb0;">Choose a custom level for all party operatives.</p>
            </div>
            <button id="btn-close-map-modal" class="btn secondary-btn small" type="button">✕ Cancel</button>
          </div>

          <div id="map-cards-container" style="flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-right: 6px;">
            <div style="color: #8b9bb0; font-family: var(--font-mono); font-size: 0.8rem; text-align: center; padding: 20px;">Fetching server maps...</div>
          </div>

          <div style="margin-top: 14px; border-top: 1px solid #36404d; padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
            <button id="btn-launch-default-map" class="btn secondary-btn small" type="button">
              Play Default Empty Arena
            </button>
            <span style="font-family: var(--font-mono); font-size: 0.7rem; color: #8b9bb0;">NET: SERVER SYNC</span>
          </div>

        </div>
      </div>
    </section>
  `;

  document.getElementById('btn-leave-room')?.addEventListener('click', async () => {
    try {
      await leaveOrDisbandRoom(room.id, AppState.user.id, isHost);
    } catch (err) {
      console.error('Error leaving room:', err);
    } finally {
      renderRoomsBrowser(container);
    }
  });

  // HOST CLICK: Launch Map Picker Modal
  if (isHost) {
    const mapModal = document.getElementById('modal-map-picker');
    const closeBtn = document.getElementById('btn-close-map-modal');
    const cardsContainer = document.getElementById('map-cards-container');

    document.getElementById('btn-start-match')?.addEventListener('click', async () => {
      mapModal.style.display = 'flex';
      cardsContainer.innerHTML = `<div style="color: #ffb000; font-family: 'Lucida Console', monospace; font-size: 0.8rem; text-align: center; padding: 20px;">Loading custom maps...</div>`;
      
      try {
        const maps = await getAllMaps();
        if (!maps.length) {
          cardsContainer.innerHTML = `
            <div style="color: #8b9bb0; font-family: 'Lucida Console', monospace; font-size: 0.8rem; text-align: center; padding: 20px;">
              No maps found on the server! Build one in the Map Editor or play the default arena.
            </div>
          `;
          return;
        }

        const isVerifiedAdmin = Boolean(
          AppState.profile?.is_verified === true || 
          AppState.profile?.username?.toLowerCase() === 'admin'
        );

        cardsContainer.innerHTML = maps.map(m => {
          const mapData = m.data || {};
          const wallCount = mapData.walls?.length || 0;
          const spawnCount = mapData.spawns?.length || 0;
          const crateCount = mapData.crates?.length || 0;
          
          // Calculate JSON size in KB
          const kbSize = (JSON.stringify(mapData).length / 1024).toFixed(1);
          
          // Format date
          const d = new Date(m.created_at);
          const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

          return `
            <div class="room-item" style="display: flex; justify-content: space-between; align-items: center; padding: 14px; background: rgba(15, 20, 26, 0.85); border: 1px solid #36404d;">
              <div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <strong style="font-family: var(--font-display); font-size: 1rem; color: #fff;">${m.title}</strong>
                  ${m.is_verified 
                    ? `<span style="background: #3cd446; color: #000; font-family: var(--font-mono); font-size: 0.65rem; font-weight: bold; padding: 2px 6px; border-radius: 2px;">VERIFIED ✓</span>`
                    : `<span style="background: #ffb000; color: #000; font-family: var(--font-mono); font-size: 0.65rem; font-weight: bold; padding: 2px 6px; border-radius: 2px;">COMMUNITY</span>`
                  }
                </div>
                
                <div style="font-family: var(--font-mono); font-size: 0.72rem; color: #8b9bb0; margin-top: 6px; display: flex; flex-direction: column; gap: 2px;">
                  <div>
                    <span>ID: <strong style="color: #ffb000;" title="${m.id}">${m.id.slice(0, 8)}...</strong></span> | 
                    <span>CREATOR: <strong style="color: #cbd5e1;">${m.creator_name}</strong></span> | 
                    <span>CREATED: <strong style="color: #cbd5e1;">${dateStr}</strong></span>
                  </div>
                  <div>
                    <span>SIZE: <strong style="color: #3cd446;">${kbSize} KB</strong></span> 
                    (Walls: <b>${wallCount}</b> | Spawns: <b>${spawnCount}</b> | Crates: <b>${crateCount}</b>)
                  </div>
                </div>
              </div>

              <div style="display: flex; gap: 8px; align-items: center;">
                ${isVerifiedAdmin ? `
                  <button class="btn secondary-btn small btn-verify-map" data-id="${m.id}" data-current="${m.is_verified}" type="button" style="font-size: 0.7rem;">
                    ${m.is_verified ? 'Unverify' : 'Verify'}
                  </button>
                ` : ''}
                <button class="btn primary-btn small btn-deploy-map" data-id="${m.id}" type="button">
                  DEPLOY SECTOR
                </button>
              </div>
            </div>
          `;
        }).join('');

        // Deploy Selected Map
        cardsContainer.querySelectorAll('.btn-deploy-map').forEach(btn => {
          btn.addEventListener('click', async () => {
            const mapId = btn.dataset.id;
            const chosen = maps.find(m => m.id === mapId);
            await launchMatchWithMap(room.id, chosen?.data || null);
          });
        });

        // Toggle Map Verification (Admins)
        cardsContainer.querySelectorAll('.btn-verify-map').forEach(btn => {
          btn.addEventListener('click', async () => {
            const mapId = btn.dataset.id;
            const current = btn.dataset.current === 'true';
            try {
              await toggleMapVerification(mapId, !current);
              showToast(`Map verification updated!`, 'success');
              btn.dataset.current = String(!current);
              btn.textContent = !current ? 'Unverify' : 'Verify';
            } catch (e) {
              showToast('Verification failed: ' + e.message, 'error');
            }
          });
        });

      } catch (err) {
        cardsContainer.innerHTML = `<div style="color: #ff4d4d; font-family: 'Lucida Console', monospace; font-size: 0.8rem; padding: 20px;">Failed to load maps: ${err.message}</div>`;
      }
    });

    closeBtn?.addEventListener('click', () => {
      mapModal.style.display = 'none';
    });

    document.getElementById('btn-launch-default-map')?.addEventListener('click', async () => {
      await launchMatchWithMap(room.id, null);
    });
  }

  async function launchMatchWithMap(roomId, mapData) {
    try {
      if (mapData) {
        localStorage.setItem('br_custom_map', JSON.stringify(mapData));
      } else {
        localStorage.removeItem('br_custom_map');
      }

      await supabase
        .from('game_rooms')
        .update({ status: 'in_progress' })
        .eq('id', roomId);

      showToast('Deploying party to sector...', 'success');
    } catch (err) {
      showToast('Launch error: ' + err.message, 'error');
    }
  }

  if (activeRoomChannelCleanup) {
    activeRoomChannelCleanup();
  }

  activeRoomChannelCleanup = subscribeToRoom(
    room.id,
    () => syncMembers(room.id, isHost),
    (payload) => {
      if (payload.new && payload.new.status === 'in_progress') {
        showToast('Match starting! Loading map...', 'success');
        AppState.currentRoom = room;
        navigateTo('game');
      } else if (payload.new && payload.new.status === 'finished') {
        showToast('The room was closed by the host.', 'info');
        renderRoomsBrowser(container);
      }
    }
  );

  syncMembers(room.id, isHost);
}

async function syncMembers(roomId, isHost) {
  try {
    const members = await getRoomMembers(roomId);
    if (!members) return;

    const myMembership = members.find(m => m.user_id === AppState.user?.id);
    if (myMembership) {
      const badge = document.getElementById('room-status-badge');
      if (badge) badge.textContent = `Status: ${myMembership.status === 'accepted' ? 'Ready in Lobby' : 'Pending'}`;
      if (myMembership.status === 'rejected') {
        showToast('You were removed from the room.', 'error');
        const root = document.getElementById('app-root');
        if (root) renderRoomsBrowser(root);
        return;
      }
    }

    const accepted = members.filter(m => m.status === 'accepted');
    const pending = members.filter(m => m.status === 'pending');

    const countEl = document.getElementById('member-count');
    if (countEl) countEl.textContent = accepted.length;

    // Render Adaptive Fortnite Grid
    const stageTarget = document.getElementById('party-stage-grid-target');
    if (stageTarget) {
      const count = accepted.length || 1;
      const localSkin = AppState.profile?.equipped_skin || localStorage.getItem('br_custom_skin') || '';

      stageTarget.setAttribute('data-count', String(count));
      if (count >= 5) {
        stageTarget.classList.add('party-scale-dense');
      } else {
        stageTarget.classList.remove('party-scale-dense');
      }

      stageTarget.innerHTML = accepted.map(m => 
        renderPartyPod(m, AppState.user?.id, currentRoomData?.host_id, localSkin)
      ).join('');
    }

    // Host Join Requests
    if (isHost) {
      const pendingList = document.getElementById('pending-members-list');
      if (pendingList) {
        if (pending.length === 0) {
          pendingList.innerHTML = `<p style="font-family: var(--font-mono); color: var(--text-dim); font-size: 0.78rem;">No pending join requests.</p>`;
        } else {
          pendingList.innerHTML = pending.map(m => `
            <div class="room-item" data-member-id="${m.id}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px;">
              <span style="font-family: var(--font-display); font-size: 0.95rem;">${m.profiles?.username || 'Player'}</span>
              <div style="display: flex; gap: 8px;">
                <button class="btn primary-btn small btn-accept" type="button">Accept</button>
                <button class="btn secondary-btn small btn-decline" type="button">Decline</button>
              </div>
            </div>
          `).join('');

          pendingList.querySelectorAll('.btn-accept').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const memId = e.target.closest('.room-item').dataset.memberId;
              await updateMemberStatus(memId, 'accepted');
            });
          });

          pendingList.querySelectorAll('.btn-decline').forEach(btn => {
            btn.addEventListener('click', async (e) => {
              const memId = e.target.closest('.room-item').dataset.memberId;
              await updateMemberStatus(memId, 'rejected');
            });
          });
        }
      }
    }
  } catch (err) {
    console.error('Member sync error:', err);
  }
}