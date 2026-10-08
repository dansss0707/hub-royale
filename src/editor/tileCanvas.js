/**
 * Offscreen bitmap layer for micro-tile painting.
 * Handles sub-pixel brush sizes down to 2px with solid vs non-solid collision layers,
 * continuous stroke painting, and rectangular drag-fill.
 */
export class TileCanvas {
  constructor(width = 2400, height = 1800) {
    this.width = width;
    this.height = height;

    // Visual canvas buffer
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    // Sparse set of solid tile coordinate keys: "gridX,gridY" at 8px resolution
    this.solidGrid = new Set();
    this.collisionCellSize = 8;
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.solidGrid.clear();
  }

  paint(x, y, size, color, isSolid = false, isEraser = false) {
    const half = size / 2;
    const startX = Math.floor(x - half);
    const startY = Math.floor(y - half);

    if (isEraser) {
      this.ctx.clearRect(startX, startY, size, size);
      this.removeSolids(startX, startY, size, size);
      return;
    }

    this.ctx.fillStyle = color;
    this.ctx.fillRect(startX, startY, size, size);

    if (isSolid) {
      this.markSolids(startX, startY, size, size);
    } else {
      this.removeSolids(startX, startY, size, size);
    }
  }

  paintStroke(x1, y1, x2, y2, size, color, isSolid = false, isEraser = false) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    const step = Math.max(1, size / 2);
    const count = Math.ceil(dist / step);

    for (let i = 0; i <= count; i++) {
      const t = count === 0 ? 0 : i / count;
      const curX = x1 + (x2 - x1) * t;
      const curY = y1 + (y2 - y1) * t;
      this.paint(curX, curY, size, color, isSolid, isEraser);
    }
  }

  paintRect(x1, y1, x2, y2, color, isSolid = false, isEraser = false) {
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const w = Math.abs(x2 - x1);
    const h = Math.abs(y2 - y1);

    if (w <= 0 || h <= 0) return;

    if (isEraser) {
      this.ctx.clearRect(minX, minY, w, h);
      this.removeSolids(minX, minY, w, h);
      return;
    }

    this.ctx.fillStyle = color;
    this.ctx.fillRect(minX, minY, w, h);

    if (isSolid) {
      this.markSolids(minX, minY, w, h);
    } else {
      this.removeSolids(minX, minY, w, h);
    }
  }

  markSolids(startX, startY, width, height) {
    const cs = this.collisionCellSize;
    const minGX = Math.floor(startX / cs);
    const maxGX = Math.floor((startX + width) / cs);
    const minGY = Math.floor(startY / cs);
    const maxGY = Math.floor((startY + height) / cs);

    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gy = minGY; gy <= maxGY; gy++) {
        this.solidGrid.add(`${gx},${gy}`);
      }
    }
  }

  removeSolids(startX, startY, width, height) {
    const cs = this.collisionCellSize;
    const minGX = Math.floor(startX / cs);
    const maxGX = Math.floor((startX + width) / cs);
    const minGY = Math.floor(startY / cs);
    const maxGY = Math.floor((startY + height) / cs);

    for (let gx = minGX; gx <= maxGX; gx++) {
      for (let gy = minGY; gy <= maxGY; gy++) {
        this.solidGrid.delete(`${gx},${gy}`);
      }
    }
  }

  isPointSolid(x, y) {
    const gx = Math.floor(x / this.collisionCellSize);
    const gy = Math.floor(y / this.collisionCellSize);
    return this.solidGrid.has(`${gx},${gy}`);
  }

  exportData() {
    return {
      imageData: this.canvas.toDataURL('image/png'),
      solids: Array.from(this.solidGrid)
    };
  }

  importData(data, callback) {
    if (!data) return;
    this.clear();

    if (data.solids) {
      this.solidGrid = new Set(data.solids);
    }

    if (data.imageData) {
      const img = new Image();
      img.onload = () => {
        this.ctx.drawImage(img, 0, 0);
        if (callback) callback();
      };
      img.src = data.imageData;
    }
  }
}

export default TileCanvas;