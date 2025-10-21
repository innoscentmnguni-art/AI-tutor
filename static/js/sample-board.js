import * as THREE from 'three';
import LatexClient from './latex-client.js';

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
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,width,height);
    ctx.fillStyle = '#fff';
    const fontSize = Math.floor(height * 0.08);
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const margin = Math.floor(height * 0.05); const maxWidth = width - (margin * 2);
    const lineHeight = fontSize * 1.2; const paragraphs = String(text).split('\n');
    let y = margin;
    for (const paragraph of paragraphs){
      const words = paragraph.split(' ');
      let line = '';
      for (const word of words){
        const testLine = line + (line ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && line){ ctx.fillText(line, margin, y - yOffset); line = word; y += lineHeight; }
        else { line = testLine; }
      }
      if (line){ ctx.fillText(line, margin, y - yOffset); y += lineHeight * 1.5; }
    }
    return { canvas, contentHeight: y, canvasHeight: height };
  }

  _canvasToTexture(canvas){
    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    tex.needsUpdate = true;
    return tex;
  }

  _safeDisposeTexture(tex){ try{ if (tex && typeof tex.dispose === 'function') tex.dispose(); } catch(e){} }

  _createTextTexture(text, width = 1024, height = 512, yOffset = 0){
    const { canvas, contentHeight, canvasHeight } = this._createCanvasForText(text, width, height, yOffset);
    this._sampleBoardContentHeight = contentHeight;
    this._sampleBoardCanvasHeight = canvasHeight;
    return this._canvasToTexture(canvas);
  }

  _attachInputHandlers(){
    try{
      const dom = this.rendererDom;
      let isPointerDown = false; let lastPointerY = 0;
      const clampScroll = () => {
        const maxScroll = Math.max(0, (this._sampleBoardContentHeight || 0) - (this._sampleBoardCanvasHeight || 1));
        if (this._sampleBoardScrollY < 0) this._sampleBoardScrollY = 0;
        if (this._sampleBoardScrollY > maxScroll) this._sampleBoardScrollY = maxScroll;
      };

      const wheelHandler = (ev) => {
        const delta = ev.deltaY; this._sampleBoardScrollY += delta * 0.6; clampScroll(); this._scheduleRedraw(); ev.preventDefault();
      };

      const down = (ev) => { isPointerDown = true; lastPointerY = ev.clientY; dom.setPointerCapture && dom.setPointerCapture(ev.pointerId); };
      const move = (ev) => { if (!isPointerDown) return; const dy = lastPointerY - ev.clientY; lastPointerY = ev.clientY; this._sampleBoardScrollY += dy; clampScroll(); this._scheduleRedraw(); };
      const up = (ev) => { isPointerDown = false; try{ dom.releasePointerCapture && dom.releasePointerCapture(ev.pointerId); }catch(e){} };

      dom.addEventListener('wheel', wheelHandler, { passive: false });
      dom.addEventListener('pointerdown', down); dom.addEventListener('pointermove', move); dom.addEventListener('pointerup', up);

      this._listeners.push({ el: dom, type: 'wheel', fn: wheelHandler, opts: { passive: false } });
      this._listeners.push({ el: dom, type: 'pointerdown', fn: down });
      this._listeners.push({ el: dom, type: 'pointermove', fn: move });
      this._listeners.push({ el: dom, type: 'pointerup', fn: up });
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
