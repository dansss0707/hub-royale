import { AppState, navigateTo } from '../main.js';
import { MapEditorEngine } from '../editor/mapEditor.js';
import { saveMapToServer } from '../services/maps.js';
import { showToast } from '../utils/helpers.js';

let editorEngine = null;

export function mountEditorView(root) {
  root.innerHTML = `
    <div id="view-editor" style="display: flex; flex-direction: column; width: 100vw; height: 100vh; background: #1c222b; user-select: none; font-family: 'Trebuchet MS', 'Segoe UI', sans-serif; color: #cbd5e1; overflow: hidden;">
      
      <!-- TOP HAMMER MENU STRIP -->
      <header style="height: 40px; background: #2b333e; border-bottom: 2px solid #14181f; display: flex; align-items: center; justify-content: space-between; padding: 0 14px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <span style="color: #ffb000; font-weight: 700; font-size: 0.95rem; letter-spacing: 0.5px;">HAMMER 2D // MAP SUITE</span>
          <span style="font-family: 'Lucida Console', monospace; font-size: 0.7rem; color: #8b9bb0;">[DRAG TILE FILL // WINDOWS // THIN WALLS]</span>
        </div>

        <div style="display: flex; gap: 8px;">
          <button id="btn-editor-cloud-save" class="btn primary-btn small" type="button">☁ Save to Server</button>
          <button id="btn-editor-test" class="btn secondary-btn small" type="button">▶ Test Map</button>
          <button id="btn-editor-exit" class="btn secondary-btn small" type="button">✕ Exit</button>
        </div>
      </header>

      <!-- MAIN WORKSPACE -->
      <div style="display: flex; flex: 1; height: calc(100vh - 40px); overflow: hidden;">
        
        <!-- LEFT TOOL PALETTE -->
        <aside style="width: 215px; background: #242b35; border-right: 2px solid #14181f; display: flex; flex-direction: column; padding: 10px; gap: 8px; overflow-y: auto;">
          <div style="font-family: 'Lucida Console', monospace; font-size: 0.65rem; color: #ffb000; text-transform: uppercase;">// Brush Tools</div>
          
          <button class="btn secondary-btn small tool-btn active" data-tool="select" style="text-align: left; padding: 7px 10px;">↖ Select / Move</button>
          <button class="btn secondary-btn small tool-btn" data-tool="wall" style="text-align: left; padding: 7px 10px;">🧱 Thin Wall (4px+)</button>
          <button class="btn secondary-btn small tool-btn" data-tool="window" style="text-align: left; padding: 7px 10px;">🪟 Window (Glass)</button>
          <button class="btn secondary-btn small tool-btn" data-tool="tile" style="text-align: left; padding: 7px 10px;">🖌 Tile Painter</button>
          <button class="btn secondary-btn small tool-btn" data-tool="spawn" style="text-align: left; padding: 7px 10px;">🚩 Player Spawn</button>
          <button class="btn secondary-btn small tool-btn" data-tool="crate" style="text-align: left; padding: 7px 10px;">📦 Loot Crate</button>

          <hr style="border: none; border-top: 1px solid #36404d; margin: 4px 0; width: 100%;">

          <!-- MAP SIZE / BOUNDS -->
          <div style="font-family: 'Lucida Console', monospace; font-size: 0.65rem; color: #ffb000; text-transform: uppercase;">// Map Dimensions</div>
          <div style="display: flex; gap: 6px; font-size: 0.72rem; align-items: center;">
            <div style="flex: 1;">
              <span>Width:</span>
              <input type="number" id="input-map-width" value="2400" step="100" min="600" max="6000" style="width: 100%; background: #14181f; border: 1px solid #36404d; color: #ffb000; padding: 4px; font-family: monospace; font-size: 0.75rem;">
            </div>
            <div style="flex: 1;">
              <span>Height:</span>
              <input type="number" id="input-map-height" value="1800" step="100" min="600" max="6000" style="width: 100%; background: #14181f; border: 1px solid #36404d; color: #ffb000; padding: 4px; font-family: monospace; font-size: 0.75rem;">
            </div>
          </div>
          <button id="btn-apply-size" class="btn secondary-btn small" style="padding: 4px; font-size: 0.68rem;">Apply Dimensions</button>

          <hr style="border: none; border-top: 1px solid #36404d; margin: 4px 0; width: 100%;">

          <!-- TILE PAINTER CONTROLS -->
          <div style="font-family: 'Lucida Console', monospace; font-size: 0.65rem; color: #ffb000; text-transform: uppercase;">// Tile Painter</div>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem;">
            <span>Brush Size:</span>
            <select id="select-tile-size" style="background: #14181f; border: 1px solid #36404d; color: #fff; padding: 4px; font-size: 0.72rem;">
              <option value="2">2px (Micro Detail)</option>
              <option value="4">4px (Fine)</option>
              <option value="8" selected>8px (Standard)</option>
              <option value="16">16px (Block)</option>
              <option value="32">32px (Room Tile)</option>
            </select>

            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; color: #ffb000; font-weight: bold;">
              <input type="checkbox" id="check-tile-rect"> ⬚ Drag Area Fill (Box)
            </label>

            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="check-tile-snap" checked> Tile Grid Snap
            </label>

            <span>Tile Color:</span>
            <input type="color" id="picker-tile-color" value="#2a3340" style="width: 100%; height: 24px; border: 1px solid #14171c; cursor: pointer;">

            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="check-tile-solid"> Solid Barrier (Blocks Sight/Bullets)
            </label>

            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="check-tile-eraser"> Eraser Mode
            </label>
          </div>

          <hr style="border: none; border-top: 1px solid #36404d; margin: 4px 0; width: 100%;">

          <!-- WALL & VOID SETTINGS -->
          <div style="font-family: 'Lucida Console', monospace; font-size: 0.65rem; color: #ffb000; text-transform: uppercase;">// Snapping & Void</div>
          <div style="display: flex; flex-direction: column; gap: 6px; font-size: 0.72rem;">
            <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
              <input type="checkbox" id="check-grid-snap" checked> Wall Grid Snap
            </label>

            <span>Wall Fill:</span>
            <input type="color" id="picker-wall-color" value="#3d4754" style="width: 100%; height: 22px; border: 1px solid #14171c; cursor: pointer;">

            <span>Void (Out of Bounds):</span>
            <input type="color" id="picker-void-color" value="#070a0f" style="width: 100%; height: 22px; border: 1px solid #14171c; cursor: pointer;">
          </div>

          <button id="btn-clear-map" class="btn secondary-btn small" type="button" style="margin-top: auto; color: #ff4d4d; border-color: #552222; padding: 6px;">
            Clear Map
          </button>
        </aside>

        <!-- CENTER VIEWPORT -->
        <main style="flex: 1; position: relative; background: #070a0f; overflow: hidden;">
          <canvas id="editor-canvas" style="display: block; width: 100%; height: 100%; cursor: crosshair;"></canvas>
          
          <div id="editor-coords" style="position: absolute; bottom: 8px; left: 12px; font-family: 'Lucida Console', monospace; font-size: 0.68rem; color: #6f8299; pointer-events: none; background: rgba(12, 16, 20, 0.8); padding: 4px 8px; border: 1px solid #1e2530;">
            X: 0 | Y: 0 | Size: 2400x1800
          </div>

          <div style="position: absolute; top: 10px; right: 14px; font-family: 'Lucida Console', monospace; font-size: 0.68rem; color: #ffb000; background: rgba(12, 16, 20, 0.85); padding: 6px 10px; border: 1px solid #2d3846; pointer-events: none;">
            PAN: Middle-Click | ZOOM: Wheel | TIP: Hold Shift for Quick Area Fill
          </div>
        </main>

        <!-- RIGHT PROPERTIES INSPECTOR -->
        <aside style="width: 210px; background: #242b35; border-left: 2px solid #14181f; padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 0.75rem;">
          <div style="font-family: 'Lucida Console', monospace; font-size: 0.65rem; color: #ffb000; text-transform: uppercase;">// Properties</div>
          <div id="inspector-body">
            No object selected.
          </div>
        </aside>

      </div>
    </div>
  `;

  const canvas = document.getElementById('editor-canvas');
  editorEngine = new MapEditorEngine(canvas);
  editorEngine.init();

  const wInput = document.getElementById('input-map-width');
  const hInput = document.getElementById('input-map-height');
  if (wInput) wInput.value = editorEngine.worldWidth;
  if (hInput) hInput.value = editorEngine.worldHeight;

  document.getElementById('btn-apply-size')?.addEventListener('click', () => {
    editorEngine.setMapSize(wInput.value, hInput.value);
    showToast(`Map resized to ${editorEngine.worldWidth}x${editorEngine.worldHeight}`, 'success');
  });

  root.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      root.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      editorEngine.activeTool = btn.dataset.tool;
      editorEngine.selectedEntity = null;
      editorEngine.updateInspector();
    });
  });

  document.getElementById('picker-wall-color')?.addEventListener('input', (e) => {
    editorEngine.wallSettings.color = e.target.value;
  });

  document.getElementById('select-tile-size')?.addEventListener('change', (e) => {
    editorEngine.tileSettings.size = parseInt(e.target.value, 10);
  });
  document.getElementById('check-tile-rect')?.addEventListener('change', (e) => {
    editorEngine.tileSettings.rectMode = e.target.checked;
  });
  document.getElementById('check-tile-snap')?.addEventListener('change', (e) => {
    editorEngine.enableTileSnap = e.target.checked;
  });
  document.getElementById('picker-tile-color')?.addEventListener('input', (e) => {
    editorEngine.tileSettings.color = e.target.value;
  });
  document.getElementById('check-tile-solid')?.addEventListener('change', (e) => {
    editorEngine.tileSettings.isSolid = e.target.checked;
  });
  document.getElementById('check-tile-eraser')?.addEventListener('change', (e) => {
    editorEngine.tileSettings.isEraser = e.target.checked;
  });

  document.getElementById('check-grid-snap')?.addEventListener('change', (e) => {
    editorEngine.enableSnap = e.target.checked;
  });
  document.getElementById('picker-void-color')?.addEventListener('input', (e) => {
    editorEngine.map.outOfBoundsColor = e.target.value;
    editorEngine.saveWorkingCopy();
  });

  document.getElementById('btn-clear-map')?.addEventListener('click', () => {
    if (confirm('Clear all walls, windows, painted tiles, and entities?')) {
      editorEngine.clear();
    }
  });

  document.getElementById('btn-editor-cloud-save')?.addEventListener('click', async () => {
    const user = AppState.user;
    if (!user) {
      showToast('You must be logged in to upload maps!', 'error');
      return;
    }

    const title = prompt('Enter a name for this sector:', editorEngine.map.name || 'Sector 17') || 'Sector 17';
    editorEngine.map.name = title;
    const mapData = editorEngine.getMapData();

    try {
      const saved = await saveMapToServer(user.id, AppState.profile?.username || 'Architect', title, mapData);
      showToast(`Saved to server! ID: ${saved.id.slice(0, 8)}...`, 'success');
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  });

  document.getElementById('btn-editor-test')?.addEventListener('click', () => {
    const mapData = editorEngine.getMapData();
    localStorage.setItem('br_custom_map', JSON.stringify(mapData));
    if (editorEngine) editorEngine.destroy();
    navigateTo('game');
  });

  document.getElementById('btn-editor-exit')?.addEventListener('click', () => {
    if (editorEngine) editorEngine.destroy();
    navigateTo('lobby');
  });
}