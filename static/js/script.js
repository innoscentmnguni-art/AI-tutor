// Utility: Wait for true end of audio (audio ended, then 1.5s of silence)
function waitForAudioTrueEnd(audio, minSilenceMs = 1500) {
    return new Promise((resolve) => {
        let silenceTimer = null;
        let resolved = false;
        function cleanup() {
            if (silenceTimer) clearTimeout(silenceTimer);
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('play', onPlay);
        }
        function onEnded() {
            // Start silence timer
            silenceTimer = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    cleanup();
                    resolve();
                }
            }, minSilenceMs);
        }
        function onPlay() {
            // If audio resumes, cancel silence timer
            if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
            }
        }
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('play', onPlay);
        // If already ended (very short audio), start timer immediately
        if (audio.ended) onEnded();
    });
}
import { playAudioWithLipSync } from './lipsync.js';
export const avatarEvents = new EventTarget();

class AppController {
    constructor(){
        this.html = document.documentElement;
        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = document.getElementById('themeIcon');
        this.ttsForm = document.getElementById('tts-form');
        this.ttsInput = document.getElementById('tts-input') || (this.ttsForm ? this.ttsForm.querySelector('input') : null);
        this.ttsSendButton = document.getElementById('tts-send-btn') || (this.ttsForm ? this.ttsForm.querySelector('button') : null);
        this.ttsMicButton = document.getElementById('tts-mic-btn');
        this.isPlaying = false;
        // Tracks whether AI request or avatar playback is in progress.
        this._promptInProgress = false;
    }

    init(){
        this._initTheme();
        this._bindThemeToggle();
        this._bindTTS();
        this._bindMicToggle();
        // Play onboarding greeting from server (Nova) before accepting user prompts
        this._fetchAndPlayGreeting();
    }

    async _fetchAndPlayGreeting(){
        // If the server provides a greeting, play it with lipsync and update the board text.
        try {
            this._promptInProgress = true;
            if (this.ttsSendButton) {
                this.ttsSendButton.disabled = true;
                this._setSendButtonSpinner(true);
            }
            const res = await fetch('/greeting');
            if (!res.ok) return;
            const data = await res.json();
            if (data.board_text && window.updateSampleText){
                try { window.updateSampleText(data.board_text); } catch(e){ console.error('Failed to update board text', e); }
            }
            if (data.audio_url){
                const audio = new Audio(data.audio_url);
                if (window.avatarMorphMesh && window.avatarVisemeMap){
                    // lipsync will use provided audio element when available
                    playAudioWithLipSync(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap, audio);
                }
                // start playback and wait for true end
                await audio.play();
                await waitForAudioTrueEnd(audio, 1500);
            }
        } catch (e){
            console.error('Error fetching/playing greeting:', e);
        } finally {
            if (this.ttsSendButton) {
                this.ttsSendButton.disabled = false;
                this._setSendButtonSpinner(false);
            }
            this._promptInProgress = false;
        }
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
        if (!this.ttsSendButton || !this.ttsInput) return;
        this.ttsSendButton.addEventListener('click', () => this._onTtsClick());
        // allow Enter key in input to send
        this.ttsInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this._onTtsClick();
            }
        });
    }

    _bindMicToggle(){
        if (!this.ttsMicButton) return;
        this.ttsMicButton.addEventListener('click', () => this._onMicToggle());
    }

    _onMicToggle(){
        // purely visual toggle for now: swap SVG inside the button between mic and mic-mute
        const isOn = this.ttsMicButton.getAttribute('aria-pressed') === 'true';
        const next = !isOn;
        this.ttsMicButton.setAttribute('aria-pressed', String(next));
        // replace innerHTML with the appropriate svg
        if (next){
            // mic on
            this.ttsMicButton.innerHTML = `\n                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mic-fill" viewBox="0 0 16 16">\n                              <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/>\n                              <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>\n                            </svg>`;
            this.ttsMicButton.classList.remove('btn-outline-light');
            this.ttsMicButton.classList.add('btn-outline-success');
        } else {
            // mic off (muted)
            this.ttsMicButton.innerHTML = `\n                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mic-mute-fill" viewBox="0 0 16 16">\n                              <path d="M13 8c0 .564-.094 1.107-.266 1.613l-.814-.814A4 4 0 0 0 12 8V7a.5.5 0 0 1 1 0zm-5 4c.818 0 1.578-.245 2.212-.667l.718.719a5 5 0 0 1-2.43.923V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 1 0v1a4 4 0 0 0 4 4m3-9v4.879L5.158 2.037A3.001 3.001 0 0 1 11 3"/>\n                              <path d="M9.486 10.607 5 6.12V8a3 3 0 0 0 4.486 2.607m-7.84-9.253 12 12 .708-.708-12-12z"/>\n                            </svg>`;
            this.ttsMicButton.classList.remove('btn-outline-success');
            this.ttsMicButton.classList.add('btn-outline-light');
        }
    }

    async _onTtsClick(){
        // Block sending if a prompt is already being processed (AI or playback)
            // If avatar is busy, ignore send (do nothing, no UI change)
                if (this._promptInProgress) return;
                const text = this.ttsInput.value.trim();
                if (!text) return;

                this._promptInProgress = true;
                // Show spinner and disable button while waiting for AI and speech
                if (this.ttsSendButton) {
                    this.ttsSendButton.disabled = true;
                    this._setSendButtonSpinner(true);
                }
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
                    // Only re-enable after speech truly ends
                    if (this.ttsSendButton) {
                        this.ttsSendButton.disabled = false;
                        this._setSendButtonSpinner(false);
                    }
                    this._promptInProgress = false;
                }
    }

    async _handleTtsResponse(data){
        if (!data) {
            if (this.ttsSendButton) this._setSendButtonSpinner(false);
            this._promptInProgress = false;
            return;
        }
        if (!data) {
            return;
        }
        if (data.success){
            if (data.board_text && window.updateSampleText){
                try { window.updateSampleText(data.board_text); } catch(e){ console.error('Failed to update board text', e); }
            }
            // Play speech (button is already re-enabled)
                // Play speech and only return after true end
                const audio = new Audio(data.audio_url);
                if (window.avatarMorphMesh && window.avatarVisemeMap){
                    playAudioWithLipSync(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap, audio);
                }
                audio.play();
                await waitForAudioTrueEnd(audio, 1500);
        } else {
            console.error('Failed to synthesize speech:', data.error);
        }
    }

    _setSendButtonSpinner(show) {
        if (!this.ttsSendButton) return;
        if (show) {
            // Save current icon if not already saved
            if (!this._sendBtnIcon) {
                this._sendBtnIcon = this.ttsSendButton.innerHTML;
            }
            this.ttsSendButton.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;
        } else {
            if (this._sendBtnIcon) {
                this.ttsSendButton.innerHTML = this._sendBtnIcon;
            }
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    const app = new AppController();
    app.init();
});
