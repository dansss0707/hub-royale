import { AppState, navigateTo } from '../main.js';
import { logoutUser } from '../services/auth.js';

export function mountLobbyView(container) {
  const profile = AppState.profile || { 
    username: 'Player', 
    coins: 250, 
    wins: 0,
    equipped_skin: ''
  };

  const username = profile.username || 'Player';
  const rawSkin = profile.equipped_skin || localStorage.getItem('br_custom_skin') || '';
  const currentSkin = (typeof rawSkin === 'string' && (rawSkin.startsWith('http://') || rawSkin.startsWith('https://') || rawSkin.startsWith('data:image/'))) ? rawSkin : '';

  // Get active party members from room state, or default to solo
  let partyMembers = [];
  if (AppState.currentRoom?.members?.length) {
    partyMembers = AppState.currentRoom.members;
  } else {
    partyMembers = [
      { id: AppState.user?.id || 'local', username: username, skinUrl: currentSkin, isSelf: true }
    ];
  }

  function renderPod(p) {
    const isSelf = p.isSelf || p.id === AppState.user?.id;
    const name = p.username || 'Player';
    const skin = isSelf ? (currentSkin || p.skinUrl) : p.skinUrl;
    const isImg = skin && (skin.startsWith('http') || skin.startsWith('data:image/'));

    return `
      <div class="party-pod ${isSelf ? 'is-local' : ''}">
        <div class="character-sprite">
          ${isImg 
            ? `<img src="${skin}" alt="${name}" />`
            : `<span class="avatar-icon" style="font-size: 2.4rem;">👤</span>`
          }
        </div>
        <div class="pod-disk"></div>
        <div class="operative-id-plate">
          <span class="plate-name">${name}${isSelf ? ' (You)' : ''}</span>
          <span class="plate-tag">${isSelf ? 'LEADER' : 'READY'}</span>
        </div>
      </div>
    `;
  }

  container.innerHTML = `
    <section id="view-lobby">
      <header class="top-nav">
        <div class="user-badge">
          <div class="rank-insignia">LVL <span>1</span></div>
          <div class="user-meta">
            <span class="username" id="display-nav-name" style="color: #ffb000; text-shadow: 0 0 8px rgba(255, 176, 0, 0.65);">
              ${username}
            </span>
            <span class="combat-tag">Party: ${partyMembers.length} Operative${partyMembers.length > 1 ? 's' : ''}</span>
          </div>
        </div>

        <div class="lobby-currencies">
          <div class="stat-pill"><span class="icon">🪙</span> <span id="lobby-coin-count">${profile.coins ?? 0}</span> <small>Coins</small></div>
          <div class="stat-pill highlight"><span class="icon">🏆</span> <span>${profile.wins ?? 0}</span> <small>Wins</small></div>
          <button id="btn-logout" class="btn secondary-btn small" type="button">Log Out</button>
        </div>
      </header>

      <div class="deck-grid">
        <!-- LEFT: PLAY MODES & LEVEL DESIGN -->
        <aside class="deck-rail left">
          <div class="rail-header">
            <span class="subtext">Play Modes</span>
            <h3>Battle</h3>
          </div>

          <div class="action-stack">
            <button id="btn-open-rooms" class="deck-action-card primary" type="button">
              <div class="card-stencil">[01] SQUAD LOBBIES</div>
              <div class="card-body">
                <h2>Join or Host a Room</h2>
                <p>Play with friends via party codes or join public matches.</p>
              </div>
              <div class="card-tag">Multiplayer</div>
            </button>

            <button id="btn-quick-play" class="deck-action-card" type="button">
              <div class="card-stencil">[02] INSTANT ACTION</div>
              <div class="card-body">
                <h2>Practice Arena</h2>
                <p>Jump into a single-player arena against bots.</p>
              </div>
              <div class="card-tag">Solo</div>
            </button>

            <button id="btn-open-editor" class="deck-action-card" type="button">
              <div class="card-stencil">[03] LEVEL DESIGN</div>
              <div class="card-body">
                <h2>Map Builder</h2>
                <p>Construct custom arenas, spawn points, and cover walls.</p>
              </div>
              <div class="card-tag">HAMMER 2D</div>
            </button>
          </div>
        </aside>

        <!-- CENTER: ADAPTIVE FORTNITE / GMOD PARTY STAGE -->
        <main class="deck-centerpiece">
          <div class="party-stage-grid ${partyMembers.length >= 5 ? 'party-scale-dense' : ''}" data-count="${partyMembers.length}">
            ${partyMembers.map(renderPod).join('')}
          </div>
        </main>

        <!-- RIGHT: OUTFITTER & SKINS REQUISITION -->
        <aside class="deck-rail right">
          <div class="rail-header">
            <span class="subtext">Customization</span>
            <h3>Armory</h3>
          </div>

          <div class="action-stack" style="gap: 16px;">
            <div class="room-panel" style="padding: 18px; border: 1px solid var(--border-dim); border-radius: 6px; background: rgba(0,0,0,0.25);">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-family: var(--font-display); font-size: 1rem; color: #fff;">Custom Skins</span>
                <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--tactical-amber);">CS2 CRATE / URL</span>
              </div>
              <p style="font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); margin-bottom: 14px; line-height: 1.4;">
                Unlock weapon cases, upload custom circle skins, or manage administrative drop pools.
              </p>
              <button id="btn-open-crates" class="btn primary-btn small" style="width: 100%;" type="button">
                🎨 Open Crate Outfitter
              </button>
            </div>
          </div>
        </aside>
      </div>

      <footer class="deck-ticker">
        <div class="ticker-badge">Live</div>
        <div class="ticker-text">
          <span>Source Engine Build: 3943 | Hammer 2D Level Editor Active</span>
        </div>
      </footer>
    </section>
  `;

  // Navigation Event Handlers
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await logoutUser();
    navigateTo('auth');
  });

  document.getElementById('btn-open-rooms')?.addEventListener('click', () => {
    navigateTo('rooms');
  });

  document.getElementById('btn-quick-play')?.addEventListener('click', () => {
    navigateTo('game');
  });

  document.getElementById('btn-open-editor')?.addEventListener('click', () => {
    navigateTo('editor');
  });

  document.getElementById('btn-open-crates')?.addEventListener('click', () => {
    navigateTo('crates');
  });
}