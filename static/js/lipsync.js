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

    function _advanceViseme(elapsed){
        while (visemeIdx < visemes.length - 1 && elapsed >= visemes[visemeIdx + 1].offset) visemeIdx++;
        _applyViseme(morphMesh, visemeMap, visemes[visemeIdx].viseme_id);
    }

    function _loop(now){
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        _advanceViseme(elapsed);
        if (!audio.paused && !audio.ended) raf = requestAnimationFrame(_loop);
        else _applyViseme(morphMesh, visemeMap, 0);
    }

    audio.addEventListener('play', ()=>{
        startTime = performance.now();
        visemeIdx = 0;
        raf = requestAnimationFrame(_loop);
    });
    audio.addEventListener('ended', ()=>{
        if (raf) cancelAnimationFrame(raf);
        _applyViseme(morphMesh, visemeMap, 0);
    });

    // If the caller provided an external Audio element, they will start playback.
    // Only start playback here when we created the audio internally.
    if (!externalAudio) {
        await audio.play();
    }
}
