import { playAudioWithLipSync } from './lipsync.js';
export const avatarEvents = new EventTarget();

// Theme toggle logic
document.addEventListener('DOMContentLoaded', function () {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const html = document.documentElement;
    const ttsForm = document.getElementById('tts-form');
    const ttsInput = ttsForm.querySelector('input');
    const ttsButton = ttsForm.querySelector('button');

    function setTheme(theme) {
        html.setAttribute('data-bs-theme', theme);
        if (theme === 'dark') {
            themeIcon.className = 'bi bi-moon';
            themeToggle.classList.remove('btn-outline-dark');
            themeToggle.classList.add('btn-outline-light');
        } else {
            themeIcon.className = 'bi bi-sun';
            themeToggle.classList.remove('btn-outline-light');
            themeToggle.classList.add('btn-outline-dark');
        }
    }

    if (localStorage.getItem('theme')) {
        setTheme(localStorage.getItem('theme'));
    }

    themeToggle.addEventListener('click', () => {
        const current = html.getAttribute('data-bs-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
        localStorage.setItem('theme', next);
    });

    // Handle text-to-speech
    let isPlaying = false;
    
    ttsButton.addEventListener('click', async () => {
        if (isPlaying) return;
        
        const text = ttsInput.value.trim();
        if (!text) return;
        
        try {
            isPlaying = true;
            ttsButton.disabled = true;
            
            console.log('Starting speech synthesis...');
            const response = await fetch('/synthesize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Use lipsync module if morph mesh and viseme map are available
                if (window.avatarMorphMesh && window.avatarVisemeMap) {
                    await playAudioWithLipSync(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap);
                } else {
                    // fallback: just play audio
                    const audio = new Audio(data.audio_url);
                    await audio.play();
                }
            } else {
                console.error('Failed to synthesize speech:', data.error);
            }
        } catch (error) {
            console.error('Error during speech synthesis:', error);
        } finally {
            isPlaying = false;
            ttsButton.disabled = false;
        }
    });
});
