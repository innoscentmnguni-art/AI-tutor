// FBX viewer module — uses ES modules and CDN for Three.js
// This file will create a Three.js scene inside #fbx-container, load model.fbx and model@idle.fbx animation, and play it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const container = document.getElementById('fbx-container');

// Select the new input and button inside the form
const ttsForm = document.getElementById('tts-form');
let input = null;
let speakBtn = null;
if (ttsForm) {
    input = ttsForm.querySelector('input[type="text"]');
    speakBtn = ttsForm.querySelector('button');
}

// Optional simple UI for Azure Speech key and region (in-memory only)
let azureKey = '';
let azureRegion = '';
// You can set these via window.azureSpeechKey and window.azureSpeechRegion before clicking Speak,
// or extend the UI to include input fields for key/region.


// Helper: Find jaw bone and viseme blendshapes
let jawBone = null;
let visemeMap = {};
let currentViseme = null;
let visemeWeight = 0;

// Viseme names to look for (matching the model's morph targets)
const visemeNames = [
    'aa', 'ih', 'ou', 'E', 'oh', 
    'FF', 'SS', 'CH', 'DD', 'RR', 'TH', 'PP', 'kk', 'nn',
    'jawOpen', 'mouthClose', 'mouthFunnel'
];

if (!container) {
    console.warn('FBX container not found');
} else {
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // Scene and camera
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    
    // Camera constants
    const CAMERA_FOV = 45;
    const CAMERA_NEAR = 0.1;
    const CAMERA_FAR = 1000;
    const CAMERA_START_X = -10; // Initial camera height
    const CAMERA_START_Y = 80; // Initial camera height
    const CAMERA_START_Z = 175; // Initial camera distance
    
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, container.clientWidth / container.clientHeight, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(CAMERA_START_X, CAMERA_START_Y, CAMERA_START_Z);

    // Controls
    // Control constants
    const CONTROLS_MIN_DISTANCE = 20; // Minimum zoom distance
    const CONTROLS_MAX_DISTANCE = 200; // Maximum zoom distance
    const CONTROLS_MIN_POLAR_ANGLE = Math.PI * 0.1; // Limit looking up (5 degrees)
    const CONTROLS_MAX_POLAR_ANGLE = Math.PI * 0.6; // Limit looking down (~108 degrees)
    const CONTROLS_MIN_AZIMUTH = -Math.PI * 0.3; // Limit rotation left (-54 degrees)
    const CONTROLS_MAX_AZIMUTH = Math.PI * 0.3; // Limit rotation right (54 degrees)
    const PAN_SPEED = 10;
    
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(10, 85, 0); // Look at the face
    controls.minDistance = CONTROLS_MIN_DISTANCE;
    controls.maxDistance = CONTROLS_MAX_DISTANCE;
    controls.minPolarAngle = CONTROLS_MIN_POLAR_ANGLE; // Limit looking up
    controls.maxPolarAngle = CONTROLS_MAX_POLAR_ANGLE; // Limit looking down
    controls.minAzimuthAngle = CONTROLS_MIN_AZIMUTH; // Limit horizontal rotation left
    controls.maxAzimuthAngle = CONTROLS_MAX_AZIMUTH; // Limit horizontal rotation right
    controls.enableDamping = true; // Smooth camera movements
    controls.dampingFactor = 0.05;
    
    // Add keyboard controls for panning
    window.addEventListener('keydown', (e) => {
        switch(e.key) {
            case 'ArrowUp':
                controls.target.y += PAN_SPEED;
                camera.position.y += PAN_SPEED;
                break;
            case 'ArrowDown':
                controls.target.y -= PAN_SPEED;
                camera.position.y -= PAN_SPEED;
                break;
            case 'ArrowLeft':
                controls.target.x -= PAN_SPEED;
                camera.position.x -= PAN_SPEED;
                break;
            case 'ArrowRight':
                controls.target.x += PAN_SPEED;
                camera.position.x += PAN_SPEED;
                break;
        }
        controls.update();
    });
    
    controls.update();

    // Lights
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0, 20, 0);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    // Ground helper (subtle)
    const grid = new THREE.GridHelper(10, 10, 0x222222, 0x111111);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    scene.add(grid);

    // Variables for animation
    const clock = new THREE.Clock();
    let mixer = null;

    const fbxLoader = new FBXLoader();

    // Paths — assumptions: files are in the same folder as index.html
    const classroomPath = 'classroom.fbx';
    const modelPath = 'model.fbx';
    const animPath = 'model@idle.fbx';

    // Load classroom first
    fbxLoader.load(classroomPath, (classroomObj) => {
        // Optionally scale/center classroom
        classroomObj.position.set(0, 0, 0);
        scene.add(classroomObj);

        // Now load avatar model
        fbxLoader.load(modelPath, (object) => {
            // Center and scale model if needed
            object.position.set(-20, 0, -50); // Place avatar slightly forward in classroom
            object.scale.set(55, 55, 55); // Scale avatar up by a factor of 55
            object.traverse(function (child) {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // Print all morph target names for debugging
                    if (child.morphTargetDictionary && child.morphTargetInfluences) {
                        console.log('Checking mesh:', child.name);
                        console.log('Has morphTargetInfluences:', !!child.morphTargetInfluences, 'Length:', child.morphTargetInfluences.length);
                        // Check if this mesh has most of our visemes (to find the main face mesh)
                        let visemeCount = 0;
                        for (const v of visemeNames) {
                            if (child.morphTargetDictionary[v] !== undefined) {
                                visemeCount++;
                            }
                        }
                        // If this mesh has more visemes than our current best, use it
                        if (visemeCount > Object.keys(visemeMap).length) {
                            visemeMap = {}; // Clear previous mappings
                            console.log('Found better mesh with', visemeCount, 'visemes:', child.name);
                            console.log('Morph targets:', Object.keys(child.morphTargetDictionary));
                            for (const v of visemeNames) {
                                if (child.morphTargetDictionary[v] !== undefined) {
                                    visemeMap[v] = { mesh: child, index: child.morphTargetDictionary[v] };
                                    console.log('Mapped viseme:', v, 'to index:', child.morphTargetDictionary[v]);
                                }
                            }
                        }
                    }
                }
                // Find jaw bone
                if (child.isBone && !jawBone) {
                    const name = child.name.toLowerCase();
                    if (name.includes('jaw')) jawBone = child;
                }
            });

            // Add avatar to scene (inside classroom)
            scene.add(object);

            // Attempt to load the animation file
            fbxLoader.load(animPath, (anim) => {
                // Create mixer on the model
                mixer = new THREE.AnimationMixer(object);
                // FBX animation sometimes stores animations in anim.animations
                const clip = anim.animations && anim.animations.length ? anim.animations[0] : null;
                if (clip) {
                    const action = mixer.clipAction(clip);
                    action.play();
                } else if (anim && anim.animations && anim.animations.length === 0) {
                    console.warn('Animation file loaded but contained no clips.');
                } else {
                    console.warn('No animation clip found in animation FBX');
                }
            }, undefined, (err) => {
                console.error('Failed to load animation FBX:', err);
            });

        }, undefined, (error) => {
            console.error('Error loading model FBX:', error);
        });

    }, undefined, (error) => {
        console.error('Error loading classroom FBX:', error);
    });

    // Resize handling
    function onWindowResize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    window.addEventListener('resize', onWindowResize);

    // --- TTS lipsync logic ---
    let speaking = false;
    let audioAnalyser = null;
    let audioSource = null;
    let audioContext = null;
    let ttsUtterance = null;
        // --- WAWA lipsync logic ---
    let wawaVisemeSeq = [];
    let wawaStartTime = 0;
    let wawaDuration = 0;

        // --- Azure Speech SDK synthesizer and viseme handling ---
        let azureSynthesizer = null;
        let azureVisemeSeq = []; // array of {visemeId, visemeName, offsetSeconds}
        let azureStartTime = 0;
        let usingAzure = false;

    // Enhanced phoneme to viseme mapping
    const wawaMap = {
        'a': 'aa',  // as in "father"
        'æ': 'aa',  // as in "cat"
        'ə': 'ih',  // schwa sound
        'e': 'E',   // as in "bed"
        'i': 'ih',  // as in "bit"
        'ī': 'ih',  // as in "beet"
        'o': 'oh',  // as in "boat"
        'u': 'ou',  // as in "boot"
        'ʌ': 'aa',  // as in "but"
        
        'm': 'mouthClose',
        'b': 'mouthClose',
        'p': 'PP',
        
        'w': 'mouthFunnel',
        'r': 'RR',
        
        'f': 'FF',
        'v': 'FF',
        
        's': 'SS',
        'z': 'SS',
        
        'd': 'DD',
        't': 'TH',
        'th': 'TH',
        
        'ch': 'CH',
        'sh': 'CH',
        'j': 'CH',
        
        'n': 'nn',
        'ng': 'nn',
        
        'k': 'kk',
        'g': 'kk',
        
        'h': 'aa',    // slight mouth opening
        'y': 'ih',    // like in "yes"
        'l': 'ih',    // tongue position
        
        // Fallback for any unmatched phoneme
        'x': 'aa'
    };

    function textToWawaVisemes(text) {
        // Enhanced: handle multi-character phonemes and improve timing
        let seq = [];
        const words = text.toLowerCase().split(' ');
        
        for (const word of words) {
            if (word.length === 0) continue;
            
            // Process each word
            let i = 0;
            while (i < word.length) {
                // Check for multi-character phonemes first
                let found = false;
                ['th', 'ch', 'sh', 'ng'].forEach(phoneme => {
                    if (word.slice(i).startsWith(phoneme)) {
                        seq.push(wawaMap[phoneme]);
                        i += phoneme.length;
                        found = true;
                    }
                });
                
                if (!found) {
                    const ch = word[i];
                    if (wawaMap[ch]) {
                        seq.push(wawaMap[ch]);
                    } else if ('aeiou'.includes(ch)) {
                        seq.push('aa'); // Default vowel viseme
                    }
                    i++;
                }
            }
            
            // Add a brief pause between words
            seq.push(null);
        }
        
        return seq.length ? seq : ['aa'];
    }

    function startLipsync(text) {
        // If Azure key/region are provided either via global window variables or local values, prefer Azure
        if ((window.azureSpeechKey || azureKey) && (window.azureSpeechRegion || azureRegion) && window.SpeechSDK) {
            usingAzure = true;
            const key = window.azureSpeechKey || azureKey;
            const region = window.azureSpeechRegion || azureRegion;

            try {
                const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(key, region);
                // Optional: set voice name
                // speechConfig.speechSynthesisVoiceName = 'en-US-JennyNeural';

                // Use default audio output (speakers)
                const audioConfig = SpeechSDK.AudioConfig.fromDefaultSpeakerOutput();
                azureSynthesizer = new SpeechSDK.SpeechSynthesizer(speechConfig, audioConfig);

                // Clear previous viseme sequence
                azureVisemeSeq = [];

                azureSynthesizer.visemeReceived = (s, e) => {
                    // e.visemeId is the viseme index from Azure; e.audioOffset is duration in ticks (100ns units)
                    const offsetSeconds = e.audioOffset / 10000000.0;
                    const visemeId = e.visemeId;
                    // Map Azure viseme id to a readable name using known mapping (see note below)
                    const visemeName = mapAzureVisemeIdToName(visemeId);
                    azureVisemeSeq.push({ visemeId, visemeName, offsetSeconds });
                };

                // Start lipsync timing only when audio actually starts playing
                azureSynthesizer.synthesizing = () => {
                    speaking = true;
                    azureStartTime = performance.now();
                };
                azureSynthesizer.synthesisCompleted = () => {
                    speaking = false;
                    // reset morphs
                    for (const v in visemeMap) visemeMap[v].mesh.morphTargetInfluences[visemeMap[v].index] = 0;
                    if (jawBone) jawBone.rotation.x = 0;
                    azureVisemeSeq = [];
                };

                azureSynthesizer.speakTextAsync(text,
                    result => {
                        if (result.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
                            console.log('Azure synthesis finished');
                        } else {
                            console.warn('Azure synthesis result:', result);
                        }
                    },
                    error => {
                        console.error('Azure synthesis error:', error);
                        // fallback to web speech and WAWA mapping
                        usingAzure = false;
                        startLipsyncFallback(text);
                    }
                );

            } catch (err) {
                console.error('Failed to initialize Azure Speech SDK:', err);
                usingAzure = false;
                startLipsyncFallback(text);
            }
            return;
        }

        // Fallback to the previous Web Speech API + WAWA mapping
        startLipsyncFallback(text);
    }

    function startLipsyncFallback(text) {
        if (!window.speechSynthesis) {
            alert('Web Speech API not supported in this browser and Azure not configured.');
            return;
        }
        if (speaking) {
            window.speechSynthesis.cancel();
            speaking = false;
        }
        ttsUtterance = new SpeechSynthesisUtterance(text);

        // Generate viseme sequence from text
        wawaVisemeSeq = textToWawaVisemes(text);
        wawaDuration = Math.max(1.5, text.length * 0.09); // estimate duration

        ttsUtterance.onstart = () => {
            speaking = true;
            wawaStartTime = performance.now();
        };
        ttsUtterance.onend = () => {
            speaking = false;
            visemeWeight = 0;
            currentViseme = null;
            if (jawBone) jawBone.rotation.x = 0;
            for (const v in visemeMap) visemeMap[v].mesh.morphTargetInfluences[visemeMap[v].index] = 0;
        };

        window.speechSynthesis.speak(ttsUtterance);
    }

    // Button and form event
    if (speakBtn && input) {
        speakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (text) startLipsync(text);
        });
        // Also allow pressing Enter in the input
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const text = input.value.trim();
                if (text) startLipsync(text);
            }
        });
    }

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        if (mixer) mixer.update(delta);

        // WAWA lipsync animation
        if (speaking) {
            // If using Azure, drive morphs from azureVisemeSeq (timed by audio offset)
            if (usingAzure && azureVisemeSeq.length > 0) {
                const now = (performance.now() - azureStartTime) / 1000.0; // seconds since start
                // Find last viseme whose offsetSeconds <= now
                let active = null;
                for (let i = 0; i < azureVisemeSeq.length; i++) {
                    if (azureVisemeSeq[i].offsetSeconds <= now) active = azureVisemeSeq[i];
                    else break;
                }
                if (active) {
                    applyViseme(active.visemeName);
                }
            } else if (wawaVisemeSeq.length > 0) {
                // Fallback WAWA timing
                const now = performance.now();
                const elapsed = (now - wawaStartTime) / 1000.0;
                let idx = Math.floor((elapsed / wawaDuration) * wawaVisemeSeq.length);
                if (idx >= wawaVisemeSeq.length) idx = wawaVisemeSeq.length - 1;
                const blend = wawaVisemeSeq[idx];
                if (blend && visemeMap[blend]) {
                    applyViseme(blend);
                }
            }
        }
        renderer.render(scene, camera);
    }
    animate();
}

// Map Azure viseme ids (0-21) to viseme names. The mapping below is approximate and should be tuned per voice/model.
function mapAzureVisemeIdToName(id) {
    // Azure uses a viseme set; this mapping is a common approximation.
    const map = {
        0: 'sil', 1: 'PP', 2: 'FF', 3: 'TH', 4: 'DD', 5: 'kk', 6: 'CH', 7: 'SS', 8: 'nn', 9: 'RR',
        10: 'aa', 11: 'E', 12: 'ih', 13: 'oh', 14: 'ou', 15: 'mouthFunnel', 16: 'mouthClose', 17: 'jawOpen',
        18: 'other', 19: 'other', 20: 'other', 21: 'other'
    };
    return map[id] || 'aa';
}

// Apply a viseme name to the model: reset other morphs and set the matched morphTargetInfluence
function applyViseme(visemeName) {
    const currentMesh = Object.values(visemeMap)[0]?.mesh;
    if (!currentMesh) return;
    // Reset all morph targets
    for (let i = 0; i < currentMesh.morphTargetInfluences.length; i++) {
        currentMesh.morphTargetInfluences[i] = 0;
    }
    // If we have a direct mapping, apply it
    if (visemeMap[visemeName]) {
        const { mesh, index } = visemeMap[visemeName];
        // Make 'mouthClose' (used for 'm') less exaggerated
        if (visemeName === 'mouthClose') {
            mesh.morphTargetInfluences[index] = 0.18; // reduced from 0.4 for natural look
        } else {
            mesh.morphTargetInfluences[index] = 0.4;
        }
        // jaw handling
        if (visemeName === 'aa' || visemeName === 'oh' || visemeName === 'ou' || visemeName === 'E' || visemeName === 'jawOpen') {
            const jawIndex = mesh.morphTargetDictionary['jawOpen'];
            if (jawIndex !== undefined) mesh.morphTargetInfluences[jawIndex] = 0.22;
        }
    } else {
        // fallback: try to set jaw open or subtle mouth movement
        const jawIndex = currentMesh.morphTargetDictionary['jawOpen'];
        if (jawIndex !== undefined) currentMesh.morphTargetInfluences[jawIndex] = 0.12;
    }
    // animate jaw bone slightly
    if (jawBone) {
        if (['aa', 'oh', 'ou', 'jawOpen'].includes(visemeName)) jawBone.rotation.x = 0.25;
        else jawBone.rotation.x = 0.05;
    }
}
