import { TileCanvas } from './tileCanvas.js';

export class MapEditorEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.worldWidth = 2400;
    this.worldHeight = 1800;

    // Viewport camera (Pan & Zoom)
    this.camera = { x: 0, y: 0, zoom: 0.75 };
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    this.gridSize = 32;
    this.enableSnap = true;
    this.enableTileSnap = true;
    this.activeTool = 'select'; // 'select' | 'wall' | 'window' | 'tile' | 'spawn' | 'crate'

    // Brush Settings
    this.wallSettings = {
      color: '#3d4754',
      borderColor: '#191f27',
      isSolid: true
    };

    this.windowSettings = {
      color: 'rgba(64, 180, 255, 0.25)',
      borderColor: '#38bdf8',
      isSolid: true
    };

    this.tileSettings = {
      size: 8, // 2, 4, 8, 16, 32
      color: '#2a3340',
      isSolid: false,
      isEraser: false,
      rectMode: false // When true, click & drag draws a box fill
    };

    // Global Map State
    this.map = {
      name: 'Custom Sector',
      version: 2,
      worldWidth: 2400,
      worldHeight: 1800,
      outOfBoundsColor: '#070a0f',
      walls: [],
      windows: [],
      spawns: [],
      crates: [],
      safeZone: { x: 1200, y: 900, radius: 600 },
      tileData: null
    };

    const saved = localStorage.getItem('br_custom_map');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.map = Object.assign(this.map, parsed);
        this.worldWidth = this.map.worldWidth || 2400;
        this.worldHeight = this.map.worldHeight || 1800;
        if (!this.map.windows) this.map.windows = [];
      } catch (e) {
        console.warn('Could not parse working map copy:', e);
      }
    }

    this.tileCanvas = new TileCanvas(this.worldWidth, this.worldHeight);
    if (this.map.tileData) {
      this.tileCanvas.importData(this.map.tileData);
    }

    this.selectedEntity = null;
    this.dragStart = null;
    this.tileDragStart = null;
    this.lastTilePos = null;
    this.currentMouse = { x: 0, y: 0, worldX: 0, worldY: 0 };
    this.isMouseDown = false;
    this.magnetSnapPoint = null;

    this.handleResize = () => this.resize();
    this.running = false;
  }

  setMapSize(newWidth, newHeight) {
    this.worldWidth = Math.max(600, Math.min(6000, parseInt(newWidth, 10) || 2400));
    this.worldHeight = Math.max(600, Math.min(6000, parseInt(newHeight, 10) || 1800));
    this.map.worldWidth = this.worldWidth;
    this.map.worldHeight = this.worldHeight;

    const oldExport = this.tileCanvas.exportData();
    this.tileCanvas = new TileCanvas(this.worldWidth, this.worldHeight);
    this.tileCanvas.importData(oldExport);

    this.saveWorkingCopy();
  }

  init() {
    this.resize();
    window.addEventListener('resize', this.handleResize);

    this.onMouseDown = (e) => this.handleMouseDown(e);
    this.onMouseMove = (e) => this.handleMouseMove(e);
    this.onMouseUp = (e) => this.handleMouseUp(e);
    this.onWheel = (e) => this.handleWheel(e);
    this.onKeyDown = (e) => this.handleKeyDown(e);

    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('keydown', this.onKeyDown);

    this.camera.x = (this.canvas.width / 2) - (this.worldWidth / 2) * this.camera.zoom;
    this.camera.y = (this.canvas.height / 2) - (this.worldHeight / 2) * this.camera.zoom;

    this.running = true;
    this.loop();
  }

  destroy() {
    this.running = false;
    window.removeEventListener('resize', this.handleResize);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('keydown', this.onKeyDown);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  screenToWorld(screenX, screenY) {
    return {
      x: (screenX - this.camera.x) / this.camera.zoom,
      y: (screenY - this.camera.y) / this.camera.zoom
    };
  }

  snapTileCoordinate(x, y) {
    if (!this.enableTileSnap) return { x, y };
    const sz = this.tileSettings.size;
    return {
      x: Math.floor(x / sz) * sz + sz / 2,
      y: Math.floor(y / sz) * sz + sz / 2
    };
  }

  snapTileCorner(x, y) {
    if (!this.enableTileSnap) return { x, y };
    const sz = this.tileSettings.size;
    return {
      x: Math.round(x / sz) * sz,
      y: Math.round(y / sz) * sz
    };
  }

  findVertexSnap(x, y, radius = 14) {
    const checkElements = [...this.map.walls, ...(this.map.windows || [])];
    if (!checkElements.length) return null;

    for (const w of checkElements) {
      const vertices = [
        { x: w.x, y: w.y },
        { x: w.x + w.w, y: w.y },
        { x: w.x, y: w.y + w.h },
        { x: w.x + w.w, y: w.y + w.h },
        { x: w.x + w.w / 2, y: w.y },
        { x: w.x + w.w / 2, y: w.y + w.h },
        { x: w.x, y: w.y + w.h / 2 },
        { x: w.x + w.w, y: w.y + w.h / 2 }
      ];

      for (const v of vertices) {
        if (Math.hypot(x - v.x, y - v.y) <= radius) {
          return { x: v.x, y: v.y };
        }
      }
    }
    return null;
  }

  resolveCoordinate(x, y) {
    const snap = this.findVertexSnap(x, y);
    if (snap) {
      this.magnetSnapPoint = snap;
      return snap;
    }
    this.magnetSnapPoint = null;

    if (this.enableSnap && this.gridSize > 0) {
      return {
        x: Math.round(x / this.gridSize) * this.gridSize,
        y: Math.round(y / this.gridSize) * this.gridSize
      };
    }

    return { x: Math.round(x), y: Math.round(y) };
  }

  handleMouseDown(e) {
    if (e.button === 1 || (e.shiftKey && this.activeTool !== 'tile')) {
      this.isPanning = true;
      this.panStart = { x: e.clientX - this.camera.x, y: e.clientY - this.camera.y };
      return;
    }

    if (e.button !== 0) return;
    this.isMouseDown = true;

    const coords = this.resolveCoordinate(this.currentMouse.worldX, this.currentMouse.worldY);

    if (this.activeTool === 'wall' || this.activeTool === 'window') {
      this.dragStart = { x: coords.x, y: coords.y };
    } else if (this.activeTool === 'tile') {
      if (this.tileSettings.rectMode || e.shiftKey) {
        // Start rectangular area drag
        const corner = this.snapTileCorner(this.currentMouse.worldX, this.currentMouse.worldY);
        this.tileDragStart = { x: corner.x, y: corner.y };
      } else {
        // Continuous brush drag
        const tilePos = this.snapTileCoordinate(this.currentMouse.worldX, this.currentMouse.worldY);
        this.tileCanvas.paint(
          tilePos.x,
          tilePos.y,
          this.tileSettings.size,
          this.tileSettings.color,
          this.tileSettings.isSolid,
          this.tileSettings.isEraser
        );
        this.lastTilePos = tilePos;
        this.saveWorkingCopy();
      }
    } else if (this.activeTool === 'spawn') {
      this.map.spawns.push({ x: coords.x, y: coords.y });
      this.saveWorkingCopy();
    } else if (this.activeTool === 'crate') {
      this.map.crates.push({ x: coords.x, y: coords.y, tier: 'standard' });
      this.saveWorkingCopy();
    } else if (this.activeTool === 'select') {
      this.selectEntityAt(this.currentMouse.worldX, this.currentMouse.worldY);
    }
  }

  handleMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.currentMouse.x = e.clientX - rect.left;
    this.currentMouse.y = e.clientY - rect.top;

    const world = this.screenToWorld(this.currentMouse.x, this.currentMouse.y);
    this.currentMouse.worldX = world.x;
    this.currentMouse.worldY = world.y;

    if (this.isPanning) {
      this.camera.x = e.clientX - this.panStart.x;
      this.camera.y = e.clientY - this.panStart.y;
      return;
    }

    // Brush freehand drag painting (when not in rect mode)
    if (this.isMouseDown && this.activeTool === 'tile' && !this.tileDragStart) {
      const tilePos = this.snapTileCoordinate(world.x, world.y);
      if (this.lastTilePos) {
        this.tileCanvas.paintStroke(
          this.lastTilePos.x,
          this.lastTilePos.y,
          tilePos.x,
          tilePos.y,
          this.tileSettings.size,
          this.tileSettings.color,
          this.tileSettings.isSolid,
          this.tileSettings.isEraser
        );
      }
      this.lastTilePos = tilePos;
      this.saveWorkingCopy();
    }

    const coordsEl = document.getElementById('editor-coords');
    if (coordsEl) {
      coordsEl.textContent = `X: ${Math.round(world.x)} | Y: ${Math.round(world.y)} | Size: ${this.worldWidth}x${this.worldHeight}`;
    }
  }

  handleMouseUp(e) {
    if (this.isPanning) {
      this.isPanning = false;
      return;
    }

    if (!this.isMouseDown) return;
    this.isMouseDown = false;
    this.lastTilePos = null;

    // Apply Rectangular Area Tile Fill
    if (this.activeTool === 'tile' && this.tileDragStart) {
      const end = this.snapTileCorner(this.currentMouse.worldX, this.currentMouse.worldY);
      const minX = Math.min(this.tileDragStart.x, end.x);
      const minY = Math.min(this.tileDragStart.y, end.y);
      const w = Math.max(this.tileSettings.size, Math.abs(end.x - this.tileDragStart.x));
      const h = Math.max(this.tileSettings.size, Math.abs(end.y - this.tileDragStart.y));

      this.tileCanvas.paintRect(
        minX,
        minY,
        minX + w,
        minY + h,
        this.tileSettings.color,
        this.tileSettings.isSolid,
        this.tileSettings.isEraser
      );

      this.tileDragStart = null;
      this.saveWorkingCopy();
      return;
    }

    // Walls & Windows
    if ((this.activeTool === 'wall' || this.activeTool === 'window') && this.dragStart) {
      const end = this.resolveCoordinate(this.currentMouse.worldX, this.currentMouse.worldY);
      const x = Math.min(this.dragStart.x, end.x);
      const y = Math.min(this.dragStart.y, end.y);
      
      const rawW = Math.abs(end.x - this.dragStart.x);
      const rawH = Math.abs(end.y - this.dragStart.y);
      const w = rawW < 4 ? 4 : rawW;
      const h = rawH < 4 ? 4 : rawH;

      if (this.activeTool === 'window') {
        if (!this.map.windows) this.map.windows = [];
        this.map.windows.push({
          x,
          y,
          w,
          h,
          color: this.windowSettings.color,
          borderColor: this.windowSettings.borderColor,
          isSolid: true
        });
      } else {
        this.map.walls.push({
          x,
          y,
          w,
          h,
          color: this.wallSettings.color,
          borderColor: this.wallSettings.borderColor,
          isSolid: this.wallSettings.isSolid
        });
      }

      this.dragStart = null;
      this.saveWorkingCopy();
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.min(2.5, Math.max(0.2, this.camera.zoom * zoomFactor));

    this.camera.x = this.currentMouse.x - (this.currentMouse.x - this.camera.x) * (newZoom / this.camera.zoom);
    this.camera.y = this.currentMouse.y - (this.currentMouse.y - this.camera.y) * (newZoom / this.camera.zoom);
    this.camera.zoom = newZoom;
  }

  handleKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selectedEntity) this.deleteSelectedEntity();
    }
  }

  selectEntityAt(x, y) {
    for (const sp of this.map.spawns) {
      if (Math.hypot(x - sp.x, y - sp.y) < 16) {
        this.selectedEntity = { type: 'spawn', ref: sp };
        this.updateInspector();
        return;
      }
    }
    for (const cr of this.map.crates) {
      if (Math.hypot(x - cr.x, y - cr.y) < 16) {
        this.selectedEntity = { type: 'crate', ref: cr };
        this.updateInspector();
        return;
      }
    }
    for (const w of this.map.walls) {
      if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
        this.selectedEntity = { type: 'wall', ref: w };
        this.updateInspector();
        return;
      }
    }
    if (this.map.windows) {
      for (const win of this.map.windows) {
        if (x >= win.x && x <= win.x + win.w && y >= win.y && y <= win.y + win.h) {
          this.selectedEntity = { type: 'window', ref: win };
          this.updateInspector();
          return;
        }
      }
    }
    this.selectedEntity = null;
    this.updateInspector();
  }

  deleteSelectedEntity() {
    if (!this.selectedEntity) return;
    const { type, ref } = this.selectedEntity;
    if (type === 'wall') this.map.walls = this.map.walls.filter(w => w !== ref);
    if (type === 'window') this.map.windows = (this.map.windows || []).filter(w => w !== ref);
    if (type === 'spawn') this.map.spawns = this.map.spawns.filter(s => s !== ref);
    if (type === 'crate') this.map.crates = this.map.crates.filter(c => c !== ref);
    this.selectedEntity = null;
    this.saveWorkingCopy();
    this.updateInspector();
  }

  updateInspector() {
    const body = document.getElementById('inspector-body');
    if (!body) return;

    if (!this.selectedEntity) {
      body.innerHTML = `
        <div style="color: #64748b; line-height: 1.5;">
          Click an object to configure attributes.<br><br>
          Middle-Click to Pan viewport.<br>
          Wheel to Zoom.
        </div>
      `;
      return;
    }

    const { type, ref } = this.selectedEntity;

    if (type === 'wall' || type === 'window') {
      const isWindow = type === 'window';
      body.innerHTML = `
        <div style="color: #ffb000; font-weight: bold; margin-bottom: 8px;">[${isWindow ? 'REINFORCED WINDOW' : 'THIN WALL'}]</div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <div>Position: ${ref.x}, ${ref.y}</div>
          <div>Size: ${ref.w}px × ${ref.h}px</div>
          
          <label style="margin-top: 6px;">Color / Tint:</label>
          <input type="color" id="inspect-elem-color" value="${ref.borderColor || (isWindow ? '#38bdf8' : '#3d4754')}" style="width: 100%; height: 26px; border: 1px solid #14171c; background: transparent; cursor: pointer;">
          
          <label style="margin-top: 4px; display: flex; align-items: center; gap: 6px; cursor: pointer;">
            <input type="checkbox" id="inspect-elem-solid" ${ref.isSolid !== false ? 'checked' : ''}> Solid Collision
          </label>

          <button id="btn-del-inspect" class="btn secondary-btn small" style="margin-top: 10px; color: #ff4d4d; border-color: #552222;">Delete ${type}</button>
        </div>
      `;

      document.getElementById('inspect-elem-color')?.addEventListener('input', (e) => {
        ref.borderColor = e.target.value;
        if (isWindow) {
          ref.color = e.target.value + '33';
        } else {
          ref.color = e.target.value;
        }
        this.saveWorkingCopy();
      });
      document.getElementById('inspect-elem-solid')?.addEventListener('change', (e) => {
        ref.isSolid = e.target.checked;
        this.saveWorkingCopy();
      });
      document.getElementById('btn-del-inspect')?.addEventListener('click', () => this.deleteSelectedEntity());
    } else {
      body.innerHTML = `
        <div style="color: #ffb000; font-weight: bold; margin-bottom: 6px;">[${type.toUpperCase()}]</div>
        <div>X: ${ref.x}</div>
        <div>Y: ${ref.y}</div>
        <button id="btn-del-inspect" class="btn secondary-btn small" style="margin-top: 10px; color: #ff4d4d; border-color: #552222;">Delete Entity</button>
      `;
      document.getElementById('btn-del-inspect')?.addEventListener('click', () => this.deleteSelectedEntity());
    }
  }

  saveWorkingCopy() {
    this.map.tileData = this.tileCanvas.exportData();
    this.map.worldWidth = this.worldWidth;
    this.map.worldHeight = this.worldHeight;
    localStorage.setItem('br_custom_map', JSON.stringify(this.map));
  }

  getMapData() {
    this.map.tileData = this.tileCanvas.exportData();
    this.map.worldWidth = this.worldWidth;
    this.map.worldHeight = this.worldHeight;
    return this.map;
  }

  clear() {
    this.map.walls = [];
    this.map.windows = [];
    this.map.spawns = [];
    this.map.crates = [];
    this.tileCanvas.clear();
    this.selectedEntity = null;
    this.saveWorkingCopy();
    this.updateInspector();
  }

  loop() {
    if (!this.running) return;
    this.render();
    requestAnimationFrame(() => this.loop());
  }

  render() {
    const { ctx, canvas } = this;

    ctx.fillStyle = this.map.outOfBoundsColor || '#070a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(Math.round(this.camera.x), Math.round(this.camera.y));
    ctx.scale(this.camera.zoom, this.camera.zoom);

    // Arena Floor
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);

    // Grid
    if (this.gridSize > 0) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1 / this.camera.zoom;
      for (let x = 0; x <= this.worldWidth; x += this.gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, this.worldHeight);
        ctx.stroke();
      }
      for (let y = 0; y <= this.worldHeight; y += this.gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.worldWidth, y);
        ctx.stroke();
      }
    }

    // Painted Bitmap
    ctx.drawImage(this.tileCanvas.canvas, 0, 0);

    // Live Rectangular Tile Drag Fill Preview
    if (this.isMouseDown && this.activeTool === 'tile' && this.tileDragStart) {
      const end = this.snapTileCorner(this.currentMouse.worldX, this.currentMouse.worldY);
      const minX = Math.min(this.tileDragStart.x, end.x);
      const minY = Math.min(this.tileDragStart.y, end.y);
      const w = Math.max(this.tileSettings.size, Math.abs(end.x - this.tileDragStart.x));
      const h = Math.max(this.tileSettings.size, Math.abs(end.y - this.tileDragStart.y));

      ctx.fillStyle = this.tileSettings.isEraser ? 'rgba(255, 77, 77, 0.3)' : (this.tileSettings.color + '88');
      ctx.fillRect(minX, minY, w, h);
      ctx.strokeStyle = this.tileSettings.isEraser ? '#ff4d4d' : '#ffb000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(minX, minY, w, h);
    }

    // Thin Walls
    this.map.walls.forEach(w => {
      ctx.fillStyle = w.color || '#3d4754';
      ctx.fillRect(w.x, w.y, w.w, w.h);

      ctx.strokeStyle = (this.selectedEntity?.ref === w) ? '#ffb000' : (w.borderColor || '#191f27');
      ctx.lineWidth = (this.selectedEntity?.ref === w) ? 2 : 1;
      ctx.strokeRect(w.x, w.y, w.w, w.h);
    });

    // Windows
    if (this.map.windows) {
      this.map.windows.forEach(win => {
        ctx.fillStyle = win.color || 'rgba(64, 180, 255, 0.25)';
        ctx.fillRect(win.x, win.y, win.w, win.h);

        ctx.strokeStyle = (this.selectedEntity?.ref === win) ? '#ffb000' : (win.borderColor || '#38bdf8');
        ctx.lineWidth = (this.selectedEntity?.ref === win) ? 2 : 1.5;
        ctx.strokeRect(win.x, win.y, win.w, win.h);

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(win.x + 2, win.y + win.h - 2);
        ctx.lineTo(win.x + win.w - 2, win.y + 2);
        ctx.stroke();
      });
    }

    // Drag Preview for Walls & Windows
    if (this.isMouseDown && (this.activeTool === 'wall' || this.activeTool === 'window') && this.dragStart) {
      const cur = this.resolveCoordinate(this.currentMouse.worldX, this.currentMouse.worldY);
      const x = Math.min(this.dragStart.x, cur.x);
      const y = Math.min(this.dragStart.y, cur.y);
      const rawW = Math.abs(cur.x - this.dragStart.x);
      const rawH = Math.abs(cur.y - this.dragStart.y);
      const w = rawW < 4 ? 4 : rawW;
      const h = rawH < 4 ? 4 : rawH;

      const isWin = this.activeTool === 'window';
      ctx.fillStyle = isWin ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 176, 0, 0.25)';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = isWin ? '#38bdf8' : '#ffb000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
    }

    // Spawns
    this.map.spawns.forEach(s => {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#3cd446';
      ctx.fill();
      ctx.strokeStyle = (this.selectedEntity?.ref === s) ? '#fff' : '#000';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#000';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('P', s.x, s.y + 4);
    });

    // Crates
    this.map.crates.forEach(c => {
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(c.x - 12, c.y - 12, 24, 24);
      ctx.strokeStyle = (this.selectedEntity?.ref === c) ? '#fff' : '#78350f';
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - 12, c.y - 12, 24, 24);
    });

    // Magnet Snap
    if (this.magnetSnapPoint) {
      ctx.strokeStyle = '#00d2ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.magnetSnapPoint.x, this.magnetSnapPoint.y, 8, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Outer Boundary
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, this.worldWidth, this.worldHeight);

    ctx.restore();
  }
}