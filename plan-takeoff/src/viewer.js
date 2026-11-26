// The plan on screen: pdf.js renders the page into one canvas, highlights go
// on a second canvas laid over it, and the stage around them scrolls. Drag
// pans; a click that did not drag is reported in PDF user space so the
// calibration tool can use it.

export class Viewer {
  constructor({ stage, canvases, pageCanvas, overlay }) {
    this.stage = stage;
    this.canvases = canvases;
    this.pageCanvas = pageCanvas;
    this.overlay = overlay;
    this.page = null;
    this.zoom = 1;
    this.viewport = null;
    this.renderTask = null;
    this.highlight = null;
    this.markers = [];
    this.clickHandlers = [];
    this.dpr = window.devicePixelRatio || 1;
    this.#wirePan();
  }

  onClick(fn) { this.clickHandlers.push(fn); }

  fitZoom(page) {
    const base = page.getViewport({ scale: 1 });
    const avail = Math.max(200, this.stage.clientWidth - 2);
    return Math.max(0.05, avail / base.width);
  }

  maxZoom(page) {
    const base = page.getViewport({ scale: 1 });
    return Math.max(0.5, 8192 / (Math.max(base.width, base.height) * this.dpr));
  }

  async show(page, zoom) {
    this.page = page;
    this.zoom = Math.min(zoom, this.maxZoom(page));
    const viewport = page.getViewport({ scale: this.zoom });
    this.viewport = viewport;
    const dpr = this.dpr;
    for (const c of [this.pageCanvas, this.overlay]) {
      c.width = Math.floor(viewport.width * dpr);
      c.height = Math.floor(viewport.height * dpr);
      c.style.width = `${Math.floor(viewport.width)}px`;
      c.style.height = `${Math.floor(viewport.height)}px`;
    }
    if (this.renderTask) this.renderTask.cancel();
    const ctx = this.pageCanvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, this.pageCanvas.width, this.pageCanvas.height);
    this.renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    });
    try {
      await this.renderTask.promise;
    } catch (e) {
      if (!(e && e.name === 'RenderingCancelledException')) throw e;
      return;
    }
    this.drawOverlay();
  }

  /** Re-render at a new zoom, keeping the stage's centre on the same spot. */
  async setZoom(zoom) {
    if (!this.page) return;
    const st = this.stage;
    const cx = (st.scrollLeft + st.clientWidth / 2) / this.zoom;
    const cy = (st.scrollTop + st.clientHeight / 2) / this.zoom;
    await this.show(this.page, zoom);
    st.scrollLeft = cx * this.zoom - st.clientWidth / 2;
    st.scrollTop = cy * this.zoom - st.clientHeight / 2;
  }

  /** geom: { polylines: [[[x,y],...]], closed, fill, markers: [[x,y]] } or null */
  setHighlight(geom) {
    this.highlight = geom;
    this.drawOverlay();
  }

  setMarkers(points) {
    this.markers = points;
    this.drawOverlay();
  }

  drawOverlay() {
    const ctx = this.overlay.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.viewport) return;
    const t = this.viewport.transform;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
    const lw = 2 / this.zoom;

    const h = this.highlight;
    if (h) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = 'rgba(214, 65, 43, 0.95)';
      ctx.fillStyle = 'rgba(214, 65, 43, 0.18)';
      ctx.lineJoin = 'round';
      for (const pl of h.polylines) {
        if (pl.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(pl[0][0], pl[0][1]);
        for (let i = 1; i < pl.length; i++) ctx.lineTo(pl[i][0], pl[i][1]);
        if (h.closed) ctx.closePath();
        if (h.fill) ctx.fill();
        ctx.stroke();
      }
      if (h.markers) {
        const r = 9 / this.zoom;
        ctx.lineWidth = 1.5 / this.zoom;
        for (const [x, y] of h.markers) {
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    if (this.markers.length) {
      const r = 7 / this.zoom;
      ctx.lineWidth = 2 / this.zoom;
      ctx.strokeStyle = '#1f5f3a';
      for (const [x, y] of this.markers) {
        ctx.beginPath();
        ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
        ctx.moveTo(x, y - r); ctx.lineTo(x, y + r);
        ctx.stroke();
      }
      if (this.markers.length === 2) {
        ctx.setLineDash([4 / this.zoom, 3 / this.zoom]);
        ctx.beginPath();
        ctx.moveTo(this.markers[0][0], this.markers[0][1]);
        ctx.lineTo(this.markers[1][0], this.markers[1][1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Client coordinates → PDF user space. */
  toPdf(clientX, clientY) {
    const r = this.overlay.getBoundingClientRect();
    return this.viewport.convertToPdfPoint(clientX - r.left, clientY - r.top);
  }

  #wirePan() {
    const st = this.stage;
    let active = null;
    st.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      active = { x: e.clientX, y: e.clientY, sl: st.scrollLeft, st: st.scrollTop, moved: 0, id: e.pointerId };
      st.setPointerCapture(e.pointerId);
      st.classList.add('panning');
    });
    st.addEventListener('pointermove', (e) => {
      if (!active || e.pointerId !== active.id) return;
      const dx = e.clientX - active.x, dy = e.clientY - active.y;
      active.moved = Math.max(active.moved, Math.hypot(dx, dy));
      st.scrollLeft = active.sl - dx;
      st.scrollTop = active.st - dy;
    });
    const end = (e) => {
      if (!active || e.pointerId !== active.id) return;
      st.classList.remove('panning');
      const a = active;
      active = null;
      if (a.moved < 4 && this.viewport) {
        const pt = this.toPdf(e.clientX, e.clientY);
        for (const fn of this.clickHandlers) fn(pt);
      }
    };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
    st.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      this.setZoom(this.zoom * factor);
    }, { passive: false });
  }
}
