// FBX viewer module — uses ES modules and CDN for Three.js
// This file creates a Three.js scene inside #fbx-container, loads classroom.fbx and model.fbx,
// and plays model@idle.fbx animation.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { avatarEvents } from './script.js';

const container = document.getElementById('fbx-container');

if (!container) {
    console.warn('FBX container not found');
} else {
    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // --- Scene and camera ---
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const CAMERA_FOV = 45;
    const CAMERA_NEAR = 0.1;
    const CAMERA_FAR = 1000;
    const camera = new THREE.PerspectiveCamera(
        CAMERA_FOV,
        container.clientWidth / container.clientHeight,
        CAMERA_NEAR,
        CAMERA_FAR
    );

    // Position the camera as if seated in classroom
    const HEAD_DISTANCE = 100;
    camera.position.set(-30, 1.5 * 55, HEAD_DISTANCE);

    // --- Controls ---
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(-30, 1.5 * 55, HEAD_DISTANCE - 1);
    controls.enableZoom = false;
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.4; // look up limit
    controls.maxPolarAngle = Math.PI * 0.55; // look down limit
    controls.minAzimuthAngle = -Math.PI * 0.2; // turn left limit
    controls.maxAzimuthAngle = Math.PI * 0.2; // turn right limit
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // --- Lighting ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemi.position.set(0, 20, 0);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 10, 7.5);
    scene.add(dir);

    // Subtle floor grid
    const grid = new THREE.GridHelper(10, 10, 0x222222, 0x111111);
    grid.material.opacity = 0.15;
    grid.material.transparent = true;
    scene.add(grid);

    // --- FBX Loading ---
    const clock = new THREE.Clock();
    let mixer = null;
    let idleAction = null;
    const fbxLoader = new FBXLoader();

    const classroomPath = '/static/fbx/ClassRoom.fbx';
    const modelPath = '/static/fbx/model.fbx';
    const animPath = '/static/fbx/model@Idle.fbx';

    // Load classroom first
    fbxLoader.load(classroomPath, (classroomObj) => {
        classroomObj.position.set(0, 0, 0);
        scene.add(classroomObj);

        // Then load avatar model
        fbxLoader.load(modelPath, (object) => {
            object.position.set(-30, 0, -50);
            object.scale.set(55, 55, 55);

            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    // Log mesh info for debugging
                    console.log('Mesh:', child.name);
                    if (child.morphTargetInfluences && child.morphTargetInfluences.length > 0) {
                        console.log('  Found morph targets:', child.morphTargetInfluences.length);
                        if (child.morphTargetDictionary) {
                            console.log('  Morph target names:', Object.keys(child.morphTargetDictionary));
                        }
                        // Use AvatarHead for lipsync
                        if (child.name === 'AvatarHead') {
                            window.avatarMorphMesh = child;
                            // Map Azure viseme IDs to morph target names
                            // Reference: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-speech-synthesis-viseme
                            const visemeToMorph = {
                                0: 'sil',      // silence
                                1: 'PP',       // p, b, m
                                2: 'FF',       // f, v
                                3: 'TH',       // th
                                4: 'DD',       // t, d, s, z
                                5: 'kk',       // k, g, ng
                                6: 'CH',       // ch, j, sh
                                7: 'SS',       // s, z
                                8: 'nn',       // n, l
                                9: 'RR',       // r
                                10: 'aa',      // a
                                11: 'E',       // e
                                12: 'ih',      // i
                                13: 'oh',      // o
                                14: 'ou'       // u
                            };
                            // Build mapping from viseme ID to morph target index
                            const morphDict = child.morphTargetDictionary;
                            window.avatarVisemeMap = {};
                            for (const [visemeId, morphName] of Object.entries(visemeToMorph)) {
                                if (morphDict && morphDict.hasOwnProperty(morphName)) {
                                    window.avatarVisemeMap[visemeId] = morphDict[morphName];
                                }
                            }
                        }
                    } else {
                        console.log('  No morph targets found.');
                    }
                }
            });

            scene.add(object);

            // Load idle animation
            fbxLoader.load(animPath, (anim) => {
                mixer = new THREE.AnimationMixer(object);
                const idleClip = anim.animations && anim.animations.length ? anim.animations[0] : null;
                if (idleClip) {
                    idleAction = mixer.clipAction(idleClip);
                    idleAction.play();
                } else {
                    console.warn('No idle animation clip found');
                }
            }, undefined, (err) => {
                console.error('Failed to load idle animation:', err);
            });

            // Handle speech events by modifying idle animation speed
            avatarEvents.addEventListener('startSpeaking', () => {
                if (idleAction) {
                    // Speed up idle animation during speech
                    idleAction.timeScale = 1.5;
                }
            });

            avatarEvents.addEventListener('stopSpeaking', () => {
                if (idleAction) {
                    // Return to normal speed
                    idleAction.timeScale = 1.0;
                }
            });

        }, undefined, (error) => {
            console.error('Error loading model FBX:', error);
        });

    }, undefined, (error) => {
        console.error('Error loading classroom FBX:', error);
    });

    // --- Resize handling ---
    function onWindowResize() {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
    window.addEventListener('resize', onWindowResize);

    // --- Animation loop ---
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        if (mixer) mixer.update(delta);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}
