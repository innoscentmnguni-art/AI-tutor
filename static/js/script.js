import { playAudioWithLipSync } from './lipsync.js';
export const avatarEvents = new EventTarget();

/*
 * Refactored script.js into small focused classes. Each class has a single responsibility
 * and the overall behavior is preserved: theme toggling, TTS request -> audio playback
 * with lipsync, and browser-side STT (record -> /transcribe -> re-send to /synthesize).
 */

class ThemeManager {
    constructor(htmlEl, toggleBtn, iconEl) {
        this.htmlEl = htmlEl;
        this.toggleBtn = toggleBtn;
        this.iconEl = iconEl;
        this._init();
    }

    _init() {
        const stored = localStorage.getItem('theme');
        if (stored) this.apply(stored);
        this._bind();
    }

    apply(theme) {
        this.htmlEl.setAttribute('data-bs-theme', theme);
        if (this.iconEl) this.iconEl.className = theme === 'dark' ? 'bi bi-moon' : 'bi bi-sun';
        if (this.toggleBtn) {
            this.toggleBtn.classList.toggle('btn-outline-light', theme === 'dark');
            this.toggleBtn.classList.toggle('btn-outline-dark', theme !== 'dark');
        }
    }

    _bind() {
        if (!this.toggleBtn) return;
        this.toggleBtn.addEventListener('click', () => {
            const current = this.htmlEl.getAttribute('data-bs-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            this.apply(next);
            localStorage.setItem('theme', next);
        });
    }
}

class AudioManager {
    static waitForTrueEnd(audio, minSilenceMs = 1500) {
        return new Promise((resolve) => {
            let silenceTimer = null;
            let resolved = false;

            const cleanup = () => {
                if (silenceTimer) clearTimeout(silenceTimer);
                audio.removeEventListener('ended', onEnded);
                audio.removeEventListener('play', onPlay);
            };

            const onEnded = () => {
                silenceTimer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        resolve();
                    }
                }, minSilenceMs);
            };

            const onPlay = () => {
                if (silenceTimer) {
                    clearTimeout(silenceTimer);
                    silenceTimer = null;
                }
            };

            audio.addEventListener('ended', onEnded);
            audio.addEventListener('play', onPlay);
            if (audio.ended) onEnded();
        });
    }

    static async playWithVisemes(url, visemes, morphMesh, visemeMap, audioEl = null) {
        const audio = audioEl || new Audio(url);
        if (morphMesh && visemeMap) {
            try { playAudioWithLipSync(url, visemes, morphMesh, visemeMap, audio); } catch(e) { console.error(e); }
        }
        await audio.play();
        await AudioManager.waitForTrueEnd(audio);
        return audio;
    }
}

class WavEncoder {
    static merge(buffers) {
        const total = buffers.reduce((s, b) => s + b.length, 0);
        const out = new Float32Array(total);
        let offset = 0;
        for (const b of buffers) { out.set(b, offset); offset += b.length; }
        return out;
    }

    static encode(samples, sampleRate) {
        const writeString = (view, offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
            offset += 2;
        }

        return new Blob([view], { type: 'audio/wav' });
    }
}

class SpeechRecognitionManager {
    constructor(onComplete) {
        this.onComplete = onComplete; // callback(transcript)
        this._resetState();
    }

    _resetState() {
        this.audioCtx = null;
        this.sourceNode = null;
        this.recorderNode = null;
        this.stream = null;
        this.buffer = [];
        this.silenceStart = null;
        this.threshold = 0.01;
        this.silenceMs = 1000;
    }

    async start() {
        if (!navigator.mediaDevices?.getUserMedia) { console.warn('getUserMedia not supported'); return false; }
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('Microphone access denied', e);
            return false;
        }

        this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
        this.recorderNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
        this.recorderNode.onaudioprocess = this._onAudio.bind(this);
        this.sourceNode.connect(this.recorderNode);
        this.recorderNode.connect(this.audioCtx.destination);
        return true;
    }

    _onAudio(e) {
        const input = e.inputBuffer.getChannelData(0);
        this.buffer.push(new Float32Array(input));
        const rms = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
        if (rms > this.threshold) {
            this.silenceStart = null;
        } else if (!this.silenceStart) {
            this.silenceStart = Date.now();
        } else if (Date.now() - this.silenceStart >= this.silenceMs) {
            this.finalize();
        }
    }

    stop() {
        this._cleanup();
        if (this.buffer.length > 0) this.finalize();
        this._resetState();
    }

    _cleanup() {
        try { if (this.recorderNode) { this.recorderNode.disconnect(); this.recorderNode.onaudioprocess = null; } } catch(e){}
        try { if (this.sourceNode) this.sourceNode.disconnect(); } catch(e){}
        try { if (this.audioCtx) this.audioCtx.close(); } catch(e){}
        try { if (this.stream) this.stream.getTracks().forEach(t => t.stop()); } catch(e){}
    }

    async finalize() {
        if (!this.buffer.length) return;
        const merged = WavEncoder.merge(this.buffer);
        const rate = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 48000;
        const wav = WavEncoder.encode(merged, rate);
        this._cleanup();
        this.buffer = [];
        try {
            await this._sendForTranscription(wav);
        } catch (e) { console.error('Transcription request failed', e); }
    }

    async _sendForTranscription(wavBlob) {
        const fd = new FormData();
        fd.append('file', wavBlob, 'speech.wav');
        try {
            const res = await fetch('/transcribe', { method: 'POST', body: fd });
            if (!res.ok) { console.error('Transcription failed', res.status); return; }
            const data = await res.json();
            if (data?.transcript) this.onComplete(data.transcript);
        } catch (e) { console.error('Error sending audio for transcription:', e); }
    }
}

class UIManager {
    constructor(sendBtn, micBtn) {
        this.sendBtn = sendBtn;
        this.micBtn = micBtn;
        this._savedSendIcon = null;
    }

    setSendLoading(loading) {
        if (!this.sendBtn) return;
        if (loading) {
            if (!this._savedSendIcon) this._savedSendIcon = this.sendBtn.innerHTML;
            this.sendBtn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>`;
            this.sendBtn.disabled = true;
        } else {
            if (this._savedSendIcon) this.sendBtn.innerHTML = this._savedSendIcon;
            this.sendBtn.disabled = false;
        }
    }

    setMicActive(active) {
        if (!this.micBtn) return;
        this.micBtn.setAttribute('aria-pressed', String(active));
        this.micBtn.classList.toggle('btn-outline-success', active);
        this.micBtn.classList.toggle('btn-outline-light', !active);
        // SVG swap
        this.micBtn.innerHTML = active ? `\n<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mic-fill" viewBox="0 0 16 16">\n  <path d="M5 3a3 3 0 0 1 6 0v5a3 3 0 0 1-6 0z"/>\n  <path d="M3.5 6.5A.5.5 0 0 1 4 7v1a4 4 0 0 0 8 0V7a.5.5 0 0 1 1 0v1a5 5 0 0 1-4.5 4.975V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 .5-.5"/>\n</svg>` : `\n<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-mic-mute-fill" viewBox="0 0 16 16">\n  <path d="M13 8c0 .564-.094 1.107-.266 1.613l-.814-.814A4 4 0 0 0 12 8V7a.5.5 0 0 1 1 0zm-5 4c.818 0 1.578-.245 2.212-.667l.718.719a5 5 0 0 1-2.43.923V15h3a.5.5 0 0 1 0 1h-7a.5.5 0 0 1 0-1h3v-2.025A5 5 0 0 1 3 8V7a.5.5 0 0 1 1 0v1a4 4 0 0 0 4 4m3-9v4.879L5.158 2.037A3.001 3.001 0 0 1 11 3"/>\n  <path d="M9.486 10.607 5 6.12V8a3 3 0 0 0 4.486 2.607m-7.84-9.253 12 12 .708-.708-12-12z"/>\n</svg>`;
    }
}

class TTSManager {
    constructor(inputEl, sendBtn, micBtn) {
        this.inputEl = inputEl;
        this.sendBtn = sendBtn;
        this.micBtn = micBtn;
        this.ui = new UIManager(sendBtn, micBtn);
        this.sr = new SpeechRecognitionManager(this._onTranscript.bind(this));
        this._busy = false;
        this._bind();
    }

    _bind() {
        if (this.sendBtn && this.inputEl) {
            this.sendBtn.addEventListener('click', () => this.send());
            this.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this.send(); }
            });
        }
        if (this.micBtn) this.micBtn.addEventListener('click', () => this.toggleMic());
    }

    async initGreeting() {
        try {
            this._busy = true;
            this.ui.setSendLoading(true);
            const res = await fetch('/greeting');
            if (!res.ok) return;
            const data = await res.json();
            if (data.board_text && window.updateSampleText) {
                try { window.updateSampleText(data.board_text); } catch(e) { console.error(e); }
            }
            if (data.audio_url) await AudioManager.playWithVisemes(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap);
        } catch (e) { console.error('Error fetching/playing greeting:', e); }
        finally { this.ui.setSendLoading(false); this._busy = false; }
    }

    async send() {
        if (this._busy) return;
        const text = (this.inputEl?.value || '').trim();
        if (!text) return;
        this._busy = true;
        this.ui.setSendLoading(true);
        try {
            const res = await fetch('/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
            const data = await res.json();
            await this._handleSynthesizeResponse(data);
        } catch (e) { console.error('Error during speech synthesis:', e); }
        finally { this.ui.setSendLoading(false); this._busy = false; }
    }

    async _handleSynthesizeResponse(data) {
        if (!data) return;
        if (data.success && data.audio_url) {
            if (data.board_text && window.updateSampleText) {
                try { window.updateSampleText(data.board_text); } catch(e) { console.error(e); }
            }
            await AudioManager.playWithVisemes(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap);
        } else {
            console.error('Failed to synthesize speech:', data?.error);
        }
    }

    async toggleMic() {
        const currentlyOn = this.micBtn?.getAttribute('aria-pressed') === 'true';
        const next = !currentlyOn;
        this.ui.setMicActive(next);
        if (next) {
            // If busy, do not start recognition; keep UI active but don't record
            if (this._busy) { return; }
            await this.sr.start();
        } else {
            this.sr.stop();
        }
    }

    _onTranscript(transcript) {
        if (!transcript) return;
        if (this.inputEl) this.inputEl.value = transcript;
        // Automatically send transcribed text
        this.send();
        // If mic still toggled on, wait until not busy then restart recognition
        const micStillOn = this.micBtn?.getAttribute('aria-pressed') === 'true';
        if (micStillOn) {
            const waiter = async () => {
                if (!this._busy) await this.sr.start(); else setTimeout(waiter, 200);
            };
            setTimeout(waiter, 200);
        }
    }
}

class AppController {
    constructor() {
        this.html = document.documentElement;
        this.themeToggle = document.getElementById('themeToggle');
        this.themeIcon = document.getElementById('themeIcon');
        this.ttsForm = document.getElementById('tts-form');
        this.ttsInput = document.getElementById('tts-input') || (this.ttsForm ? this.ttsForm.querySelector('input') : null);
        this.ttsSendButton = document.getElementById('tts-send-btn') || (this.ttsForm ? this.ttsForm.querySelector('button') : null);
        this.ttsMicButton = document.getElementById('tts-mic-btn');

        this.theme = new ThemeManager(this.html, this.themeToggle, this.themeIcon);
        this.tts = new TTSManager(this.ttsInput, this.ttsSendButton, this.ttsMicButton);
    }

    init() { this.tts.initGreeting(); }
}

window.addEventListener('DOMContentLoaded', () => { const app = new AppController(); app.init(); });
