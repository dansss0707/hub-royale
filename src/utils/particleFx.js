export class AuraRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.particles = [];
    this.effectType = 'none';
    this.color = '#ffffff';
    this.animId = null;
    this.running = false;
    this.orbitAngle = 0;
  }

  setEffect(effectType, hexColor = '#ffffff') {
    this.effectType = effectType;
    this.color = hexColor;
    this.particles = [];
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    if (this.animId) cancelAnimationFrame(this.animId);
  }

  spawnParticle() {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    if (this.effectType === 'dust') {
      // Tiny floating dust motes drifting gently upward
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 80,
        y: cy + 30 + Math.random() * 20,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.45 - 0.2,
        size: Math.random() * 0.8 + 0.6,
        alpha: 0.8,
        fade: 0.008
      });
    } else if (this.effectType === 'sparks') {
      // Crisp micro-sparks popping outward
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 1.2 + 0.4;
      this.particles.push({
        x: cx + Math.cos(angle) * 35,
        y: cy + Math.sin(angle) * 35,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: Math.random() * 0.7 + 0.8,
        alpha: 1,
        fade: 0.03
      });
    } else if (this.effectType === 'embers') {
      // Soft glowing micro-cinders
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 50,
        y: cy + 40,
        vx: (Math.random() - 0.5) * 0.4,
        vy: -Math.random() * 0.9 - 0.4,
        size: Math.random() * 1.0 + 0.6,
        alpha: 0.9,
        fade: 0.015
      });
    }
  }

  loop() {
    if (!this.running) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    if (this.effectType === 'orbit') {
      // 3 subtle orbiting micro-dots
      this.orbitAngle += 0.035;
      const radius = 48;
      this.ctx.save();
      for (let i = 0; i < 3; i++) {
        const theta = this.orbitAngle + (i * Math.PI * 2) / 3;
        const ox = cx + Math.cos(theta) * radius;
        const oy = cy + Math.sin(theta) * (radius * 0.4);

        this.ctx.beginPath();
        this.ctx.arc(ox, oy, 1.4, 0, Math.PI * 2);
        this.ctx.fillStyle = this.color;
        this.ctx.shadowColor = this.color;
        this.ctx.shadowBlur = 4;
        this.ctx.fill();
      }
      this.ctx.restore();
    } else if (this.effectType !== 'none') {
      if (this.particles.length < 28 && Math.random() < 0.4) {
        this.spawnParticle();
      }

      this.ctx.save();
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.fade;

        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        this.ctx.fillStyle = this.color;
        this.ctx.shadowColor = this.color;
        this.ctx.shadowBlur = 3;
        this.ctx.globalAlpha = Math.max(0, p.alpha);
        this.ctx.fill();

        if (p.alpha <= 0) {
          this.particles.splice(i, 1);
        }
      }
      this.ctx.restore();
    }

    this.animId = requestAnimationFrame(() => this.loop());
  }
}