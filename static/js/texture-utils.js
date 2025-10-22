import * as THREE from 'three';

// Create a canvas and layout plain text into it. Returns canvas and measured heights.
export function createCanvasForText(text, width = 1024, height = 512, yOffset = 0){
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,width,height);
  ctx.fillStyle = '#fff';
  const fontSize = Math.floor(height * 0.08);
  ctx.font = `${fontSize}px "Times New Roman", Times, serif`;
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

// Convert canvas to a Three.js CanvasTexture
export function canvasToTexture(canvas){
  // Determine device pixel ratio and cap sizes for performance
  const DPR = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1;
  const MAX_DIM = 1536; // cap the larger dimension to this to avoid huge GPU textures

  // If canvas is larger than MAX_DIM, downscale before creating texture
  let srcCanvas = canvas;
  const w = canvas.width; const h = canvas.height;
  const maxSide = Math.max(w, h);
  if (maxSide > MAX_DIM) {
    const scale = MAX_DIM / maxSide;
    const small = document.createElement('canvas');
    small.width = Math.max(1, Math.round(w * scale));
    small.height = Math.max(1, Math.round(h * scale));
    const sctx = small.getContext('2d');
    sctx.clearRect(0,0,small.width, small.height);
    sctx.drawImage(canvas, 0, 0, w, h, 0, 0, small.width, small.height);
    srcCanvas = small;
  }

  const tex = new THREE.CanvasTexture(srcCanvas);
  // Disable mipmaps for crisp text and to reduce GPU memory/processing
  tex.generateMipmaps = false;
  try{ tex.encoding = THREE.sRGBEncoding; }catch(e){}
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Safely dispose of a texture if possible
export function safeDisposeTexture(tex){
  try{ if (tex && typeof tex.dispose === 'function') tex.dispose(); } catch(e){}
}

// Convenience wrapper: create canvas from text and return texture + metrics
export function createTextTexture(text, width = 1024, height = 512, yOffset = 0){
  // scale requested width/height by devicePixelRatio but cap to reasonable maximums
  const DPR = (typeof window !== 'undefined' && window.devicePixelRatio) ? Math.max(1, window.devicePixelRatio) : 1;
  const reqW = Math.max(1, Math.min(1536, Math.round(width * DPR)));
  const reqH = Math.max(1, Math.min(1536, Math.round(height * DPR)));
  const { canvas, contentHeight, canvasHeight } = createCanvasForText(text, reqW, reqH, yOffset);
  const tex = canvasToTexture(canvas);
  return { texture: tex, contentHeight, canvasHeight, canvas };
}
