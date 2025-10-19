// Gaze client: class-based, small methods, separation of concerns

class GazeClient {
    constructor({videoId='webcam', processedImgId='processed-frame', statusId='engagement-status', containerId='engagement-visuals'}){
        this.video = document.getElementById(videoId);
        this.processedImg = document.getElementById(processedImgId);
        this.statusEl = document.getElementById(statusId);
        this.container = document.getElementById(containerId);

        this.streaming = false;
        this.trackingEnabled = false; // start off
        this.calibrateNext = false;
        this.sendInterval = 200; // ms
        this._lastSend = 0;

        this._rafHandle = null;

        this._buildUI();
        this._bindEvents();
    }

    _buildUI(){
        // Calibrate button
        this.calibrateBtn = document.createElement('button');
        this.calibrateBtn.textContent = 'Calibrate';
        this.calibrateBtn.className = 'btn btn-warning mt-2';
        this.calibrateBtn.disabled = true;
        this.container.appendChild(this.calibrateBtn);

        // Toggle button
        this.toggleBtn = document.createElement('button');
        this.toggleBtn.textContent = 'Turn On';
        this.toggleBtn.className = 'btn btn-secondary mt-2 ms-2';
        this.container.appendChild(this.toggleBtn);
    }

    _bindEvents(){
        this.calibrateBtn.addEventListener('click', () => this._onCalibrateClick());
        this.toggleBtn.addEventListener('click', () => this._onToggleClick());
        window.addEventListener('unload', () => this.stop());
    }

    async _onToggleClick(){
        const enable = !this.trackingEnabled;
        this.setTrackingEnabled(enable);
        if (enable){
            this.setStatus('Starting eye tracking...', '#2b8a3e');
            try {
                await this.startWebcam();
                this.setStatus('Initializing...', '#2b8a3e');
            } catch (err){
                console.error('Webcam failed', err);
                this.setStatus('Webcam failed', '#8a2222');
            }
        } else {
            this.stopWebcam();
            this.setStatus('Eye tracking off', '#666');
            this.hideProcessedImage();
        }
    }

    _onCalibrateClick(){
        if (!this.trackingEnabled){
            this._flashButtonMessage(this.calibrateBtn, 'Turn on tracking first', 1200);
            return;
        }
        this.calibrateNext = true;
        this._flashButtonMessage(this.calibrateBtn, 'Calibrating...', 1200);
    }

    _flashButtonMessage(btn, msg, ms){
        const orig = btn.textContent;
        btn.textContent = msg;
        setTimeout(()=> btn.textContent = orig, ms);
    }

    setTrackingEnabled(enable){
        this.trackingEnabled = enable;
        this.calibrateBtn.disabled = !enable;
        this.toggleBtn.textContent = enable ? 'Turn Off' : 'Turn On';
        if (enable && !this._rafHandle){
            this._rafHandle = requestAnimationFrame(()=> this._pollLoop());
        }
    }

    async startWebcam(){
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        this.video.srcObject = stream;
        await this.video.play();
        this.streaming = true;
        if (!this._rafHandle) this._rafHandle = requestAnimationFrame(()=> this._pollLoop());
    }

    stopWebcam(){
        try{
            const stream = this.video.srcObject;
            if (stream){
                stream.getTracks().forEach(t => t.stop());
            }
        }catch(e){ console.warn('Error stopping camera', e); }
        this.video.srcObject = null;
        this.streaming = false;
    }

    stop(){
        this.setTrackingEnabled(false);
        if (this._rafHandle) cancelAnimationFrame(this._rafHandle);
        this._rafHandle = null;
        this.stopWebcam();
    }

    captureFrameAsJpeg(){
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth || 640;
        canvas.height = this.video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg').split(',')[1];
    }

    async _sendFrame(base64){
        const payload = { frame: base64, calibrate: this.calibrateNext };
        this.calibrateNext = false;
        try{
            const resp = await fetch('/gaze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!resp.ok){
                const txt = await resp.text();
                console.warn('Gaze endpoint error', txt);
                return null;
            }
            return await resp.json();
        }catch(e){
            console.error('Error sending frame', e);
            return null;
        }
    }

    _updateFromResponse(data){
        if (!data) return;
        if (data.processed_frame){
            this.processedImg.src = 'data:image/jpeg;base64,' + data.processed_frame;
            this.processedImg.style.display = 'block';
        }
        const angleEl = document.getElementById('gaze-angle');
        if (angleEl) angleEl.textContent = data.gaze_angle != null ? `Gaze Angle: ${data.gaze_angle.toFixed(1)}°` : 'Gaze Angle: --';
        this.setStatus(data.engaged ? 'ENGAGED' : 'NOT ENGAGED', data.engaged ? '#2b8a3e' : '#8a2222');
    }

    hideProcessedImage(){
        if (this.processedImg) this.processedImg.style.display = 'none';
    }

    setStatus(text, bg){
        if (!this.statusEl) return;
        this.statusEl.textContent = text;
        if (bg) this.statusEl.style.background = bg;
    }

    async _pollLoop(){
        if (!this.streaming){
            this._rafHandle = null;
            return;
        }

        const now = performance.now();
        if (now - this._lastSend >= this.sendInterval){
            this._lastSend = now;
            if (this.trackingEnabled){
                const b64 = this.captureFrameAsJpeg();
                const res = await this._sendFrame(b64);
                this._updateFromResponse(res);
            }
        }

        this._rafHandle = requestAnimationFrame(()=> this._pollLoop());
    }
}

window.addEventListener('DOMContentLoaded', () => {
    // Create client instance and keep reference globally for debugging
    window.gazeClient = new GazeClient({
        videoId: 'webcam',
        processedImgId: 'processed-frame',
        statusId: 'engagement-status',
        containerId: 'engagement-visuals'
    });
});
