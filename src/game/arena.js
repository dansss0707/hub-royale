import { supabase } from '../services/supabase.js';
import { showToast } from '../utils/helpers.js';

function lerp(start, end, factor) {
  return start + (end - start) * factor;
}

function lerpAngle(start, end, factor) {
  let diff = (end - start) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return start + diff * factor;
}

export class GameArena {
  constructor(canvas, room, user, profile) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.room = room;
    this.user = user;
    this.profile = profile || {};
    this.running = false;

    // Viewport & World Size
    this.customMap = null;
    const rawMap = localStorage.getItem('br_custom_map');
    if (rawMap) {
      try {
        this.customMap = JSON.parse(rawMap);
      } catch (e) {
        console.warn('Could not parse custom map in arena:', e);
      }
    }

    this.worldWidth = this.customMap?.worldWidth || 2400;
    this.worldHeight = this.customMap?.worldHeight || 1800;

    // Fast O(1) Lookup Set for Solid Micro-Tiles
    this.solidTileSet = new Set(this.customMap?.tileData?.solids || []);

    // 1. Resolve Player Spawn Point
    let startX = 600;
    let startY = 500;
    const placedSpawns = this.customMap?.spawns || [];

    if (placedSpawns.length > 0) {
      if (this.room?.members?.length > 1) {
        const memberIdx = this.room.members.findIndex(m => (m.user_id || m.id) === this.user?.id);
        const spawnIdx = Math.max(0, memberIdx) % placedSpawns.length;
        startX = placedSpawns[spawnIdx].x;
        startY = placedSpawns[spawnIdx].y;
      } else {
        const sp = placedSpawns[0];
        startX = sp.x;
        startY = sp.y;
      }
    }

    // 2. Resolve Equipped Skin
    const rawSkin = this.profile.equipped_skin || localStorage.getItem('br_custom_skin') || '';
    this.skinImage = null;
    if (rawSkin && (rawSkin.startsWith('http') || rawSkin.startsWith('data:image/'))) {
      this.skinImage = new Image();
      this.skinImage.src = rawSkin;
    }

    // 3. Resolve Micro-Tile Raster Layer
    this.tileImage = null;
    if (this.customMap?.tileData?.imageData) {
      this.tileImage = new Image();
      this.tileImage.src = this.customMap.tileData.imageData;
    }

    // 4. Initialize Windows
    this.windows = [];
    if (this.customMap?.windows && this.customMap.windows.length > 0) {
      this.windows = this.customMap.windows.map((w, idx) => ({
        id: `win_${idx}`,
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        health: 40,
        maxHealth: 40,
        shattered: false,
        color: w.color || 'rgba(64, 180, 255, 0.22)',
        borderColor: w.borderColor || '#38bdf8'
      }));
    }

    // 5. Local Player State
    this.player = {
      id: this.user?.id || 'local_player',
      name: this.profile.username || this.user?.user_metadata?.username || 'Player',
      x: startX,
      y: startY,
      radius: 9,
      angle: 0,
      speed: 2.5,
      health: 100,
      maxHealth: 100,
      shield: 50,
      maxShield: 100,
      isDead: false,
      activeSlot: 0,
      inventory: [
        { name: 'USP-Tactical', type: 'pistol', damage: 18, fireRate: 250, ammo: 12, maxAmmo: 12, totalAmmo: 48, lastShot: 0, color: '#ffb000' },
        { name: 'Crowbar', type: 'melee', damage: 35, fireRate: 400, range: 30, lastShot: 0, color: '#ff4d4d' },
        null,
        null,
        null
      ]
    };

    // Camera Configuration
    this.camera = {
      x: startX,
      y: startY,
      zoom: 1.75,
      followDelay: 0.038
    };

    // Input Tracking
    this.keys = {};
    this.mouse = { x: 0, y: 0, isDown: false, worldX: 0, worldY: 0 };

    // Game Entities
    this.bullets = [];
    this.particles = [];
    this.corpses = [];
    this.opponents = new Map();
    this.bots = [];

    // HUD / Combat Feedback Effects
    this.damageFlashAlpha = 0;
    this.hitIndicators = [];     // Incoming damage red arcs [{ angle, life, maxLife }]
    this.crosshairHitMarker = 0; // Crosshair tick flash timer

    // Crates
    this.crates = [];
    if (this.customMap?.crates && this.customMap.crates.length > 0) {
      this.crates = this.customMap.crates.map((c, idx) => ({
        id: `crate_${idx}`,
        x: c.x,
        y: c.y,
        w: 22,
        h: 22,
        opened: false,
        tier: c.tier || 'standard'
      }));
    }

    this.roundTimeRemaining = 180;
    this.timerInterval = null;
    this.channel = null;
    this.lastNetworkBroadcast = 0;

    // Line of sight cache
    this.visionPolygon = [];

    // Bind listeners
    this.boundResize = () => this.resize();
    this.boundKeyDown = (e) => this.handleKeyDown(e);
    this.boundKeyUp = (e) => this.handleKeyUp(e);
    this.boundMouseMove = (e) => this.handleMouseMove(e);
    this.boundMouseDown = (e) => this.handleMouseDown(e);
    this.boundMouseUp = (e) => this.handleMouseUp(e);
  }

  start() {
    this.running = true;
    this.resize();

    window.addEventListener('resize', this.boundResize);
    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);

    this.initNetworking();
    this.initBots();

    this.timerInterval = setInterval(() => {
      if (this.roundTimeRemaining > 0) {
        this.roundTimeRemaining--;
        const mins = Math.floor(this.roundTimeRemaining / 60);
        const secs = this.roundTimeRemaining % 60;
        const timerEl = document.getElementById('timer-val');
        if (timerEl) {
          timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
      }
    }, 1000);

    this.updateHUD();
    requestAnimationFrame((ts) => this.loop(ts));
  }

  stop() {
    this.running = false;
    if (this.timerInterval) clearInterval(this.timerInterval);

    window.removeEventListener('resize', this.boundResize);
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);

    if (this.channel) {
      supabase.removeChannel(this.channel);
      this.channel = null;
    }
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  initNetworking() {
    if (!this.room?.id) return;

    this.channel = supabase.channel(`arena_sync:${this.room.id}`, {
      config: { broadcast: { ack: false, self: false } }
    });

    this.channel
      .on('broadcast', { event: 'player_pos' }, ({ payload }) => {
        if (!payload || payload.id === this.player.id) return;

        let opp = this.opponents.get(payload.id);
        if (!opp) {
          const memberInfo = this.room?.members?.find(m => (m.user_id || m.id) === payload.id);
          const resolvedName = payload.name || 
                               memberInfo?.username || 
                               memberInfo?.profiles?.username || 
                               'Player';

          const skinUrl = payload.skinUrl || 
                          memberInfo?.skin_url || 
                          memberInfo?.profiles?.equipped_skin || 
                          '';

          opp = {
            id: payload.id,
            name: resolvedName,
            x: payload.x,
            y: payload.y,
            targetX: payload.x,
            targetY: payload.y,
            angle: payload.angle || 0,
            targetAngle: payload.angle || 0,
            health: payload.health ?? 100,
            isDead: false,
            radius: 9,
            skinUrl: skinUrl,
            skinImg: null
          };

          if (skinUrl) {
            opp.skinImg = new Image();
            opp.skinImg.src = skinUrl;
          }
          this.opponents.set(payload.id, opp);
        } else {
          if (payload.health <= 0 && !opp.isDead) {
            opp.isDead = true;
            this.spawnCorpse(opp.x, opp.y, opp.angle, opp.name, opp.skinImg);
          }

          opp.targetX = payload.x;
          opp.targetY = payload.y;
          opp.targetAngle = payload.angle;
          opp.health = payload.health;
        }
      })
      .on('broadcast', { event: 'player_fire' }, ({ payload }) => {
        if (!payload || payload.senderId === this.player.id) return;
        this.bullets.push({
          x: payload.x,
          y: payload.y,
          vx: payload.vx,
          vy: payload.vy,
          damage: payload.damage || 20,
          color: payload.color || '#ffb000',
          life: 140,
          ownerId: payload.senderId,
          startX: payload.startX || payload.x,
          startY: payload.startY || payload.y
        });
      })
      .on('broadcast', { event: 'crate_looted' }, ({ payload }) => {
        const crate = this.crates.find(c => c.id === payload.crateId);
        if (crate) crate.opened = true;
      })
      .on('broadcast', { event: 'window_hit' }, ({ payload }) => {
        const win = this.windows.find(w => w.id === payload.windowId);
        if (win) {
          win.health = payload.health;
          if (payload.shattered) {
            win.shattered = true;
            this.spawnGlassShards(win.x + win.w / 2, win.y + win.h / 2, 20);
          }
        }
      })
      .subscribe();
  }

  initBots() {
    if (this.room !== null && this.room !== undefined) {
      this.bots = [];
      return;
    }

    const botCount = 4;
    for (let i = 0; i < botCount; i++) {
      const angle = (i / botCount) * Math.PI * 2;
      const dist = 220 + Math.random() * 140;
      const botX = this.player.x + Math.cos(angle) * dist;
      const botY = this.player.y + Math.sin(angle) * dist;

      this.bots.push({
        id: `bot_${i}`,
        name: `Target_Dummy_${i + 1}`,
        x: botX,
        y: botY,
        angle: 0,
        speed: 1.2,
        health: 80,
        radius: 9,
        color: '#6e7f94',
        changeDirTimer: 0,
        fireTimer: 0,
        vx: 0,
        vy: 0
      });
    }
  }

  handleKeyDown(e) {
    this.keys[e.code] = true;
    if (e.code >= 'Digit1' && e.code <= 'Digit5') {
      const idx = parseInt(e.key, 10) - 1;
      if (this.player.inventory[idx]) {
        this.player.activeSlot = idx;
        this.updateHUD();
      }
    }
    if (e.code === 'KeyE') {
      this.interactClosestCrate();
    }
  }

  handleKeyUp(e) {
    this.keys[e.code] = false;
  }

  handleMouseMove(e) {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
  }

  handleMouseDown(e) {
    if (e.button === 0) this.mouse.isDown = true;
  }

  handleMouseUp(e) {
    if (e.button === 0) this.mouse.isDown = false;
  }

  interactClosestCrate() {
    for (const c of this.crates) {
      if (c.opened) continue;
      const dist = Math.hypot(this.player.x - c.x, this.player.y - c.y);
      if (dist < 45) {
        c.opened = true;
        this.spawnSparks(c.x, c.y, '#ffd700', 14);

        if (this.channel) {
          this.channel.send({
            type: 'broadcast',
            event: 'crate_looted',
            payload: { crateId: c.id }
          });
        }

        const roll = Math.random();
        if (roll < 0.35) {
          this.player.inventory[2] = { name: 'AR2 Pulse-Rifle', type: 'ar', damage: 24, fireRate: 110, ammo: 30, maxAmmo: 30, totalAmmo: 90, lastShot: 0, color: '#00d2ff' };
          this.player.activeSlot = 2;
          showToast('Picked up: AR2 Pulse-Rifle!', 'success');
        } else if (roll < 0.65) {
          this.player.inventory[3] = { name: 'SPAS-12', type: 'shotgun', damage: 14, fireRate: 650, ammo: 8, maxAmmo: 8, totalAmmo: 24, lastShot: 0, color: '#ffb000' };
          this.player.activeSlot = 3;
          showToast('Picked up: SPAS-12 Shotgun!', 'success');
        } else {
          this.player.shield = Math.min(this.player.maxShield, this.player.shield + 50);
          this.player.health = Math.min(this.player.maxHealth, this.player.health + 25);
          showToast('Restored Shield (+50) & Health (+25)!', 'success');
        }

        this.updateHUD();
        break;
      }
    }
  }

  spawnCorpse(x, y, angle, name, skinImg) {
    this.corpses.push({
      x,
      y,
      angle: angle + (Math.random() - 0.5) * 0.4,
      name,
      skinImg,
      bloodColor: '#8a1010'
    });
    this.spawnSparks(x, y, '#ff2222', 18);
  }

  loop(timestamp) {
    if (!this.running) return;

    this.update(timestamp);
    this.render();

    requestAnimationFrame((ts) => this.loop(ts));
  }

  update(timestamp) {
    if (this.damageFlashAlpha > 0) this.damageFlashAlpha = Math.max(0, this.damageFlashAlpha - 0.035);
    if (this.crosshairHitMarker > 0) this.crosshairHitMarker--;

    for (let i = this.hitIndicators.length - 1; i >= 0; i--) {
      this.hitIndicators[i].life--;
      if (this.hitIndicators[i].life <= 0) {
        this.hitIndicators.splice(i, 1);
      }
    }

    if (!this.player.isDead) {
      this.updateMovement();
      this.updateWeapons(timestamp);
    }

    this.updateOpponents();
    this.updateBullets();
    this.updateBots();
    this.updateCamera();
    this.updateVisionRays();

    if (timestamp - this.lastNetworkBroadcast > 40 && this.channel) {
      this.lastNetworkBroadcast = timestamp;
      this.channel.send({
        type: 'broadcast',
        event: 'player_pos',
        payload: {
          id: this.player.id,
          name: this.player.name,
          skinUrl: this.profile.equipped_skin || '',
          x: Math.round(this.player.x),
          y: Math.round(this.player.y),
          angle: Number(this.player.angle.toFixed(3)),
          health: this.player.health
        }
      });
    }
  }

  updateOpponents() {
    const lerpFactor = 0.28;

    this.opponents.forEach((opp) => {
      const dist = Math.hypot(opp.targetX - opp.x, opp.targetY - opp.y);
      if (dist > 180) {
        opp.x = opp.targetX;
        opp.y = opp.targetY;
        opp.angle = opp.targetAngle;
      } else {
        opp.x = lerp(opp.x, opp.targetX, lerpFactor);
        opp.y = lerp(opp.y, opp.targetY, lerpFactor);
        opp.angle = lerpAngle(opp.angle, opp.targetAngle, lerpFactor);
      }
    });
  }

  updateMovement() {
    let dx = 0;
    let dy = 0;

    if (this.keys['KeyW'] || this.keys['ArrowUp']) dy -= 1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dy += 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx -= 1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx += 1;

    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    const moveX = dx * this.player.speed;
    const moveY = dy * this.player.speed;

    this.player.x += moveX;
    if (this.checkWallCollision(this.player.x, this.player.y, this.player.radius)) {
      this.player.x -= moveX;
    }

    this.player.y += moveY;
    if (this.checkWallCollision(this.player.x, this.player.y, this.player.radius)) {
      this.player.y -= moveY;
    }

    this.player.x = Math.max(this.player.radius, Math.min(this.worldWidth - this.player.radius, this.player.x));
    this.player.y = Math.max(this.player.radius, Math.min(this.worldHeight - this.player.radius, this.player.y));

    // Mouse world coordinates mapped with camera translation and zoom
    const zoom = this.camera.zoom || 1.75;
    this.mouse.worldX = this.camera.x + (this.mouse.x - this.canvas.width / 2) / zoom;
    this.mouse.worldY = this.camera.y + (this.mouse.y - this.canvas.height / 2) / zoom;
    this.player.angle = Math.atan2(this.mouse.worldY - this.player.y, this.mouse.worldX - this.player.x);
  }

  checkWallCollision(x, y, radius) {
    if (this.customMap?.walls) {
      for (const w of this.customMap.walls) {
        if (w.isSolid === false) continue;
        if (
          x + radius > w.x &&
          x - radius < w.x + w.w &&
          y + radius > w.y &&
          y - radius < w.y + w.h
        ) {
          return true;
        }
      }
    }

    if (this.windows) {
      for (const win of this.windows) {
        if (win.shattered) continue;
        if (
          x + radius > win.x &&
          x - radius < win.x + win.w &&
          y + radius > win.y &&
          y - radius < win.y + win.h
        ) {
          return true;
        }
      }
    }

    if (this.solidTileSet && this.solidTileSet.size > 0) {
      const cs = 8;
      const minGX = Math.floor((x - radius) / cs);
      const maxGX = Math.floor((x + radius) / cs);
      const minGY = Math.floor((y - radius) / cs);
      const maxGY = Math.floor((y + radius) / cs);

      for (let gx = minGX; gx <= maxGX; gx++) {
        for (let gy = minGY; gy <= maxGY; gy++) {
          if (this.solidTileSet.has(`${gx},${gy}`)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  updateVisionRays() {
    const px = this.player.x;
    const py = this.player.y;
    const maxVision = 1200;

    const segments = [
      { a: { x: 0, y: 0 }, b: { x: this.worldWidth, y: 0 } },
      { a: { x: this.worldWidth, y: 0 }, b: { x: this.worldWidth, y: this.worldHeight } },
      { a: { x: this.worldWidth, y: this.worldHeight }, b: { x: 0, y: this.worldHeight } },
      { a: { x: 0, y: this.worldHeight }, b: { x: 0, y: 0 } }
    ];

    const points = [];

    if (this.customMap?.walls) {
      for (const w of this.customMap.walls) {
        if (w.isSolid === false) continue;
        if (Math.hypot(w.x + w.w / 2 - px, w.y + w.h / 2 - py) > maxVision + 400) continue;

        const p1 = { x: w.x, y: w.y };
        const p2 = { x: w.x + w.w, y: w.y };
        const p3 = { x: w.x + w.w, y: w.y + w.h };
        const p4 = { x: w.x, y: w.y + w.h };

        segments.push({ a: p1, b: p2 });
        segments.push({ a: p2, b: p3 });
        segments.push({ a: p3, b: p4 });
        segments.push({ a: p4, b: p1 });

        points.push(p1, p2, p3, p4);
      }
    }

    for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
      points.push({ x: px + Math.cos(a) * maxVision, y: py + Math.sin(a) * maxVision });
    }

    const angles = [];
    for (const p of points) {
      const angle = Math.atan2(p.y - py, p.x - px);
      angles.push(angle - 0.0001, angle, angle + 0.0001);
    }

    const poly = [];
    for (const angle of angles) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);

      let closestT = maxVision;
      let intersectPoint = null;

      for (const seg of segments) {
        const hit = this.raySegmentIntersection(px, py, dx, dy, seg.a.x, seg.a.y, seg.b.x, seg.b.y);
        if (hit && hit.t < closestT) {
          closestT = hit.t;
          intersectPoint = hit.p;
        }
      }

      if (intersectPoint) {
        poly.push({ angle, x: intersectPoint.x, y: intersectPoint.y });
      } else {
        poly.push({ angle, x: px + dx * maxVision, y: py + dy * maxVision });
      }
    }

    poly.sort((a, b) => a.angle - b.angle);
    this.visionPolygon = poly;
  }

  raySegmentIntersection(px, py, dx, dy, x1, y1, x2, y2) {
    const r_px = px;
    const r_py = py;
    const r_dx = dx;
    const r_dy = dy;

    const s_px = x1;
    const s_py = y1;
    const s_dx = x2 - x1;
    const s_dy = y2 - y1;

    const r_mag = Math.hypot(r_dx, r_dy);
    const s_mag = Math.hypot(s_dx, s_dy);

    if (r_dx / r_mag === s_dx / s_mag && r_dy / r_mag === s_dy / s_mag) {
      return null;
    }

    const T2 = (r_dx * (s_py - r_py) + r_dy * (r_px - s_px)) / (s_dx * r_dy - s_dy * r_dx);
    const T1 = (s_px + s_dx * T2 - r_px) / r_dx;

    if (T1 < 0) return null;
    if (T2 < 0 || T2 > 1) return null;

    return {
      t: T1,
      p: { x: r_px + r_dx * T1, y: r_py + r_dy * T1 }
    };
  }

  isPointInVision(tx, ty) {
    const px = this.player.x;
    const py = this.player.y;
    const dist = Math.hypot(tx - px, ty - py);
    if (dist > 1200) return false;
    if (dist < 30) return true;

    const dx = (tx - px) / dist;
    const dy = (ty - py) / dist;

    if (this.customMap?.walls) {
      for (const w of this.customMap.walls) {
        if (w.isSolid === false) continue;
        const p1 = { x: w.x, y: w.y };
        const p2 = { x: w.x + w.w, y: w.y };
        const p3 = { x: w.x + w.w, y: w.y + w.h };
        const p4 = { x: w.x, y: w.y + w.h };

        const edges = [
          [p1, p2], [p2, p3], [p3, p4], [p4, p1]
        ];

        for (const [a, b] of edges) {
          const hit = this.raySegmentIntersection(px, py, dx, dy, a.x, a.y, b.x, b.y);
          if (hit && hit.t < dist - 10) {
            return false;
          }
        }
      }
    }

    return true;
  }

  updateWeapons(timestamp) {
    if (!this.mouse.isDown) return;
    const weapon = this.player.inventory[this.player.activeSlot];
    if (!weapon) return;

    if (timestamp - weapon.lastShot < weapon.fireRate) return;
    weapon.lastShot = timestamp;

    if (weapon.type === 'melee') {
      const hitDist = weapon.range || 30;
      for (let j = this.bots.length - 1; j >= 0; j--) {
        const b = this.bots[j];
        const d = Math.hypot(b.x - this.player.x, b.y - this.player.y);
        if (d < hitDist + b.radius) {
          b.health -= weapon.damage;
          this.crosshairHitMarker = 12;
          this.spawnSparks(b.x, b.y, '#ff4d4d', 8);
          if (b.health <= 0) {
            this.spawnCorpse(b.x, b.y, b.angle, b.name, null);
            this.bots.splice(j, 1);
          }
          break;
        }
      }
      return;
    }

    const speed = 14;
    const spread = weapon.type === 'shotgun' ? 0.22 : 0.03;
    const pellets = weapon.type === 'shotgun' ? 5 : 1;

    for (let i = 0; i < pellets; i++) {
      const angleJitter = (Math.random() - 0.5) * spread;
      const angle = this.player.angle + angleJitter;
      const bullet = {
        x: this.player.x + Math.cos(angle) * (this.player.radius + 4),
        y: this.player.y + Math.sin(angle) * (this.player.radius + 4),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        damage: weapon.damage,
        color: weapon.color,
        life: 110,
        ownerId: this.player.id,
        startX: this.player.x,
        startY: this.player.y
      };
      this.bullets.push(bullet);

      if (this.channel) {
        this.channel.send({
          type: 'broadcast',
          event: 'player_fire',
          payload: {
            senderId: this.player.id,
            x: Math.round(bullet.x),
            y: Math.round(bullet.y),
            vx: Number(bullet.vx.toFixed(2)),
            vy: Number(bullet.vy.toFixed(2)),
            startX: Math.round(bullet.startX),
            startY: Math.round(bullet.startY),
            damage: bullet.damage,
            color: bullet.color
          }
        });
      }
    }

    this.player.x -= Math.cos(this.player.angle) * 1.0;
    this.player.y -= Math.sin(this.player.angle) * 1.0;
  }

  updateBullets() {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.x += b.vx;
      b.y += b.vy;
      b.life--;

      // 1. Windows
      for (const win of this.windows) {
        if (win.shattered) continue;
        if (
          b.x >= win.x && b.x <= win.x + win.w &&
          b.y >= win.y && b.y <= win.y + win.h
        ) {
          win.health -= b.damage;
          this.spawnGlassShards(b.x, b.y, 8);
          b.damage = Math.round(b.damage * 0.75);

          if (win.health <= 0) {
            win.shattered = true;
            this.spawnGlassShards(win.x + win.w / 2, win.y + win.h / 2, 24);
          }

          if (this.channel) {
            this.channel.send({
              type: 'broadcast',
              event: 'window_hit',
              payload: { windowId: win.id, health: win.health, shattered: win.shattered }
            });
          }
          break;
        }
      }

      // 2. Wall Collision
      if (this.checkWallCollision(b.x, b.y, 3)) {
        this.spawnSparks(b.x, b.y, '#ffb000', 5);
        this.bullets.splice(i, 1);
        continue;
      }

      if (b.life <= 0) {
        this.bullets.splice(i, 1);
        continue;
      }

      // 3. Damage Local Player
      if (b.ownerId !== this.player.id && !this.player.isDead) {
        const dist = Math.hypot(b.x - this.player.x, b.y - this.player.y);
        if (dist < this.player.radius) {
          // Calculate exact incoming threat angle from bullet source/trajectory
          let threatAngle;
          if (b.startX !== undefined && b.startY !== undefined) {
            threatAngle = Math.atan2(b.startY - this.player.y, b.startX - this.player.x);
          } else {
            threatAngle = Math.atan2(-b.vy, -b.vx);
          }

          this.damagePlayer(b.damage, threatAngle);
          this.spawnSparks(this.player.x, this.player.y, '#ff3333', 6);
          this.bullets.splice(i, 1);
          continue;
        }
      }

      // 4. Damage Bots
      if (b.ownerId === this.player.id) {
        for (let j = this.bots.length - 1; j >= 0; j--) {
          const bot = this.bots[j];
          const dist = Math.hypot(b.x - bot.x, b.y - bot.y);
          if (dist < bot.radius) {
            bot.health -= b.damage;
            this.crosshairHitMarker = 12; // Trigger crosshair hit tick on cursor
            this.spawnSparks(bot.x, bot.y, '#ffb000', 6);
            this.bullets.splice(i, 1);
            if (bot.health <= 0) {
              this.spawnCorpse(bot.x, bot.y, bot.angle, bot.name, null);
              this.bots.splice(j, 1);
            }
            break;
          }
        }
      }
    }
  }

  damagePlayer(amount, incomingAngle) {
    if (this.player.isDead) return;

    this.damageFlashAlpha = 0.65;

    // Register incoming directional hit indicator (points toward attacker)
    if (incomingAngle !== undefined) {
      this.hitIndicators.push({ angle: incomingAngle, life: 50, maxLife: 50 });
    }

    if (this.player.shield > 0) {
      if (this.player.shield >= amount) {
        this.player.shield -= amount;
      } else {
        const overflow = amount - this.player.shield;
        this.player.shield = 0;
        this.player.health -= overflow;
      }
    } else {
      this.player.health -= amount;
    }

    if (this.player.health <= 0) {
      this.player.health = 0;
      this.player.isDead = true;
      this.spawnCorpse(this.player.x, this.player.y, this.player.angle, this.player.name, this.skinImage);
      showToast('CRITICAL FAILURE: YOU WERE ELIMINATED', 'error');
    }

    this.updateHUD();
  }

  updateBots() {
    if (this.room !== null && this.room !== undefined) return;

    for (const b of this.bots) {
      b.changeDirTimer--;
      if (b.changeDirTimer <= 0) {
        b.changeDirTimer = 70 + Math.random() * 80;
        const angle = Math.random() * Math.PI * 2;
        b.vx = Math.cos(angle) * b.speed;
        b.vy = Math.sin(angle) * b.speed;
      }

      b.x += b.vx;
      if (this.checkWallCollision(b.x, b.y, b.radius)) {
        b.x -= b.vx;
        b.vx = -b.vx;
      }
      b.y += b.vy;
      if (this.checkWallCollision(b.x, b.y, b.radius)) {
        b.y -= b.vy;
        b.vy = -b.vy;
      }

      const dist = Math.hypot(this.player.x - b.x, this.player.y - b.y);
      if (dist < 380 && this.isPointInVision(b.x, b.y) && !this.player.isDead) {
        b.angle = Math.atan2(this.player.y - b.y, this.player.x - b.x);
        b.fireTimer++;
        if (b.fireTimer > 95) {
          b.fireTimer = 0;
          this.bullets.push({
            x: b.x + Math.cos(b.angle) * (b.radius + 3),
            y: b.y + Math.sin(b.angle) * (b.radius + 3),
            vx: Math.cos(b.angle) * 8.5,
            vy: Math.sin(b.angle) * 8.5,
            damage: 10,
            color: '#ff3333',
            life: 75,
            ownerId: b.id,
            startX: b.x,
            startY: b.y
          });
        }
      }
    }
  }

  updateCamera() {
    const targetX = this.player.x;
    const targetY = this.player.y;
    const delay = this.camera.followDelay || 0.038;
    this.camera.x += (targetX - this.camera.x) * delay;
    this.camera.y += (targetY - this.camera.y) * delay;
  }

  spawnSparks(x, y, color = '#ffb000', count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1 + Math.random() * 3.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 20 + Math.random() * 15,
        maxLife: 35,
        color
      });
    }
  }

  spawnGlassShards(x, y, count = 12) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 4;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 18 + Math.random() * 15,
        maxLife: 33,
        color: Math.random() > 0.5 ? '#38bdf8' : '#e0f2fe'
      });
    }
  }

  updateHUD() {
    const hpText = document.getElementById('hp-text');
    const hpBig = document.getElementById('hp-big');
    const hpFill = document.getElementById('hp-fill');
    if (hpText && hpBig && hpFill) {
      hpText.textContent = Math.round(this.player.health);
      hpBig.textContent = Math.round(this.player.health);
      hpFill.style.width = `${Math.max(0, (this.player.health / this.player.maxHealth) * 100)}%`;
    }

    const shieldText = document.getElementById('shield-text');
    const shieldBig = document.getElementById('shield-big');
    const shieldFill = document.getElementById('shield-fill');
    if (shieldText && shieldBig && shieldFill) {
      shieldText.textContent = Math.round(this.player.shield);
      shieldBig.textContent = Math.round(this.player.shield);
      shieldFill.style.width = `${Math.max(0, (this.player.shield / this.player.maxShield) * 100)}%`;
    }

    const invBar = document.getElementById('inventory-bar');
    if (invBar) {
      invBar.innerHTML = this.player.inventory.map((w, idx) => {
        const isCurrent = idx === this.player.activeSlot;
        if (!w) {
          return `
            <div class="gmod-panel" style="width: 52px; height: 50px; opacity: 0.3; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; color: #8b9bb0;">
              [${idx + 1}]
            </div>
          `;
        }
        return `
          <div class="gmod-panel" style="width: 82px; height: 50px; display: flex; flex-direction: column; justify-content: space-between; padding: 4px 6px; border-bottom: 3px solid ${isCurrent ? '#ffb000' : 'transparent'};">
            <div style="font-size: 0.6rem; color: #ffb000; display: flex; justify-content: space-between;">
              <span>[${idx + 1}]</span>
              <span>${w.ammo !== undefined ? `${w.ammo}/${w.totalAmmo}` : '∞'}</span>
            </div>
            <div style="font-size: 0.68rem; color: #fff; font-weight: bold; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${w.name}
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // --- RENDER ---
  render() {
    const { ctx, canvas } = this;
    if (!ctx) return;

    // 1. Out of Bounds Void Color
    ctx.fillStyle = this.customMap?.outOfBoundsColor || '#070a0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    
    // Zoom in anchored at screen center with smoothed camera translation
    const zoom = this.camera.zoom || 1.75;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-Math.round(this.camera.x), -Math.round(this.camera.y));

    // 2. Playable Arena Floor
    ctx.fillStyle = '#10141a';
    ctx.fillRect(0, 0, this.worldWidth, this.worldHeight);

    // 3. Grid Lines
    this.renderWorldGrid();

    // 4. Painted Micro-Tiles
    if (this.tileImage && this.tileImage.complete) {
      ctx.drawImage(this.tileImage, 0, 0);
    }

    // 5. Persistent Dead Corpses
    this.corpses.forEach(corp => {
      this.renderCorpse(corp);
    });

    // 6. Custom Thin Map Walls
    if (this.customMap?.walls) {
      this.customMap.walls.forEach(w => {
        ctx.fillStyle = w.color || '#3d4754';
        ctx.fillRect(w.x, w.y, w.w, w.h);

        ctx.strokeStyle = w.borderColor || '#191f27';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(w.x, w.y, w.w, w.h);
      });
    }

    // 7. Reinforced Glass Windows
    this.windows.forEach(win => {
      if (win.shattered) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(win.x, win.y, win.w, win.h);
        return;
      }

      ctx.fillStyle = win.color;
      ctx.fillRect(win.x, win.y, win.w, win.h);

      ctx.strokeStyle = win.borderColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(win.x, win.y, win.w, win.h);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(win.x + 2, win.y + win.h - 2);
      ctx.lineTo(win.x + win.w - 2, win.y + 2);
      ctx.stroke();
    });

    // 8. Crates
    this.crates.forEach(c => {
      if (c.opened) {
        ctx.fillStyle = '#2d333b';
        ctx.fillRect(c.x - 11, c.y - 11, 22, 22);
        ctx.strokeStyle = '#1a1f26';
        ctx.lineWidth = 1;
        ctx.strokeRect(c.x - 11, c.y - 11, 22, 22);
      } else {
        ctx.fillStyle = '#f59e0b';
        ctx.fillRect(c.x - 11, c.y - 11, 22, 22);
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x - 11, c.y - 11, 22, 22);

        const dist = Math.hypot(this.player.x - c.x, this.player.y - c.y);
        if (dist < 45 && !this.player.isDead) {
          ctx.fillStyle = '#ffb000';
          ctx.font = 'bold 10px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('[E] LOOT', c.x, c.y - 16);
        }
      }
    });

    // 9. Bullets
    this.bullets.forEach(b => {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = b.color || '#ffb000';
      ctx.shadowColor = b.color || '#ffb000';
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.shadowBlur = 0;
    });

    // 10. Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, 2, 2);
    }

    // 11. Bots (Filtered by LOS)
    this.bots.forEach(b => {
      if (!this.isPointInVision(b.x, b.y)) return;

      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);

      ctx.beginPath();
      ctx.arc(0, 0, b.radius, 0, Math.PI * 2);
      ctx.fillStyle = b.color;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#0f1318';
      ctx.fillRect(5, -2, 8, 4);

      ctx.restore();

      ctx.fillStyle = '#8b9bb0';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, b.x, b.y - 14);
    });

    // 12. Remote Opponents (Filtered by LOS)
    this.opponents.forEach(opp => {
      if (opp.isDead || !this.isPointInVision(opp.x, opp.y)) return;
      this.renderPlayerToken(opp.x, opp.y, opp.angle, opp.name, opp.skinImg, false);
    });

    // 13. Local Player
    if (!this.player.isDead) {
      this.renderPlayerToken(this.player.x, this.player.y, this.player.angle, this.player.name, this.skinImage, true);
    }

    // 14. Line-of-Sight Shroud
    this.renderVisionShroud();

    // 15. Outer Boundary Border
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, this.worldWidth, this.worldHeight);

    ctx.restore();

    // 16. SCREEN-SPACE HUD EFFECTS (Vignette, Accurate Hit Indicators, Crosshair Hitmarker)
    this.renderScreenVignette();
    this.renderHitIndicators();
    this.renderHitMarkerCrosshair();
  }

  // --- PERSISTENT CORPSE RENDERING ---
  renderCorpse(corp) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(corp.x, corp.y);
    ctx.rotate(corp.angle);

    ctx.fillStyle = 'rgba(110, 15, 15, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 12, corp.angle, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40, 48, 58, 0.75)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 24, 30, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = '#ff3333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4, -4);
    ctx.lineTo(4, 4);
    ctx.moveTo(4, -4);
    ctx.lineTo(-4, 4);
    ctx.stroke();

    ctx.restore();

    ctx.fillStyle = 'rgba(139, 155, 176, 0.5)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`† ${corp.name}`, corp.x, corp.y + 16);
  }

  // --- SCREEN-SPACE VIGNETTE ---
  renderScreenVignette() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;

    const maxDim = Math.max(w, h);
    const grad = ctx.createRadialGradient(w / 2, h / 2, maxDim * 0.32, w / 2, h / 2, maxDim * 0.75);

    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.7, 'rgba(0, 0, 0, 0.35)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const lowHpFactor = Math.max(0, (30 - this.player.health) / 30) * 0.35;
    const redAlpha = Math.min(0.8, this.damageFlashAlpha + lowHpFactor);

    if (redAlpha > 0) {
      const redGrad = ctx.createRadialGradient(w / 2, h / 2, maxDim * 0.28, w / 2, h / 2, maxDim * 0.72);
      redGrad.addColorStop(0, 'rgba(255, 0, 0, 0)');
      redGrad.addColorStop(0.65, `rgba(220, 20, 20, ${redAlpha * 0.4})`);
      redGrad.addColorStop(1, `rgba(180, 0, 0, ${redAlpha})`);

      ctx.fillStyle = redGrad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // --- ACCURATE DIRECTIONAL DAMAGE INDICATOR (POINTS TOWARD ATTACKER) ---
  renderHitIndicators() {
    const { ctx, canvas } = this;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = 95;

    this.hitIndicators.forEach(ind => {
      const alpha = ind.life / ind.maxLife;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ind.angle);

      // Arc facing the source of incoming fire
      ctx.beginPath();
      ctx.arc(0, 0, radius, -0.32, 0.32);
      ctx.strokeStyle = `rgba(255, 45, 45, ${alpha * 0.95})`;
      ctx.lineWidth = 4.5;
      ctx.shadowColor = '#ff2222';
      ctx.shadowBlur = 10;
      ctx.stroke();

      // Sharp directional triangle tip
      ctx.beginPath();
      ctx.moveTo(radius + 10, 0);
      ctx.lineTo(radius - 2, -6);
      ctx.lineTo(radius - 2, 6);
      ctx.closePath();
      ctx.fillStyle = `rgba(255, 60, 60, ${alpha})`;
      ctx.fill();

      ctx.restore();
    });
  }

  // --- HIT-MARKER TICKS ON THE CURSOR ---
  renderHitMarkerCrosshair() {
    if (this.crosshairHitMarker <= 0) return;
    const { ctx } = this;
    
    // Draw directly around the cursor's screen position
    const mx = this.mouse.x;
    const my = this.mouse.y;
    
    // Animate ticks popping outward when hit lands
    const animProgress = (12 - this.crosshairHitMarker) / 12;
    const gap = 4 + animProgress * 2;
    const size = 6;

    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#ffb000';
    ctx.shadowBlur = 6;

    ctx.beginPath();
    // Top-Left tick
    ctx.moveTo(mx - gap, my - gap);
    ctx.lineTo(mx - gap - size, my - gap - size);
    // Top-Right tick
    ctx.moveTo(mx + gap, my - gap);
    ctx.lineTo(mx + gap + size, my - gap - size);
    // Bottom-Left tick
    ctx.moveTo(mx - gap, my + gap);
    ctx.lineTo(mx - gap - size, my + gap + size);
    // Bottom-Right tick
    ctx.moveTo(mx + gap, my + gap);
    ctx.lineTo(mx + gap + size, my + gap + size);
    ctx.stroke();

    ctx.restore();
  }

  renderVisionShroud() {
    const { ctx } = this;
    if (!this.visionPolygon.length) return;

    ctx.save();

    ctx.beginPath();
    ctx.rect(0, 0, this.worldWidth, this.worldHeight);

    const poly = this.visionPolygon;
    ctx.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = 'rgba(7, 10, 15, 0.88)';
    ctx.fill('evenodd');

    ctx.restore();
  }

  renderPlayerToken(x, y, angle, name, img, isSelf) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = isSelf ? '#ffb000' : '#cbd5e1';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(name + (isSelf ? ' (You)' : ''), 0, -16);

    ctx.rotate(angle);

    ctx.fillStyle = '#1c222b';
    ctx.fillRect(4, -2, 9, 4);
    ctx.strokeStyle = '#ffb000';
    ctx.lineWidth = 1;
    ctx.strokeRect(4, -2, 9, 4);

    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.save();
    ctx.clip();

    if (img && img.complete && img.naturalWidth !== 0) {
      ctx.drawImage(img, -9, -9, 18, 18);
    } else {
      ctx.fillStyle = isSelf ? '#ffb000' : '#4b69ff';
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = isSelf ? '#ffb000' : '#36404d';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  renderWorldGrid() {
    const ctx = this.ctx;
    if (!ctx) return;

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
    ctx.lineWidth = 1;
    const step = 64;

    for (let x = 0; x < this.worldWidth; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.worldHeight);
      ctx.stroke();
    }
    for (let y = 0; y < this.worldHeight; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.worldWidth, y);
      ctx.stroke();
    }
  }
}