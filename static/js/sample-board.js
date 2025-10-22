import * as THREE from 'three';
import LatexClient from './latex-client.js';
import { createCanvasForText, canvasToTexture, safeDisposeTexture, createTextTexture } from './texture-utils.js';

// SampleBoard: encapsulates a text board mesh, texture lifecycle, scroll handlers, and drawing helpers
export default class SampleBoard {
    constructor({ scene, rendererDom, modelObject, positionOffset = new THREE.Vector3(80,80,-45), boardWidth = 130, boardHeight = 65, texWidth = 2048, texHeight = 1024 }){
        this.scene = scene;
        this.rendererDom = rendererDom;
        this.modelObject = modelObject;
        this.positionOffset = positionOffset.clone ? positionOffset.clone() : new THREE.Vector3(80,80,-45);
        this.boardWidth = boardWidth;
        this.boardHeight = boardHeight;
        this.texWidth = texWidth;
        this.texHeight = texHeight;

        this._sampleTextBoard = null; // mesh
        this._sampleBoardScrollY = 0;
        this._sampleBoardContentHeight = 0;
        this._sampleBoardCanvasHeight = 0;
        this._lastSampleText = '';
        this._lastUseLatex = false;
        this._lastInlineCss = '';
        this._mode = 'text'; // 'text' | 'instructions'
        this._lastInstructions = null;
        this._redrawScheduled = false;

        this._listeners = [];

        this._createMesh();
        this._attachInputHandlers();
    // Expose instance for debugging and programmatic control
    try{ if (typeof window !== 'undefined') window.sampleBoard = this; } catch(e){}
    }

    _createMesh(){
        const initialText = 'Welcome\nMy name is Nova\nwhat would you like to learn today';
        const sampleTex = this._createTextTexture(initialText, this.texWidth, this.texHeight, this._sampleBoardScrollY);
        const boardMat = new THREE.MeshBasicMaterial({ map: sampleTex, transparent: true, side: THREE.DoubleSide });
        boardMat.depthTest = true;
        const boardGeo = new THREE.PlaneGeometry(this.boardWidth, this.boardHeight);
        const boardMesh = new THREE.Mesh(boardGeo, boardMat);
        boardMesh.name = 'sampleTextBoard';
        const modelWorldPos = new THREE.Vector3();
        this.modelObject.getWorldPosition(modelWorldPos);
        boardMesh.position.copy(modelWorldPos).add(this.positionOffset);
        this.scene.add(boardMesh);
        this._sampleTextBoard = boardMesh;
    }

  // create canvas and return texture and heights
  _createCanvasForText(text, width = 1024, height = 512, yOffset = 0){
    return createCanvasForText(text, width, height, yOffset);
  }

  // Compute a desired height for a LaTeX element based on content heuristics.
  // Rules (applied as multiplicative increases on a base height):
  // - fraction ("/" or "\\dfrac" / "\\frac" syntax) => +50%
  // - integral ("\\int") => +10%
  // - script (superscript/subscript: "^" or "_" with braces or direct) => +5%
  // - root (\\sqrt or \\root) => +5%
  // If el.height is explicitly provided, use it as the base before adjustments.
  _computeLatexHeight(el, texHeight){
    const base = (typeof el.height === 'number') ? Math.max(8, Math.floor(el.height)) : Math.floor(texHeight * 0.15);
    const s = String(el.latex || '');
    let factor = 1.0;

    // Fraction detection: explicit \frac or \dfrac or slash with digits/variables either side
    const fracRegex = /\\d?frac\s*\{|\\frac\s*\{|\b\d+\s*\/\s*\d+|\w\s*\/\s*\w/;
    if (fracRegex.test(s)) factor += 0.85; // +85%

  // Integral detection: match common LaTeX integral commands (\int, \iint, \iiint, \oint, \oiint)
  // and the Unicode integral symbol (∫). We don't require a word boundary because integrals often
  // have subscripts/superscripts (e.g. \int_0^1).
  const intRegex = /(?:\\int|\\iint|\\iiint|\\oint|\\oiint|∫)/;
  if (intRegex.test(s)) factor += 1.10; // +110%

  // Script detection: superscript markers (^)
  const scriptRegex = /\^\s*(?:\{[^}]+\}|[A-Za-z0-9])/;
    if (scriptRegex.test(s)) factor += 0.05; // +5%

    // Root detection: \sqrt or \root
    const rootRegex = /\\sqrt\b|\\root\b/;
    if (rootRegex.test(s)) factor += 0.05; // +5%

    // Clamp final height to reasonable bounds
    const finalH = Math.max(8, Math.min(2048, Math.round(base * factor)));
    return finalH;
  }

  // Compose a sequence of elements (text or latex) into one combined texture.
  // elements: [{ type: 'text', text: '...', x?:number }, { type: 'latex', latex: '...', width?:number, height?:number, x?:number }, ...]
  // Order of elements is preserved. Each element is rendered to its own canvas then stacked vertically with small spacing.
  async updateCombined(elements = [], texWidth = this.texWidth, texHeight = this.texHeight){
    if (!this._sampleTextBoard) return;
    if (!Array.isArray(elements)) return;
    // cache for redraw/scroll
    this._mode = 'combined';
    try{ this._lastCombinedElements = JSON.parse(JSON.stringify(elements)); } catch(e){ this._lastCombinedElements = elements; }
  // reduce spacing slightly (approx 10% smaller than previous 12)
  const spacing = 0;
    const elementCanvases = [];
    // Render each element to its own canvas and compute heights
    for (const el of elements){
      if (!el) continue;
      if (el.type === 'text'){
        const text = String(el.text || '');
        // Use _createCanvasForText to layout text within texWidth x texHeight; it returns contentHeight
        const { canvas: textCanvas, contentHeight } = this._createCanvasForText(text, texWidth, texHeight, 0);
        // crop to content height
        const cropH = Math.max( Math.min(contentHeight, textCanvas.height), 1 );
        const outCanvas = document.createElement('canvas'); outCanvas.width = texWidth; outCanvas.height = cropH;
        const outCtx = outCanvas.getContext('2d'); outCtx.clearRect(0,0,outCanvas.width,outCanvas.height);
        outCtx.drawImage(textCanvas, 0, 0, texWidth, cropH, 0, 0, texWidth, cropH);
        elementCanvases.push({ canvas: outCanvas, x: (typeof el.x === 'number') ? el.x : 0, height: outCanvas.height });
      } else if (el.type === 'latex'){
        const latex = String(el.latex || '');
        // choose render height for latex element (may be adjusted based on content)
        const desiredH = this._computeLatexHeight(el, texHeight);
        const desiredW = (typeof el.width === 'number') ? el.width : texWidth;
        try{
          const opts = {};
          
          // pass inlineCss if present
          if (el.inlineCss) opts.inlineCss = el.inlineCss;
          if (typeof el.charSizePx === 'number') {
            opts.charSizePx = Math.max(8, Math.floor(el.charSizePx));
          } else {
            opts.charSizePx = Math.max(12, Math.floor(texHeight * 0.09));
          }
          // ensure display math by default
          opts.display = (typeof el.display === 'boolean') ? el.display : true;
          const tex = await LatexClient.latexToTexture(latex, desiredW, desiredH, opts);
          // CanvasTexture.image should be the canvas used to create the texture
          const imgCanvas = tex && tex.image ? tex.image : null;
          if (imgCanvas && imgCanvas instanceof HTMLCanvasElement){
            elementCanvases.push({ canvas: imgCanvas, x: (typeof el.x === 'number') ? el.x : 0, height: imgCanvas.height });
          } else {
            // fallback: render latex source as plain text
            const fallback = document.createElement('canvas'); fallback.width = texWidth; fallback.height = Math.floor(texHeight * 0.06);
            const fctx = fallback.getContext('2d'); fctx.fillStyle = '#fff'; fctx.font = `${Math.floor(fallback.height * 0.9)}px "Times New Roman", Times, serif`; fctx.textBaseline = 'top'; fctx.fillText(latex, 0, 0);
            elementCanvases.push({ canvas: fallback, x: (typeof el.x === 'number') ? el.x : 0, height: fallback.height });
          }
        } catch(e){
          // on error, fallback to plain text canvas
          const fallback = document.createElement('canvas'); fallback.width = texWidth; fallback.height = Math.floor(texHeight * 0.06);
          const fctx = fallback.getContext('2d'); fctx.fillStyle = '#fff'; fctx.font = `${Math.floor(fallback.height * 0.9)}px "Times New Roman", Times, serif`; fctx.textBaseline = 'top'; fctx.fillText(latex, 0, 0);
          elementCanvases.push({ canvas: fallback, x: (typeof el.x === 'number') ? el.x : 0, height: fallback.height });
        }
      } else {
        // unknown type: ignore
      }
    }

  // compute combined height
    let totalHeight = 0;
    for (const ec of elementCanvases) totalHeight += ec.height + spacing;
    if (totalHeight <= 0) totalHeight = texHeight;
    // create stacked final canvas
    const stackedCanvas = document.createElement('canvas'); stackedCanvas.width = texWidth; stackedCanvas.height = totalHeight;
    const sctx = stackedCanvas.getContext('2d'); sctx.clearRect(0,0,stackedCanvas.width,stackedCanvas.height);
    let y = 0;
    for (const ec of elementCanvases){
      const drawX = ec.x || 0;
      sctx.drawImage(ec.canvas, 0, 0, ec.canvas.width, ec.canvas.height, drawX, y, ec.canvas.width, ec.height);
      y += ec.height + spacing;
    }

    // crop viewport canvas according to current scroll
    const viewY = Math.max(0, Math.min(this._sampleBoardScrollY || 0, Math.max(0, stackedCanvas.height - texHeight)));
    const viewportCanvas = document.createElement('canvas'); viewportCanvas.width = texWidth; viewportCanvas.height = texHeight;
    const vctx = viewportCanvas.getContext('2d'); vctx.clearRect(0,0,viewportCanvas.width,viewportCanvas.height);
    vctx.drawImage(stackedCanvas, 0, viewY, texWidth, texHeight, 0, 0, texWidth, texHeight);

    // convert to texture and apply
    const tex = this._canvasToTexture(viewportCanvas);
    const mat = this._sampleTextBoard.material; if (mat.map) this._safeDisposeTexture(mat.map); mat.map = tex; mat.needsUpdate = true;
    // update internal metrics for scrolling
    this._sampleBoardContentHeight = totalHeight;
    this._sampleBoardCanvasHeight = texHeight;
    console.log('updateCombined applied', { elements: elements.length, stackedHeight: stackedCanvas.height, viewY });
    // cache the stacked canvas so future scroll redraws can be fast (no re-layout/re-render)
    try { this._stackedCanvas = stackedCanvas; this._stackedCanvasWidth = texWidth; this._stackedCanvasHeight = totalHeight; } catch(e) { this._stackedCanvas = null; }
  }

  // Render viewport from a cached stacked canvas (fast path for scroll-only updates)
  _renderViewportFromStackedCanvas(){
    try{
      if (!this._stackedCanvas || !this._sampleTextBoard) return;
      const texWidth = this._stackedCanvasWidth || this.texWidth;
      const texHeight = this.texHeight;
      const maxViewY = Math.max(0, this._stackedCanvasHeight - texHeight);
      const viewY = Math.max(0, Math.min(this._sampleBoardScrollY || 0, maxViewY));
      const viewportCanvas = document.createElement('canvas'); viewportCanvas.width = texWidth; viewportCanvas.height = texHeight;
      const vctx = viewportCanvas.getContext('2d'); vctx.clearRect(0,0,viewportCanvas.width,viewportCanvas.height);
      vctx.drawImage(this._stackedCanvas, 0, viewY, texWidth, texHeight, 0, 0, texWidth, texHeight);
      const tex = this._canvasToTexture(viewportCanvas);
      const mat = this._sampleTextBoard.material; if (mat.map) this._safeDisposeTexture(mat.map); mat.map = tex; mat.needsUpdate = true;
    } catch(e){ console.warn('Fast viewport render failed, falling back to full redraw', e); this._stackedCanvas = null; this._redrawFromCache(); }
  }

  _canvasToTexture(canvas){ return canvasToTexture(canvas); }

  _safeDisposeTexture(tex){ return safeDisposeTexture(tex); }

  _createTextTexture(text, width = 1024, height = 512, yOffset = 0){
    const { texture, contentHeight, canvasHeight } = createTextTexture(text, width, height, yOffset);
    this._sampleBoardContentHeight = contentHeight;
    this._sampleBoardCanvasHeight = canvasHeight;
    return texture;
  }

  _attachInputHandlers(){
    try{
      const dom = this.rendererDom;
      const parent = dom && dom.parentElement ? dom.parentElement : null;
      const targets = [dom, parent].filter(Boolean);

      let isPointerDown = false; let lastPointerY = 0;

      // Move clamp logic to a method closure so other methods can use it too
      const clampScrollLocal = () => {
        const maxScroll = Math.max(0, (this._sampleBoardContentHeight || 0) - (this._sampleBoardCanvasHeight || 1));
        if (this._sampleBoardScrollY < 0) this._sampleBoardScrollY = 0;
        if (this._sampleBoardScrollY > maxScroll) this._sampleBoardScrollY = maxScroll;
      };

      const wheelHandler = (ev) => {
        try{
          // normalize delta across devices
          let delta = ev.deltaY || 0;
          if (ev.deltaMode === 1) delta *= 16; // line -> pixels approx
          else if (ev.deltaMode === 2) delta *= 100; // page -> large
          this._sampleBoardScrollY += delta * 0.6; clampScrollLocal();
          this._scheduleRedraw();
          if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        }catch(e){ console.warn('wheelHandler error', e); }
      };

      const down = (ev) => { isPointerDown = true; lastPointerY = (ev.clientY || ev.pageY || (ev.touches && ev.touches[0] && ev.touches[0].clientY) || 0); try{ ev.pointerId && dom.setPointerCapture && dom.setPointerCapture(ev.pointerId); }catch(e){} };
      const move = (ev) => { try{ if (!isPointerDown) return; const curY = (ev.clientY || ev.pageY || (ev.touches && ev.touches[0] && ev.touches[0].clientY) || 0); const dy = lastPointerY - curY; lastPointerY = curY; this._sampleBoardScrollY += dy; clampScrollLocal(); this._scheduleRedraw(); }catch(e){} };
      const up = (ev) => { isPointerDown = false; try{ ev.pointerId && dom.releasePointerCapture && dom.releasePointerCapture(ev.pointerId); }catch(e){} };
      const cancel = (ev) => { isPointerDown = false; try{ ev.pointerId && dom.releasePointerCapture && dom.releasePointerCapture(ev.pointerId); }catch(e){} };

      // Attach listeners to both the renderer DOM and its parent (some browsers route wheel/pointer to parent)
      for (const el of targets){
        try{ el.addEventListener('wheel', wheelHandler, { passive: false }); }catch(e){ el.addEventListener('wheel', wheelHandler); }
        el.addEventListener('pointerdown', down);
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', cancel);

        this._listeners.push({ el: el, type: 'wheel', fn: wheelHandler, opts: { passive: false } });
        this._listeners.push({ el: el, type: 'pointerdown', fn: down });
        this._listeners.push({ el: el, type: 'pointermove', fn: move });
        this._listeners.push({ el: el, type: 'pointerup', fn: up });
        this._listeners.push({ el: el, type: 'pointercancel', fn: cancel });
      }

      // public scroll helpers for debugging and programmatic control
      this._clampScroll = clampScrollLocal;
      this.scrollBy = (dy) => { this._sampleBoardScrollY += Number(dy || 0); this._clampScroll(); this._scheduleRedraw(); };
      this.scrollTo = (y) => { this._sampleBoardScrollY = Number(y || 0); this._clampScroll(); this._scheduleRedraw(); };
      try{ if (typeof window !== 'undefined'){ window.scrollSampleBoardBy = (dy)=> { try{ this.scrollBy(dy); }catch(e){} }; window.scrollSampleBoardTo = (y)=> { try{ this.scrollTo(y); }catch(e){} }; } }catch(e){}
    } catch(e){ console.warn('Failed to attach sample board handlers', e); }
  }

  _scheduleRedraw(){
    if (this._redrawScheduled) return; this._redrawScheduled = true;
    requestAnimationFrame(()=>{ this._redrawScheduled = false; this._redrawFromCache(); });
  }

  _redrawFromCache(){
    try{
      if (!this._sampleTextBoard) return;
      if (this._mode === 'instructions' && this._lastInstructions){
        // re-run drawInstructions with cached instructions
        this.drawInstructions(this._lastInstructions, this.texWidth, this.texHeight);
      } else if (this._mode === 'combined' && this._lastCombinedElements){
        // Fast path: if we have a cached stacked canvas, render the viewport only (avoids re-rendering latex/images)
        if (this._stackedCanvas) {
          this._renderViewportFromStackedCanvas();
        } else {
          // fallback to full re-render when no cached stacked canvas exists
          this.updateCombined(this._lastCombinedElements, this.texWidth, this.texHeight);
        }
      } else {
        // text mode
        this.updateText(this._lastSampleText, this.texWidth, this.texHeight, { useLatex: !!this._lastUseLatex, inlineCss: this._lastInlineCss });
      }
    } catch(e){ console.warn('Error during redraw from cache', e); }
  }

  async updateText(text, texWidth = this.texWidth, texHeight = this.texHeight, opts = {}){
    if (!this._sampleTextBoard) return;
    this._lastSampleText = text;
    // cache mode for redraws
    this._mode = 'text';
    this._lastUseLatex = !!opts.useLatex;
    this._lastInlineCss = opts.inlineCss || '';
    let newTex;
    if (opts.useLatex){
      try{ newTex = await LatexClient.latexToTexture(text, texWidth, texHeight, opts.inlineCss || ''); }
      catch(e){ console.warn('LatexClient failed, falling back to canvas', e); newTex = this._createTextTexture(text, texWidth, texHeight, this._sampleBoardScrollY); }
    } else {
      newTex = this._createTextTexture(text, texWidth, texHeight, this._sampleBoardScrollY);
    }
    const mat = this._sampleTextBoard.material; if (mat.map) this._safeDisposeTexture(mat.map); mat.map = newTex; mat.needsUpdate = true;
  }

  async drawInstructions(instructions, texWidth = this.texWidth, texHeight = this.texHeight){
    if (!this._sampleTextBoard) return;
    // cache for redraws
    this._mode = 'instructions';
    try{ this._lastInstructions = JSON.parse(JSON.stringify(instructions)); }catch(e){ this._lastInstructions = instructions; }
    const yOffset = (this._sampleBoardScrollY && Number(this._sampleBoardScrollY)) ? Number(this._sampleBoardScrollY) : 0;
    const canvas = document.createElement('canvas'); canvas.width = texWidth; canvas.height = texHeight; const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,texWidth,texHeight);
    for (const ins of instructions){
      if (ins.type === 'text'){
        ctx.fillStyle = ins.color || '#fff'; ctx.font = ins.font || `${Math.floor(texHeight * 0.04)}px sans-serif`; ctx.textAlign = ins.align || 'left'; ctx.textBaseline = ins.baseline || 'top'; ctx.fillText(ins.text, ins.x || 0, (ins.y || 0) - yOffset);
      } else if (ins.type === 'image' && ins.url){
        try{ const img = await new Promise((res, rej)=>{ const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = ()=> res(i); i.onerror = rej; i.src = ins.url; }); const w = ins.width || img.width; const h = ins.height || img.height; ctx.drawImage(img, ins.x || 0, (ins.y || 0) - yOffset, w, h);} catch(e){ console.error('Failed to load instruction image', e); }
      } else if (ins.type === 'line'){ ctx.strokeStyle = ins.color || '#fff'; ctx.lineWidth = ins.width || 2; ctx.beginPath(); ctx.moveTo(ins.from[0], ins.from[1] - yOffset); ctx.lineTo(ins.to[0], ins.to[1] - yOffset); ctx.stroke(); }
    }
    const tex = this._canvasToTexture(canvas); const mat = this._sampleTextBoard.material; if (mat.map) this._safeDisposeTexture(mat.map); mat.map = tex; mat.needsUpdate = true; console.log('Drew instructions to board');
  }

  setOffset(x = 5, y = 5, z = 0){ if (!this._sampleTextBoard) return; const pos = new THREE.Vector3(); this.modelObject.getWorldPosition(pos); pos.add(new THREE.Vector3(x, y, z)); this._sampleTextBoard.position.copy(pos); }

  dispose(){
    // remove listeners
    for (const entry of this._listeners){ try{ entry.el.removeEventListener(entry.type, entry.fn, entry.opts); }catch(e){} }
    // dispose textures & geometry & material
    try{
      if (this._sampleTextBoard){
        const mat = this._sampleTextBoard.material; if (mat && mat.map) this._safeDisposeTexture(mat.map);
        if (mat) { try{ mat.dispose && mat.dispose(); }catch(e){} }
        try{ this._sampleTextBoard.geometry && this._sampleTextBoard.geometry.dispose(); }catch(e){}
        try{ this.scene.remove(this._sampleTextBoard); }catch(e){}
        this._sampleTextBoard = null;
      }
    } catch(e){ console.warn('Error disposing sample board', e); }
  }
}

// Global helper: forward wheel events to the sample board when pointer is over the board area.
try{
  if (typeof window !== 'undefined'){
    window.addEventListener('wheel', (ev) => {
      try{
        const sb = window.sampleBoard;
        if (!sb || !sb._sampleTextBoard || !sb.camera || !sb.rendererDom) return;
        // approximate hit test: project board center to screen and compute distance
        const rect = sb.rendererDom.getBoundingClientRect();
        const pos = new THREE.Vector3(); sb._sampleTextBoard.getWorldPosition(pos);
        const proj = pos.clone().project(sb.camera);
        const sx = (proj.x * 0.5 + 0.5) * rect.width + rect.left;
        const sy = (-proj.y * 0.5 + 0.5) * rect.height + rect.top;
        const dx = ev.clientX - sx; const dy = ev.clientY - sy;
        const distance = Math.sqrt(dx*dx + dy*dy);
        // if pointer is within ~200px of board center, forward it (tunable)
        if (distance < 300) {
          // normalize delta similar to wheelHandler
          let delta = ev.deltaY || 0;
          if (ev.deltaMode === 1) delta *= 16; else if (ev.deltaMode === 2) delta *= 100;
          if (sb && typeof sb.scrollBy === 'function') {
            sb.scrollBy(delta * 0.6);
            ev.preventDefault && ev.preventDefault();
          }
        }
      }catch(e){}
    }, { passive: false });
  }
}catch(e){}
