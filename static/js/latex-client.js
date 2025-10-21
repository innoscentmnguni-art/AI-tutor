import * as THREE from 'three';

// MathJaxClient: renders LaTeX using MathJax (client-side) to a Three.js CanvasTexture
// This avoids font-loading taint issues because MathJax produces a complete SVG tree.
class MathJaxClient {
  static _loaded = false;
  static _configuring = false;

  static async _ensureMathJax(){
    if (MathJaxClient._loaded) return window.MathJax;
    if (MathJaxClient._configuring) {
      // wait until loaded
      await new Promise((res)=>{ const id = setInterval(()=>{ if (MathJaxClient._loaded) { clearInterval(id); res(); } }, 50); });
      return window.MathJax;
    }
    MathJaxClient._configuring = true;
    // inject MathJax UMD with minimal config
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-mathjax-umd]');
      if (existing){ existing.addEventListener('load', ()=> resolve()); existing.addEventListener('error', ()=> reject(new Error('MathJax load failed'))); return; }
      const config = document.createElement('script');
      config.type = 'text/javascript';
      config.text = `window.MathJax={loader:{load:['input/tex','output/svg']},tex:{inlineMath:[['$','$'],['\\(','\\)']]}};`;
      document.head.appendChild(config);
      const s = document.createElement('script');
      s.setAttribute('data-mathjax-umd','1');
      s.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
      s.async = true;
      s.onload = ()=> { MathJaxClient._loaded = true; MathJaxClient._configuring = false; resolve(); };
      s.onerror = ()=> { MathJaxClient._configuring = false; reject(new Error('MathJax failed to load')); };
      document.head.appendChild(s);
    });
    return window.MathJax;
  }

  static svgStringToImage(svgString){
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    return new Promise((resolve, reject)=>{
      const img = new Image();
      img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e)=>{ URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  static async imageToCanvasTexture(img, width, height){
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,width,height);
    ctx.drawImage(img, 0, 0, width, height);
    const tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding; tex.needsUpdate = true; return tex;
  }

  // Public: latexToTexture using MathJax -> SVG -> Image -> CanvasTexture
  static async latexToTexture(latex, width = 512, height = 256, opts = {}){
    const MathJax = await MathJaxClient._ensureMathJax();
    if (!MathJax) throw new Error('MathJax not available');
    // render to SVG node
    const node = await MathJax.tex2svgPromise(String(latex || ''), { display: true });
    // MathJax returns a document fragment; extract the SVG element
    const svg = node.getElementsByTagName && node.getElementsByTagName('svg') ? node.getElementsByTagName('svg')[0] : null;
    if (!svg) throw new Error('MathJax did not produce SVG');
    // Ensure SVG elements use a visible color for dark backgrounds.
    // Default color is white unless opts.color is provided.
    const color = (opts && opts.color) ? String(opts.color) : '#ffffff';
    try{
      // Operate on a cloned node to avoid mutating MathJax internals
      const cloned = svg.cloneNode(true);
      // Walk all elements and set fill/stroke to our chosen color.
      const all = cloned.querySelectorAll('*');
      for (const el of all){
        try{
          // Remove any external style that could reference fonts or urls
          el.removeAttribute('style');
        } catch(e){}
        try{ el.setAttribute('fill', color); } catch(e){}
        try{ el.setAttribute('stroke', color); } catch(e){}
      }
      // Also set attributes on the root svg
      try{ cloned.setAttribute('fill', color); } catch(e){}
      try{ cloned.setAttribute('stroke', color); } catch(e){}
      // Serialize the modified SVG
      var svgString = new XMLSerializer().serializeToString(cloned);
    } catch(e){
      // Fallback to original serialization if anything goes wrong
      var svgString = new XMLSerializer().serializeToString(svg);
    }
    const img = await MathJaxClient.svgStringToImage(svgString);
    // draw into texture sized to width/height (optionally scale preserving aspect)
    return MathJaxClient.imageToCanvasTexture(img, width, height);
  }

  static async debugRender(latex){
    const out = { ok: false, error: null, html: null };
    try{
      const MathJax = await MathJaxClient._ensureMathJax();
      const node = await MathJax.tex2svgPromise(String(latex || ''), { display: true });
      const svg = node.getElementsByTagName && node.getElementsByTagName('svg') ? node.getElementsByTagName('svg')[0] : null;
      if (svg){
        // Mirror the same coloring logic as latexToTexture so debugRender shows the final SVG
        const color = '#ffffff';
        try{
          const cloned = svg.cloneNode(true);
          const all = cloned.querySelectorAll('*');
          for (const el of all){ try{ el.removeAttribute('style'); }catch(e){} try{ el.setAttribute('fill', color); }catch(e){} try{ el.setAttribute('stroke', color); }catch(e){} }
          try{ cloned.setAttribute('fill', color); }catch(e){} try{ cloned.setAttribute('stroke', color); }catch(e){}
          out.html = new XMLSerializer().serializeToString(cloned);
        } catch(e){ out.html = new XMLSerializer().serializeToString(svg); }
      } else {
        out.html = null;
      }
      out.ok = !!out.html;
    } catch(e){ out.error = (e && e.message) ? e.message : String(e); }
    return out;
  }
}

const LatexClient = MathJaxClient;
export default LatexClient;
try{ if (typeof window !== 'undefined') window.latexClient = LatexClient; }catch(e){}