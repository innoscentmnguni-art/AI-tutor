// lipsync.js - Handles avatar mouth morphing using viseme data from backend
// Usage: import { playAudioWithLipSync } from './lipsync.js';

export async function playAudioWithLipSync(audioUrl, visemes, morphMesh, visemeMap) {
    const audio = new Audio(audioUrl);
    let startTime = null;
    let visemeIdx = 0;
    let animationFrameId = null;

    function setMorphTarget(visemeId) {
        if (!morphMesh || !morphMesh.morphTargetInfluences) return;
        for (let i = 0; i < morphMesh.morphTargetInfluences.length; i++) {
            morphMesh.morphTargetInfluences[i] = 0;
        }
        const morphIdx = visemeMap[visemeId];
        if (typeof morphIdx !== 'undefined') {
            morphMesh.morphTargetInfluences[morphIdx] = 1.0;
        }
    }

    function animateLipSync(now) {
        if (!startTime) startTime = now;
        const elapsed = now - startTime;
        while (visemeIdx < visemes.length - 1 && elapsed >= visemes[visemeIdx + 1].offset) {
            visemeIdx++;
        }
        setMorphTarget(visemes[visemeIdx].viseme_id);
        if (!audio.paused && !audio.ended) {
            animationFrameId = requestAnimationFrame(animateLipSync);
        } else {
            setMorphTarget(0);
        }
    }

    // Only start lip sync when audio actually starts playing
    audio.addEventListener('play', () => {
        startTime = performance.now();
        visemeIdx = 0;
        animationFrameId = requestAnimationFrame(animateLipSync);
    });
    audio.addEventListener('ended', () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        setMorphTarget(0);
    });
    // Wait for audio to be ready before playing
    await audio.play();
}
