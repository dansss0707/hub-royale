import { supabase } from '../services/supabase.js';
import { AppState, navigateTo } from '../main.js';
import { 
  getProfile,
  equipSkin, 
  getCrateItems, 
  rollFromCrate, 
  deductCoins, 
  addCrateItem, 
  verifyUserByUsername 
} from '../services/profile.js';
import { showToast } from '../utils/helpers.js';

export async function mountCratesView(root) {
  // 1. Get current authenticated user directly from Supabase session to eliminate stale AppState
  const { data: { user } } = await supabase.auth.getUser();
  const currentUserId = user?.id || AppState.user?.id;

  let profile = AppState.profile || {};
  if (currentUserId) {
    try {
      const freshProfile = await getProfile(currentUserId);
      if (freshProfile) {
        AppState.profile = freshProfile;
        profile = freshProfile;
      }
    } catch (err) {
      console.warn('Could not refresh profile live:', err);
    }
  }

  // 2. Verified Admin Check with truthy coercion (handles true, 'true', 1, or username 'admin')
  const isVerifiedAdmin = Boolean(
    profile.is_verified === true || 
    profile.is_verified === 'true' || 
    profile.is_verified === 1 || 
    profile.username?.toLowerCase() === 'admin'
  );

  console.log('[Auth Debug] User ID:', currentUserId, 'Profile:', profile, 'isVerifiedAdmin:', isVerifiedAdmin);

  let currentSkin = profile.equipped_skin || localStorage.getItem('br_custom_skin') || '';
  let crateItems = [];

  try {
    crateItems = await getCrateItems('standard_crate');
  } catch (err) {
    console.error('Error fetching crate skins:', err);
  }

  root.innerHTML = `
    <div id="view-crates">
      <div class="crates-layout">
        
        <!-- HEADER -->
        <div class="crates-header">
          <div style="display: flex; align-items: center; gap: 10px;">
            <h2>CS2 Weapon Case Station</h2>
            ${isVerifiedAdmin ? `<span class="admin-badge">VERIFIED ADMIN</span>` : ''}
          </div>
          <div style="display: flex; gap: 10px;">
            ${isVerifiedAdmin ? `<button id="btn-toggle-admin" class="btn primary-btn small" type="button">⚙ Admin Panel</button>` : ''}
            <button id="btn-back-lobby" class="btn secondary-btn small" type="button">✕ Back to Lobby</button>
          </div>
        </div>

        <!-- CS2 CRATE OPENING MACHINE -->
        <div class="crate-machine">
          <div style="display: flex; justify-content: space-between; width: 100%; max-width: 760px; font-family: 'Lucida Console', monospace; font-size: 0.75rem;">
            <span style="color: #ffb000;">CASE: REVOLUTION SPEC-OPS</span>
            <span style="color: #8b9bb0;">COST: <strong style="color: #ffd700;">50 🪙</strong></span>
          </div>

          <!-- THE CS2 HORIZONTAL ROULETTE TRACK -->
          <div class="cs2-spinner-container">
            <div class="cs2-center-needle"></div>
            <div id="cs2-track" class="cs2-track">
              <!-- Dynamically populated -->
            </div>
          </div>

          <!-- UNLOCK BUTTON -->
          <button id="btn-unlock-crate" class="btn primary-btn" style="padding: 12px 36px; font-size: 0.95rem;" type="button">
            🔓 UNLOCK CONTAINER (50 🪙)
          </button>
        </div>

        <!-- ADMIN MODAL DRAWER (ONLY FOR VERIFIED USERS) -->
        ${isVerifiedAdmin ? `
          <div id="admin-panel" class="room-panel" style="display: none; background: #1a2028; border: 1px solid #ffb000; padding: 20px;">
            <h3 style="color: #ffb000; margin-bottom: 12px;">Verified Admin Controls</h3>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
              <!-- 1. Add Skin to Crate -->
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <strong style="font-size: 0.8rem; color: #fff;">Add New Skin to Case:</strong>
                <input id="admin-skin-name" type="text" placeholder="Skin Name (e.g. Neon Rebel)" style="padding: 8px; background: #0f1318; border: 1px solid #36404d; color: #fff;" />
                <input id="admin-skin-url" type="text" placeholder="Image URL (https://...)" style="padding: 8px; background: #0f1318; border: 1px solid #36404d; color: #fff;" />
                
                <div style="display: flex; gap: 8px;">
                  <select id="admin-skin-rarity" style="padding: 8px; background: #0f1318; border: 1px solid #36404d; color: #fff; flex: 1;">
                    <option value="common">Common (Mil-Spec)</option>
                    <option value="rare">Rare (Restricted)</option>
                    <option value="epic">Epic (Classified)</option>
                    <option value="legendary">Legendary (Covert)</option>
                  </select>
                  <input id="admin-skin-weight" type="number" placeholder="Weight (e.g. 50)" value="50" style="width: 90px; padding: 8px; background: #0f1318; border: 1px solid #36404d; color: #fff;" />
                </div>

                <button id="btn-admin-add-skin" class="btn primary-btn small" style="margin-top: 4px;" type="button">
                  + Add to Crate Pool
                </button>
              </div>

              <!-- 2. Verify Another Account -->
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <strong style="font-size: 0.8rem; color: #fff;">Verify Another Operative:</strong>
                <p style="font-size: 0.72rem; color: #8b9bb0;">
                  Verified accounts inherit all admin privileges, crate permissions, and verification powers.
                </p>
                <div style="display: flex; gap: 8px; margin-top: 6px;">
                  <input id="admin-verify-username" type="text" placeholder="Exact Username..." style="flex: 1; padding: 8px; background: #0f1318; border: 1px solid #36404d; color: #fff;" />
                  <button id="btn-admin-verify-user" class="btn primary-btn small" type="button">Verify</button>
                </div>
              </div>
            </div>
          </div>
        ` : ''}

        <!-- EQUIPPED SKIN PREVIEW & URL/FILE UPLOADER -->
        <div class="inventory-section">
          <h3>Direct Customizer / Equipper</h3>
          <div style="display: flex; gap: 20px; align-items: center; margin-top: 10px;">
            <div style="width: 80px; height: 80px; border-radius: 50%; overflow: hidden; border: 3px solid #ffb000; flex-shrink: 0; background: #12151b;">
              <img id="custom-preview-circle" src="${currentSkin}" style="width: 100%; height: 100%; object-fit: cover; display: ${currentSkin ? 'block' : 'none'};" alt="Skin" />
              <span id="custom-fallback-circle" style="display: ${currentSkin ? 'none' : 'flex'}; width: 100%; height: 100%; align-items: center; justify-content: center; font-size: 2.2rem;">👤</span>
            </div>
            
            <div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; gap: 8px;">
                <input id="input-direct-url" type="text" placeholder="Paste external image URL..." value="${currentSkin}" style="flex: 1; padding: 8px; background: #12151b; border: 1px solid #2d3540; color: #fff;" />
                <button id="btn-apply-direct-url" class="btn primary-btn small" type="button">Apply</button>
              </div>
              <input id="input-file-upload" type="file" accept="image/*" style="font-size: 0.72rem; color: #8b9bb0;" />
            </div>
          </div>
        </div>

      </div>
    </div>
  `;

  // --- INITIALIZE CS2 TRACK ---
  const track = document.getElementById('cs2-track');
  const cardWidth = 122; // 110px card width + 12px flex gap

  function populateTrack(initialPool, winningItem = null) {
    if (!initialPool || !initialPool.length) return;
    track.innerHTML = '';
    
    const totalCards = 60;
    const winnerIndex = 48; // Where the center needle lands

    for (let i = 0; i < totalCards; i++) {
      let item = initialPool[Math.floor(Math.random() * initialPool.length)];
      if (i === winnerIndex && winningItem) {
        item = winningItem;
      }

      const card = document.createElement('div');
      card.className = `cs2-card rarity-${item.rarity}`;
      card.id = `cs2-card-${i}`;
      card.innerHTML = `
        <img src="${item.image_url}" alt="${item.name}" />
        <span class="cs2-name">${item.name}</span>
      `;
      track.appendChild(card);
    }
  }

  populateTrack(crateItems);

  // --- CS2 UNBOXING LOGIC ---
  const unlockBtn = document.getElementById('btn-unlock-crate');
  let isSpinning = false;

  unlockBtn?.addEventListener('click', async () => {
    if (isSpinning) return;
    if (!crateItems.length) {
      showToast('Crate item pool is empty!', 'error');
      return;
    }

    try {
      // 1. Deduct Coins
      unlockBtn.disabled = true;
      unlockBtn.textContent = 'Purchasing Key...';
      const updatedProfile = await deductCoins(currentUserId, 50);
      AppState.profile.coins = updatedProfile.coins;

      // 2. Pick winner
      const winner = rollFromCrate(crateItems);
      isSpinning = true;

      // 3. Reset Track Position & Repopulate with winner placed at index 48
      track.style.transition = 'none';
      track.style.transform = 'translateX(0px)';
      populateTrack(crateItems, winner);

      // Force layout recalculation
      void track.offsetWidth;

      // 4. Calculate landing coordinate with slight jitter (-30px to +30px)
      const randomOffset = Math.floor(Math.random() * 60) - 30;
      const targetTranslate = -(48 * cardWidth + randomOffset);

      // 5. Trigger CSS Deceleration Spin
      track.style.transition = 'transform 5.2s cubic-bezier(0.1, 0.9, 0.15, 1)';
      track.style.transform = `translateX(${targetTranslate}px)`;

      setTimeout(async () => {
        isSpinning = false;
        unlockBtn.disabled = false;
        unlockBtn.textContent = '🔓 UNLOCK CONTAINER (50 🪙)';

        // Highlight winning card
        const winningCard = document.getElementById('cs2-card-48');
        if (winningCard) winningCard.classList.add('cs2-winner-selected');

        // Automatically equip the unboxed skin
        await equipSkin(currentUserId, winner.image_url);
        AppState.profile.equipped_skin = winner.image_url;
        localStorage.setItem('br_custom_skin', winner.image_url);

        // Update preview circle
        const preview = document.getElementById('custom-preview-circle');
        const fallback = document.getElementById('custom-fallback-circle');
        if (preview && fallback) {
          preview.src = winner.image_url;
          preview.style.display = 'block';
          fallback.style.display = 'none';
        }

        showToast(`UNBOXED: [${winner.rarity.toUpperCase()}] ${winner.name}!`, 'success');
      }, 5300);

    } catch (err) {
      unlockBtn.disabled = false;
      unlockBtn.textContent = '🔓 UNLOCK CONTAINER (50 🪙)';
      showToast(err.message, 'error');
    }
  });

  // --- ADMIN ACTIONS ---
  if (isVerifiedAdmin) {
    const adminPanel = document.getElementById('admin-panel');
    document.getElementById('btn-toggle-admin')?.addEventListener('click', () => {
      adminPanel.style.display = adminPanel.style.display === 'none' ? 'block' : 'none';
    });

    // Add new skin to DB
    document.getElementById('btn-admin-add-skin')?.addEventListener('click', async () => {
      const name = document.getElementById('admin-skin-name')?.value.trim();
      const imageUrl = document.getElementById('admin-skin-url')?.value.trim();
      const rarity = document.getElementById('admin-skin-rarity')?.value;
      const weight = parseInt(document.getElementById('admin-skin-weight')?.value, 10) || 50;

      if (!name || !imageUrl) {
        showToast('Please provide both skin name and image URL.', 'error');
        return;
      }

      try {
        const newItem = await addCrateItem({
          crate_id: 'standard_crate',
          name,
          image_url: imageUrl,
          rarity,
          weight
        });
        crateItems.push(newItem);
        populateTrack(crateItems);
        showToast(`Added "${name}" to the crate drop pool!`, 'success');
        document.getElementById('admin-skin-name').value = '';
        document.getElementById('admin-skin-url').value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Verify other user
    document.getElementById('btn-admin-verify-user')?.addEventListener('click', async () => {
      const targetUser = document.getElementById('admin-verify-username')?.value.trim();
      if (!targetUser) return;

      try {
        await verifyUserByUsername(targetUser);
        showToast(`Successfully verified Operative "${targetUser}"!`, 'success');
        document.getElementById('admin-verify-username').value = '';
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // --- DIRECT EQUIPPERS ---
  document.getElementById('btn-apply-direct-url')?.addEventListener('click', async () => {
    const url = document.getElementById('input-direct-url')?.value.trim();
    if (!url) return;
    await equipSkin(currentUserId, url);
    AppState.profile.equipped_skin = url;
    localStorage.setItem('br_custom_skin', url);
    showToast('Skin equipped!', 'success');
  });

  document.getElementById('input-file-upload')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target.result;
      await equipSkin(currentUserId, base64);
      AppState.profile.equipped_skin = base64;
      localStorage.setItem('br_custom_skin', base64);
      document.getElementById('custom-preview-circle').src = base64;
      showToast('Uploaded image equipped!', 'success');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
    navigateTo('lobby');
  });
}