// Gaze client: capture webcam, send frames to /gaze, handle calibration, and update UI

const video = document.getElementById('webcam');
const processedImg = document.getElementById('processed-frame');
const statusEl = document.getElementById('engagement-status');
let streaming = false;
let sendInterval = 200; // ms between frames
let calibrateNext = false;
let trackingEnabled = false; // start OFF by default

async function startWebcam() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
        video.srcObject = stream;
        await video.play();
        streaming = true;
        pollFrames();
    } catch (e) {
        console.error('Webcam start failed', e);
        statusEl.textContent = 'Status: Webcam error';
    }
}

function captureFrameAsJpeg() {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg').split(',')[1]; // base64 without prefix
}

let lastSend = 0;
async function pollFrames() {
    if (!streaming) return;
    const now = performance.now();
    if (now - lastSend >= sendInterval) {
        lastSend = now;
        // If tracking is disabled, skip sending frames
        if (!trackingEnabled) {
            requestAnimationFrame(pollFrames);
            return;
        }

        const b64 = captureFrameAsJpeg();
        try {
            const resp = await fetch('/gaze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frame: b64, calibrate: calibrateNext })
            });
            calibrateNext = false;
            if (resp.ok) {
                const data = await resp.json();
                if (data.processed_frame) {
                    processedImg.src = 'data:image/jpeg;base64,' + data.processed_frame;
                    processedImg.style.display = 'block';
                }
                // Update gaze angle display
                const angleEl = document.getElementById('gaze-angle');
                if (angleEl) {
                    angleEl.textContent = data.gaze_angle != null ? `Gaze Angle: ${data.gaze_angle.toFixed(1)}°` : 'Gaze Angle: --';
                }

                // Update status button/label
                statusEl.textContent = data.engaged ? 'ENGAGED' : 'NOT ENGAGED';
                statusEl.style.background = data.engaged ? '#2b8a3e' : '#8a2222';
            } else {
                const err = await resp.text();
                console.warn('Gaze endpoint error', err);
            }
        } catch (e) {
            console.error('Error sending frame', e);
        }
    }
    requestAnimationFrame(pollFrames);
}

function calibrate() {
    calibrateNext = true;
}

window.addEventListener('DOMContentLoaded', () => {
    // Don't auto-start webcam; tracking is initially off
    // Create calibrate button
    const btn = document.createElement('button');
    btn.textContent = 'Calibrate';
    btn.className = 'btn btn-warning mt-2';
    btn.onclick = () => {
        if (!trackingEnabled) {
            // brief feedback
            btn.textContent = 'Turn on tracking first';
            setTimeout(() => btn.textContent = 'Calibrate', 1200);
            return;
        }
        calibrate();
        btn.textContent = 'Calibrating...';
        setTimeout(() => btn.textContent = 'Calibrate', 1200);
    };
    const container = document.getElementById('engagement-visuals');
    container.appendChild(btn);

    // Create tracking toggle button (starts OFF)
    const toggle = document.createElement('button');
    toggle.textContent = 'Turn On';
    toggle.className = 'btn btn-secondary mt-2 ms-2';
    toggle.onclick = async () => {
        trackingEnabled = !trackingEnabled;
        toggle.textContent = trackingEnabled ? 'Turn Off' : 'Turn On';

        // Enable/disable calibrate button
        btn.disabled = !trackingEnabled;

        if (trackingEnabled) {
            // Start webcam and indicate starting state
            statusEl.textContent = 'Starting eye tracking...';
            statusEl.style.background = '#2b8a3e';
            try {
                await startWebcam();
                statusEl.textContent = 'Initializing...';
            } catch (e) {
                statusEl.textContent = 'Webcam failed';
                statusEl.style.background = '#8a2222';
            }
        } else {
            // Turn off: stop camera tracks and update UI
            try {
                const stream = video.srcObject;
                if (stream) {
                    const tracks = stream.getTracks();
                    tracks.forEach(t => t.stop());
                }
            } catch (e) {
                console.warn('Error stopping camera', e);
            }
            video.srcObject = null;
            streaming = false;
            processedImg.style.display = 'none';
            statusEl.textContent = 'Eye tracking off';
            statusEl.style.background = '#666';
        }
    };
    // Calibrate button should be disabled when tracking is off
    btn.disabled = true;
    container.appendChild(toggle);
});
