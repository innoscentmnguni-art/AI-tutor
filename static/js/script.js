import { playAudioWithLipSync } from './lipsync.js';
export const avatarEvents = new EventTarget();

class AppController {
    constructor(){
        this.html = document.documentElement;
        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = document.getElementById('themeIcon');
        this.ttsForm = document.getElementById('tts-form');
        this.ttsInput = this.ttsForm ? this.ttsForm.querySelector('input') : null;
        this.ttsButton = this.ttsForm ? this.ttsForm.querySelector('button') : null;
        this.isPlaying = false;
    }

    init(){
        this._initTheme();
        this._bindThemeToggle();
        this._bindTTS();
    }

    _initTheme(){
        const stored = localStorage.getItem('theme');
        if (stored) this._applyTheme(stored);
    }

    _applyTheme(theme){
        this.html.setAttribute('data-bs-theme', theme);
        if (theme === 'dark'){
            this.themeIcon.className = 'bi bi-moon';
            this.themeToggle.classList.remove('btn-outline-dark');
            this.themeToggle.classList.add('btn-outline-light');
        } else {
            this.themeIcon.className = 'bi bi-sun';
            this.themeToggle.classList.remove('btn-outline-light');
            this.themeToggle.classList.add('btn-outline-dark');
        }
    }

    _bindThemeToggle(){
        if (!this.themeToggle) return;
        this.themeToggle.addEventListener('click', () => {
            const current = this.html.getAttribute('data-bs-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            this._applyTheme(next);
            localStorage.setItem('theme', next);
        });
    }

    _bindTTS(){
        if (!this.ttsButton || !this.ttsInput) return;
        this.ttsButton.addEventListener('click', () => this._onTtsClick());
    }

    async _onTtsClick(){
        if (this.isPlaying) return;
        const text = this.ttsInput.value.trim();
        if (!text) return;

        this.isPlaying = true;
        this.ttsButton.disabled = true;
        try {
            const response = await fetch('/synthesize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = await response.json();
            await this._handleTtsResponse(data);
        } catch (err){
            console.error('Error during speech synthesis:', err);
        } finally {
            this.isPlaying = false;
            this.ttsButton.disabled = false;
        }
    }

    async _handleTtsResponse(data){
        if (!data) return;
        if (data.success){
            if (data.board_text && window.updateSampleText){
                try { window.updateSampleText(data.board_text); } catch(e){ console.error('Failed to update board text', e); }
            }
            if (window.avatarMorphMesh && window.avatarVisemeMap){
                await playAudioWithLipSync(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap);
            } else {
                const audio = new Audio(data.audio_url);
                await audio.play();
            }
        } else {
            console.error('Failed to synthesize speech:', data.error);
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new AppController();
    app.init();
});
