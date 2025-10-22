// lipsync.js - Handles avatar mouth morphing using viseme data from backend
// Usage: import { playAudioWithLipSync } from './lipsync.js';

function _resetMorphs(morphMesh){
    if (!morphMesh || !morphMesh.morphTargetInfluences) return;
    for (let i = 0; i < morphMesh.morphTargetInfluences.length; i++) morphMesh.morphTargetInfluences[i] = 0;
}

function _applyViseme(morphMesh, visemeMap, visemeId){
    if (!morphMesh || !morphMesh.morphTargetInfluences) return;
    _resetMorphs(morphMesh);
    const morphIdx = visemeMap[visemeId];
    if (typeof morphIdx !== 'undefined') morphMesh.morphTargetInfluences[morphIdx] = 1.0;
}

export async function playAudioWithLipSync(audioUrl, visemes, morphMesh, visemeMap, externalAudio){
    // If caller passes an external Audio element, use it; otherwise create our own.
    const audio = externalAudio || new Audio(audioUrl);
    let startTime = null;
    let visemeIdx = 0;
    let raf = null;
    // keep references to handlers so we can remove them
    const handlers = {
        play: null,
        ended: null,
    };

    function _advanceViseme(elapsed){
        while (visemeIdx < visemes.length - 1 && elapsed >= visemes[visemeIdx + 1].offset) visemeIdx++;
        _applyViseme(morphMesh, visemeMap, visemes[visemeIdx].viseme_id);
    }

    function _loop(now){
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        _advanceViseme(elapsed);
        if (!audio.paused && !audio.ended) {
            raf = requestAnimationFrame(_loop);
        } else {
            if (raf) { cancelAnimationFrame(raf); raf = null; }
            _applyViseme(morphMesh, visemeMap, 0);
        }
    }

    handlers.play = ()=>{
        // reset state and start RAF
        startTime = performance.now();
        visemeIdx = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(_loop);
    };
    handlers.ended = ()=>{
        if (raf) { cancelAnimationFrame(raf); raf = null; }
        _applyViseme(morphMesh, visemeMap, 0);
    };

    audio.addEventListener('play', handlers.play);
    audio.addEventListener('ended', handlers.ended);

    // remove handlers when audio is removed/garbage-collected by listening for pause as well
    const removeHandlers = () => {
        try { audio.removeEventListener('play', handlers.play); } catch(e){}
        try { audio.removeEventListener('ended', handlers.ended); } catch(e){}
        if (raf) { cancelAnimationFrame(raf); raf = null; }
    };
    // best-effort cleanup when page unloads
    window.addEventListener('unload', removeHandlers, { once: true });

    // If the caller provided an external Audio element, they will start playback.
    // Only start playback here when we created the audio internally.
    if (!externalAudio) {
        try {
            await audio.play();
        } catch(e) {
            // autoplay might be blocked; ensure handlers are cleaned up eventually
            setTimeout(() => { if (raf) cancelAnimationFrame(raf); }, 1000);
            throw e;
        }
    }
}
