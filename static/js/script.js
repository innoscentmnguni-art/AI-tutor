import { playAudioWithLipSync } from './lipsync.js';
export const avatarEvents = new EventTarget();

// Parse board text and split into elements for updateSampleTextCombined.
// Recognizes display math $$...$$ and inline math $...$ and preserves order.
function parseBoardTextToElements(boardText){
    if (!boardText) return [];
    const out = [];
    let s = String(boardText);
    // We will scan for $$...$$ first, then $...$ — using a single pass regex loop.
    const regex = /(\$\$[\s\S]*?\$\$)|(\$[^\$\n][^\$]*?\$)/g;
    let lastIndex = 0;
    let m;
    while ((m = regex.exec(s)) !== null){
        const idx = m.index;
        if (idx > lastIndex){
            const plain = s.slice(lastIndex, idx);
            out.push({ type: 'text', text: plain.trim() });
        }
        const match = m[0];
        if (match.startsWith('$$')){
            // strip delimiters
            const inner = match.slice(2, -2).trim();
            out.push({ type: 'latex', latex: inner });
        } else if (match.startsWith('$')){
            const inner = match.slice(1, -1).trim();
            out.push({ type: 'latex', latex: inner });
        }
        lastIndex = regex.lastIndex;
    }
    if (lastIndex < s.length){
        const tail = s.slice(lastIndex);
        out.push({ type: 'text', text: tail.trim() });
    }
    // merge consecutive text nodes and filter empty ones
    const merged = [];
    for (const e of out){
        if (e.type === 'text'){
            if (!e.text || !e.text.trim()) continue;
            const prev = merged[merged.length - 1];
            if (prev && prev.type === 'text') prev.text += '\n' + e.text;
            else merged.push({ type: 'text', text: e.text });
        } else {
            merged.push(e);
        }
    }
    return merged;
}

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
    static waitForTrueEnd(audio, minSilenceMs = 800) {
        return new Promise((resolve) => {
            let silenceTimer = null;
            let resolved = false;

            const cleanup = () => {
                try { if (silenceTimer) clearTimeout(silenceTimer); } catch(e){}
                try { audio.removeEventListener('ended', onEnded); } catch(e){}
                try { audio.removeEventListener('play', onPlay); } catch(e){}
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
        // notify listeners that avatar is about to speak
        try { avatarEvents.dispatchEvent(new Event('startSpeaking')); } catch(e){}
        if (morphMesh && visemeMap) {
            try { playAudioWithLipSync(url, visemes, morphMesh, visemeMap, audio); } catch(e) { console.error(e); }
        }
        await audio.play();
        await AudioManager.waitForTrueEnd(audio);
        // done speaking
        try { avatarEvents.dispatchEvent(new Event('stopSpeaking')); } catch(e){}
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
    constructor(onComplete, onLevel) {
        this.onComplete = onComplete; // callback(transcript)
        this.onLevel = onLevel; // callback(level 0..1)
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
        // allow caller to request keepAlive by passing parameter to start
        if (!navigator.mediaDevices?.getUserMedia) { console.warn('getUserMedia not supported'); return false; }
        try {
            // reuse existing stream if present
            if (!this.stream) this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
            console.warn('Microphone access denied', e);
            return false;
        }

        // create or reuse audio context
        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (!this.sourceNode || this.sourceNode.mediaStream !== this.stream) {
            try { this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream); } catch(e){ console.warn('Failed to create media source', e); }
        }

        // create recorder node if not present
        if (!this.recorderNode) {
            try {
                this.recorderNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
                this.recorderNode.onaudioprocess = this._onAudio.bind(this);
                if (this.sourceNode && typeof this.sourceNode.connect === 'function') this.sourceNode.connect(this.recorderNode);
                try { this.recorderNode.connect(this.audioCtx.destination); } catch(e) { /* some browsers disallow connecting to destination */ }
            } catch(e) { console.error('Failed to create recorder node', e); }
        }
        return true;
    }

    _pauseRecording() {
        try {
            if (this.recorderNode) {
                try { this.recorderNode.disconnect(); } catch(e){}
                try { this.recorderNode.onaudioprocess = null; } catch(e){}
                this.recorderNode = null;
            }
        } catch (e) { console.error(e); }
    }

    _resumeRecording() {
        try {
            if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (!this.sourceNode && this.stream) this.sourceNode = this.audioCtx.createMediaStreamSource(this.stream);
            if (!this.recorderNode) {
                this.recorderNode = this.audioCtx.createScriptProcessor(4096, 1, 1);
                this.recorderNode.onaudioprocess = this._onAudio.bind(this);
                try { if (this.sourceNode && typeof this.sourceNode.connect === 'function') this.sourceNode.connect(this.recorderNode); } catch(e){}
                try { this.recorderNode.connect(this.audioCtx.destination); } catch(e){}
            }
        } catch (e) { console.error('Failed to resume recording', e); }
    }

    _onAudio(e) {
        const input = e.inputBuffer.getChannelData(0);
        this.buffer.push(new Float32Array(input));
        const rms = Math.sqrt(input.reduce((s, v) => s + v * v, 0) / input.length);
        // emit level callback for UI visualization (clamped 0..1)
        try { if (this.onLevel) this.onLevel(Math.min(1, rms * 10)); } catch(e){}
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
        try { if (this.recorderNode) { this.recorderNode.disconnect(); try { this.recorderNode.onaudioprocess = null; } catch(e){} this.recorderNode = null; } } catch(e){}
        try { if (this.sourceNode && typeof this.sourceNode.disconnect === 'function') { this.sourceNode.disconnect(); this.sourceNode = null; } } catch(e){}
        try { if (this.audioCtx) { this.audioCtx.close(); } } catch(e){}
        try { if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; } } catch(e){}
        try { if (this.onLevel) this.onLevel(0); } catch(e){}
    }

    async finalize() {
        if (!this.buffer.length) return;
        const merged = WavEncoder.merge(this.buffer);
        const rate = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 48000;
        const wav = WavEncoder.encode(merged, rate);
        // pause recording so we stop processing until transcription returns
        this._pauseRecording();
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
            // If the mic should remain on, resume recording after a short delay
            if (this._keepAlive) {
                setTimeout(() => { try { this._resumeRecording(); } catch(e){} }, 200);
            }
        } catch (e) { console.error('Error sending audio for transcription:', e); }
    }

}

class UIManager {
    constructor(sendBtn, micBtn) {
        this.sendBtn = sendBtn;
        this.micBtn = micBtn;
        this._savedSendIcon = null;
        this._levelEl = null;
        this._ensureLevelElement();
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

    _ensureLevelElement() {
        if (!this.micBtn) return;
        // create a small level bar container inside the mic button if not present
        if (!this._levelEl) {
            this._levelEl = document.createElement('div');
            this._levelEl.style.position = 'absolute';
            this._levelEl.style.bottom = '2px';
            this._levelEl.style.left = '50%';
            this._levelEl.style.transform = 'translateX(-50%)';
            this._levelEl.style.width = '24px';
            this._levelEl.style.height = '4px';
            this._levelEl.style.borderRadius = '2px';
            this._levelEl.style.background = 'rgba(255,255,255,0.15)';
            this._levelEl.style.overflow = 'hidden';
            this._levelEl.style.pointerEvents = 'none';
            const inner = document.createElement('div');
            inner.style.height = '100%';
            inner.style.width = '0%';
            inner.style.background = 'limegreen';
            inner.style.transition = 'width 80ms linear';
            this._levelEl._inner = inner;
            this._levelEl.appendChild(inner);
            this.micBtn.style.position = 'relative';
            this.micBtn.appendChild(this._levelEl);
        }
    }

    updateMicLevel(norm) {
        this._ensureLevelElement();
        if (!this._levelEl) return;
        const pct = Math.round(Math.max(0, Math.min(1, norm)) * 100);
        this._levelEl._inner.style.width = pct + '%';
        // change color based on level
        if (pct > 66) this._levelEl._inner.style.background = '#ff5c33';
        else if (pct > 33) this._levelEl._inner.style.background = '#ffd633';
        else this._levelEl._inner.style.background = 'limegreen';
    }

    resetMicLevel() { if (this._levelEl) this._levelEl._inner.style.width = '0%'; }
}

class TTSManager {
    constructor(inputEl, sendBtn, micBtn) {
        this.inputEl = inputEl;
        this.sendBtn = sendBtn;
        this.micBtn = micBtn;
        this.ui = new UIManager(sendBtn, micBtn);
        // Ensure mic starts OFF by default
        if (this.micBtn) this.micBtn.setAttribute('aria-pressed', 'false');
        this.sr = new SpeechRecognitionManager(this._onTranscript.bind(this), (lvl) => this.ui.updateMicLevel(lvl));
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
            if (data.board_text && window.updateSampleTextCombined) {
                try {
                    const elems = parseBoardTextToElements(data.board_text);
                    window.updateSampleTextCombined(elems, 2048, 1024);
                } catch(e) { console.error(e); }
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
            // notify avatar that we're waiting for an AI response (thinking)
            try { avatarEvents.dispatchEvent(new Event('startThinking')); } catch(e){}
            const res = await fetch('/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
            const data = await res.json();
            // thinking finished (we have an AI response)
            try { avatarEvents.dispatchEvent(new Event('stopThinking')); } catch(e){}
            await this._handleSynthesizeResponse(data);
        } catch (e) { console.error('Error during speech synthesis:', e); }
        finally { this.ui.setSendLoading(false); this._busy = false; }
    }

    async _handleSynthesizeResponse(data) {
        if (!data) return;
        if (data.success && data.audio_url) {
            if (data.board_text && window.updateSampleTextCombined) {
                try {
                    const elems = parseBoardTextToElements(data.board_text);
                    window.updateSampleTextCombined(elems, 2048, 1024);
                } catch(e) { console.error(e); }
            }
            // pause recording while avatar speaks to avoid capturing playback
            try { if (this.sr) { this.sr._pauseRecording(); this.ui.resetMicLevel(); } } catch(e){}
            await AudioManager.playWithVisemes(data.audio_url, data.visemes, window.avatarMorphMesh, window.avatarVisemeMap);
            // resume recording if mic still toggled on and keepAlive requested
            const micStillOn = this.micBtn?.getAttribute('aria-pressed') === 'true';
            try { if (micStillOn && this.sr && this.sr._keepAlive) this.sr._resumeRecording(); } catch(e){}
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
            // indicate SR should keep recording active across transcribe cycles
            this.sr._keepAlive = true;
            const started = await this.sr.start();
            if (!started) {
                // failed to start (permission denied) => reset UI
                this.ui.setMicActive(false);
            }
        } else {
            // stop keepAlive and fully stop recognition
            this.sr._keepAlive = false;
            this.sr.stop();
            this.ui.resetMicLevel();
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
