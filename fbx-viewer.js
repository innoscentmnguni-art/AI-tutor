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

// Helper: Find jaw bone and viseme blendshapes
let jawBone = null;
let visemeMap = {};
let currentViseme = null;
let visemeWeight = 0;

// Viseme names to look for (common for Oculus/ARKit/VRM)
const visemeNames = [
    'viseme_aa', 'viseme_ih', 'viseme_ou', 'viseme_e', 'viseme_oh', 'viseme_U',
    'viseme_F', 'viseme_L', 'viseme_M', 'viseme_W', 'viseme_S', 'viseme_CH', 'viseme_D', 'viseme_R', 'viseme_TH',
    'jawOpen', 'JawOpen', 'jaw_open', 'mouthOpen', 'MouthOpen', 'mouth_open'
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
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 1.6, 3);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
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
    const modelPath = 'model.fbx';
    const animPath = 'model@idle.fbx';


    // Load base model first
    fbxLoader.load(modelPath, (object) => {
        // Center and scale model if needed
        object.traverse(function (child) {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
                // Print all morph target names for debugging
                if (child.morphTargetDictionary) {
                    console.log('Morph targets found:', Object.keys(child.morphTargetDictionary));
                    for (const v of visemeNames) {
                        if (child.morphTargetDictionary[v] !== undefined) {
                            visemeMap[v] = { mesh: child, index: child.morphTargetDictionary[v] };
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

        // Add model to scene
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

    // WAWA: map vowels/consonants to your actual morph target names
    const wawaMap = {
        'a': 'aa',
        'e': 'E',
        'i': 'ih',
        'o': 'oh',
        'u': 'ou',
        'm': 'mouthClose', // best match for closed mouth
        'w': 'mouthFunnel',
        'l': 'mouthSmileLeft',
        'f': 'FF',
        'r': 'RR',
        's': 'SS',
        'd': 'DD',
        't': 'TH',
        'c': 'CH',
        'p': 'PP',
        'n': 'nn',
        'k': 'kk',
        'x': 'aa', // fallback
    };

    function textToWawaVisemes(text) {
        // Simple: map each vowel/consonant to a viseme, fallback to 'aa'
        let seq = [];
        for (let ch of text.toLowerCase()) {
            if (wawaMap[ch]) seq.push(wawaMap[ch]);
            else if ('aeiou'.includes(ch)) seq.push('viseme_aa');
            else if (ch === ' ') seq.push(null); // rest
        }
        return seq.length ? seq : ['viseme_aa'];
    }

    function startLipsync(text) {
        if (!window.speechSynthesis) {
            alert('Web Speech API not supported in this browser.');
            return;
        }
        if (speaking) {
            window.speechSynthesis.cancel();
            speaking = false;
        }
        ttsUtterance = new SpeechSynthesisUtterance(text);
        // Optionally set voice, pitch, rate, etc.
        // ttsUtterance.voice = ...
        // ttsUtterance.rate = 1.0;

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
        if (speaking && wawaVisemeSeq.length > 0) {
            const now = performance.now();
            const elapsed = (now - wawaStartTime) / 1000.0;
            // Cycle through viseme sequence based on estimated duration
            let idx = Math.floor((elapsed / wawaDuration) * wawaVisemeSeq.length);
            if (idx >= wawaVisemeSeq.length) idx = wawaVisemeSeq.length - 1;
            // Reset all visemes
            for (const v in visemeMap) visemeMap[v].mesh.morphTargetInfluences[visemeMap[v].index] = 0;
            // Activate current viseme
            const blend = wawaVisemeSeq[idx];
            if (blend && visemeMap[blend]) {
                visemeMap[blend].mesh.morphTargetInfluences[visemeMap[blend].index] = 0.8;
            }
            // Animate jaw bone for open visemes
            if (jawBone) {
                if (blend && ['viseme_aa','viseme_oh','viseme_ou'].includes(blend)) {
                    jawBone.rotation.x = 0.25;
                } else {
                    jawBone.rotation.x = 0.05;
                }
            }
        }
        renderer.render(scene, camera);
    }
    animate();
}
