import { supabase } from './services/supabase.js';
import { getProfile } from './services/auth.js';
import { getActiveRoomForUser } from './services/rooms.js';

import { mountAuthView } from './ui/authView.js';
import { mountLobbyView } from './ui/lobbyView.js';
import { mountCratesView } from './ui/cratesView.js';
import { mountRoomsView } from './ui/roomsView.js';
import { mountEditorView } from './ui/editorView.js';

export const AppState = {
  user: null,
  profile: null,
  currentRoom: null,
  activeRoute: null
};

let isInitialized = false;

export function navigateTo(route, params = {}) {
  const root = document.getElementById('app-root');
  if (!root) {
    console.error('Missing #app-root element in index.html!');
    return;
  }

  root.style.display = 'block';
  root.style.width = '100vw';
  root.style.height = '100vh';
  root.style.overflow = 'hidden';
  root.style.position = 'relative';

  AppState.activeRoute = route;

  switch (route) {
    case 'auth':
      mountAuthView(root);
      break;

    case 'lobby':
      mountLobbyView(root);
      break;

    case 'crates':
      mountCratesView(root);
      break;

    case 'rooms':
      mountRoomsView(root, params);
      break;

    case 'editor':
      mountEditorView(root);
      break;

    case 'game':
      root.innerHTML = `
        <div id="game-ui-overlay" style="position: absolute; inset: 0; pointer-events: none; z-index: 20; padding: 24px; box-sizing: border-box; font-family: var(--font-hud);">
          
          <!-- TOP ROW: DISCONNECT & ROUND TIMER -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
            <button id="btn-exit-game" class="gmod-panel btn secondary-btn small" style="pointer-events: auto; padding: 6px 14px; font-family: var(--font-hud); font-size: 0.8rem; color: var(--hl2-amber); cursor: pointer; text-transform: uppercase; letter-spacing: 1px;" type="button">
              [DISCONNECT]
            </button>
            
            <div class="gmod-panel" style="padding: 6px 20px; display: flex; flex-direction: column; align-items: center; border-top: 2px solid var(--hl2-amber);">
              <span id="host-badge" style="font-size: 0.65rem; color: rgba(255,176,0,0.6); letter-spacing: 2px; text-transform: uppercase;">
                ${AppState.currentRoom ? `ROOM: ${AppState.currentRoom.code || 'MATCH'}` : 'PRACTICE ARENA (SOLO)'}
              </span>
              <span id="timer-val" style="font-family: var(--font-digits); font-size: 2.2rem; line-height: 1; color: var(--hl2-amber); text-shadow: var(--hl2-amber-glow); letter-spacing: 3px;">03:00</span>
            </div>

            <div class="gmod-panel" style="padding: 6px 12px; font-size: 0.68rem; color: rgba(255,176,0,0.7); line-height: 1.4;">
              <div>MODE: ${AppState.currentRoom ? 'MULTIPLAYER' : 'SOLO PRACTICE'}</div>
              <div>SLOTS: 1 - 5</div>
            </div>
          </div>

          <!-- BOTTOM ROW: HEALTH/SUIT ON LEFT, WEAPONS ON RIGHT -->
          <div style="position: absolute; bottom: 24px; left: 24px; right: 24px; display: flex; justify-content: space-between; align-items: flex-end;">
            
            <!-- HEALTH & SUIT PODS -->
            <div style="display: flex; gap: 14px;">
              <div class="gmod-panel" style="width: 150px; padding: 10px 14px; display: flex; flex-direction: column; border-left: 3px solid var(--hl2-amber);">
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--hl2-amber); letter-spacing: 1px;">
                  <span>HEALTH</span>
                  <span id="hp-text">100</span>
                </div>
                <div style="font-family: var(--font-digits); font-size: 3rem; line-height: 0.9; color: var(--hl2-amber); text-shadow: var(--hl2-amber-glow);" id="hp-big">100</div>
                <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.6); margin-top: 6px; border: 1px solid rgba(255,176,0,0.3);">
                  <div id="hp-fill" style="width: 100%; height: 100%; background: var(--hl2-amber); box-shadow: var(--hl2-amber-glow); transition: width 0.1s ease;"></div>
                </div>
              </div>

              <div class="gmod-panel" style="width: 150px; padding: 10px 14px; display: flex; flex-direction: column; border-left: 3px solid var(--gmod-blue);">
                <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: var(--gmod-blue); letter-spacing: 1px;">
                  <span>SUIT</span>
                  <span id="shield-text">50</span>
                </div>
                <div style="font-family: var(--font-digits); font-size: 3rem; line-height: 0.9; color: var(--gmod-blue); text-shadow: 0 0 8px rgba(0,162,255,0.7);" id="shield-big">50</div>
                <div style="width: 100%; height: 5px; background: rgba(0,0,0,0.6); margin-top: 6px; border: 1px solid rgba(0,162,255,0.3);">
                  <div id="shield-fill" style="width: 50%; height: 100%; background: var(--gmod-blue); box-shadow: 0 0 8px rgba(0,162,255,0.7); transition: width 0.1s ease;"></div>
                </div>
              </div>
            </div>

            <!-- WEAPON SELECTION STRIP -->
            <div id="inventory-bar" style="display: flex; gap: 6px; pointer-events: auto;"></div>

          </div>

        </div>
        <canvas id="game-canvas" style="position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; background: #070b12; display: block; z-index: 1;"></canvas>
      `;

      import('./game/arena.js')
        .then(({ GameArena }) => {
          const canvas = document.getElementById('game-canvas');
          if (canvas) {
            const arena = new GameArena(canvas, AppState.currentRoom, AppState.user, AppState.profile);
            arena.start();

            document.getElementById('btn-exit-game')?.addEventListener('click', () => {
              arena.stop();
              navigateTo(AppState.currentRoom ? 'rooms' : 'lobby');
            });
          }
        })
        .catch((err) => {
          console.error('Critical failure mounting GameArena:', err);
        });
      break;
  }
}

async function init() {
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (isInitialized && (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
      if (session?.user) AppState.user = session.user;
      return;
    }

    if (session?.user) {
      AppState.user = session.user;
      try {
        AppState.profile = await getProfile(session.user.id);
      } catch (err) {
        console.error('Failed to load profile:', err);
      }

      if (AppState.activeRoute && AppState.activeRoute !== 'auth') return;

      isInitialized = true;
      try {
        const activeRoom = await getActiveRoomForUser(session.user.id);
        if (activeRoom) {
          AppState.currentRoom = activeRoom;
          const isHost = activeRoom.host_id === session.user.id;
          navigateTo('rooms', { room: activeRoom, isHost, initialStatus: 'accepted' });
          return;
        }
      } catch (err) {
        console.warn('No active room:', err);
      }

      navigateTo('lobby');
    } else {
      isInitialized = true;
      AppState.user = null;
      AppState.profile = null;
      AppState.currentRoom = null;
      navigateTo('auth');
    }
  });
}

init();