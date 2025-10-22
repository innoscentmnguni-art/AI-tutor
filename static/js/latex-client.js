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

  static async imageToCanvasTexture(img, width, height, opts = {}){
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,width,height);
    const imgW = (img.naturalWidth || img.width);
    const imgH = (img.naturalHeight || img.height);
    if (imgW > 0 && imgH > 0){
        const targetFraction = 0.48;
        const desiredHeight = Math.min(Math.floor(canvas.height * targetFraction), canvas.height - 8);
        const scale = desiredHeight / imgH;
        const drawW = Math.min(Math.floor(imgW * scale), canvas.width - 8);
        const drawH = Math.min(Math.floor(imgH * scale), canvas.height - 8);
        // left-align the rendered SVG with a small left margin (keep vertical centering)
        const leftMargin = (typeof opts.leftMargin === 'number') ? Math.max(0, Math.floor(opts.leftMargin)) : 4;
        const dx = leftMargin;
        const dy = Math.floor((canvas.height - drawH) / 2);
        // fill transparent background (expected) then draw left-aligned scaled image
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(img, 0, 0, imgW, imgH, dx, dy, drawW, drawH);
    } else {
      // fallback: stretch if we don't have intrinsic size
      ctx.drawImage(img, 0, 0, width, height);
    }
    const tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding; tex.needsUpdate = true; return tex;
  }

  // Public: latexToTexture using MathJax -> SVG -> Image -> CanvasTexture
  static async latexToTexture(latex, width = 512, height = 256, opts = {}){
    const MathJax = await MathJaxClient._ensureMathJax();
    if (!MathJax) throw new Error('MathJax not available');
      // Prefer using tex2svgPromise with em/ex options when a target character size is requested.
      // MathJax accepts em/ex options which scale the font metrics used in the generated SVG.
      let svg = null;
      const charSizePx = (opts && typeof opts.charSizePx === 'number') ? Math.max(1, Math.floor(opts.charSizePx)) : null;
      const display = (opts && typeof opts.display !== 'undefined') ? !!opts.display : true;
      try{
        if (charSizePx){
          const em = charSizePx;
          const ex = Math.max(1, Math.round(em * 0.5));
          const node = await MathJax.tex2svgPromise(String(latex || ''), { display: display, em: em, ex: ex });
          svg = node.getElementsByTagName && node.getElementsByTagName('svg') ? node.getElementsByTagName('svg')[0] : null;
        } else {
          // Default rendering
          const node = await MathJax.tex2svgPromise(String(latex || ''), { display: display });
          svg = node.getElementsByTagName && node.getElementsByTagName('svg') ? node.getElementsByTagName('svg')[0] : null;
        }
      } catch(e){
        // Do not attempt a fallback render here — surface the error to the caller.
        throw new Error('MathJax tex2svgPromise failed: ' + (e && e.message ? e.message : String(e)));
      }
    // Ensure SVG elements use a visible color for dark backgrounds.
    // Default color is white unless opts.color is provided.
    const color = (opts && opts.color) ? String(opts.color) : '#ffffff';
    // bold rendering control: by default make equations appear bolder to match canvas text weight
    const makeBold = (opts && typeof opts.bold !== 'undefined') ? !!opts.bold : true;
    const strokeWidth = (opts && typeof opts.strokeWidth !== 'undefined') ? String(opts.strokeWidth) : (makeBold ? '1.2' : '0');
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
                try{ el.setAttribute('stroke-width', strokeWidth); } catch(e){}
                try{ el.setAttribute('stroke-linejoin', 'round'); } catch(e){}
                try{ el.setAttribute('stroke-linecap', 'round'); } catch(e){}
            }
                // Also set attributes on the root svg
                try{ cloned.setAttribute('fill', color); } catch(e){}
                try{ cloned.setAttribute('stroke', color); } catch(e){}
                try{ cloned.setAttribute('stroke-width', strokeWidth); } catch(e){}
                try{ cloned.setAttribute('stroke-linejoin', 'round'); } catch(e){}
                try{ cloned.setAttribute('stroke-linecap', 'round'); } catch(e){}

            // Serialize the modified SVG
            var svgString = new XMLSerializer().serializeToString(cloned);
        } catch(e){
            // Fallback to original serialization if anything goes wrong
            var svgString = new XMLSerializer().serializeToString(svg);
        }
    const img = await MathJaxClient.svgStringToImage(svgString);
    // draw into texture sized to width/height (optionally scale preserving aspect)
    return MathJaxClient.imageToCanvasTexture(img, width, height, opts);
    }
}

const LatexClient = MathJaxClient;
export default LatexClient;
try{ if (typeof window !== 'undefined') window.latexClient = LatexClient; }catch(e){}