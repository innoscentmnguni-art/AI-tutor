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
  const tex = new THREE.CanvasTexture(canvas);
  // compat for different Three.js versions
  try{ tex.encoding = THREE.sRGBEncoding; }catch(e){}
  tex.needsUpdate = true;
  return tex;
}

// Safely dispose of a texture if possible
export function safeDisposeTexture(tex){
  try{ if (tex && typeof tex.dispose === 'function') tex.dispose(); } catch(e){}
}

// Convenience wrapper: create canvas from text and return texture + metrics
export function createTextTexture(text, width = 1024, height = 512, yOffset = 0){
  const { canvas, contentHeight, canvasHeight } = createCanvasForText(text, width, height, yOffset);
  const tex = canvasToTexture(canvas);
  return { texture: tex, contentHeight, canvasHeight, canvas };
}
