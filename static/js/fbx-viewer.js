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

        // Check classroom for plane023 as well and apply the text texture if found
        classroomObj.traverse((child) => {
            if (child.isMesh && child.name === 'plane023') {
                try {
                    const sampleTex = createTextTexture('Sample Text');
                    const mat = child.material && child.material.clone ? child.material.clone() : new THREE.MeshBasicMaterial();
                    mat.map = sampleTex;
                    mat.transparent = true;
                    mat.side = THREE.DoubleSide;
                    child.material = mat;
                    console.log('Applied sample text texture to plane023 in classroom');
                } catch (e) {
                    console.error('Failed to apply text texture to classroom plane023', e);
                }
            }
        });

        // Create a canvas-based texture with white sample text so we can apply it to plane023
        function createTextTexture(text, width = 1024, height = 512) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            // fill transparent background
            ctx.clearRect(0, 0, width, height);
            // white text
            ctx.fillStyle = '#fff';
            // Choose a large, readable font
            const fontSize = Math.floor(height * 0.08);
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            
            // Text wrapping setup
            const margin = Math.floor(height * 0.05);
            const maxWidth = width - (margin * 2);
            const lineHeight = fontSize * 1.2;
            
            // Split input into paragraphs
            const paragraphs = text.split('\n');
            let y = margin;
            
            for (const paragraph of paragraphs) {
                // Word wrap each paragraph
                const words = paragraph.split(' ');
                let line = '';
                
                for (const word of words) {
                    const testLine = line + (line ? ' ' : '') + word;
                    const metrics = ctx.measureText(testLine);
                    
                    if (metrics.width > maxWidth && line) {
                        ctx.fillText(line, margin, y);
                        line = word;
                        y += lineHeight;
                    } else {
                        line = testLine;
                    }
                }
                
                // Draw remaining text in the line
                if (line) {
                    ctx.fillText(line, margin, y);
                    y += lineHeight * 1.5; // Extra spacing between paragraphs
                }
            }
            
            const tex = new THREE.CanvasTexture(canvas);
            tex.encoding = THREE.sRGBEncoding;
            tex.needsUpdate = true;
            return tex;
        }


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
                    // If there's a plane mesh called plane023, apply a white sample text texture
                    if (child.name === 'plane023') {
                        try {
                            const sampleTex = createTextTexture('Sample Text');
                            // preserve existing material parameters when possible
                            const mat = child.material && child.material.clone ? child.material.clone() : new THREE.MeshBasicMaterial();
                            // Use MeshBasicMaterial so lighting doesn't wash out the white text
                            mat.map = sampleTex;
                            mat.transparent = true;
                            mat.side = THREE.DoubleSide;
                            child.material = mat;
                            console.log('Applied sample text texture to plane023');
                        } catch (e) {
                            console.error('Failed to apply text texture to plane023', e);
                        }
                    }
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

            // Create a separate sample text board added to the scene (not parented to model)
            // This avoids inheriting the model's large scale and makes the board easy to position visually.
            try {
                const initialText = 'Sample Text';
                // Plane geometry size in world units — choose larger defaults so it's visible
                const boardWidth = 130;
                const boardHeight = 65;
                const sampleTex = createTextTexture(initialText, 2048, 1024);
                const boardMat = new THREE.MeshBasicMaterial({ map: sampleTex, transparent: true, side: THREE.DoubleSide });
                // Render on top to avoid occlusion while you position it
                boardMat.depthTest = true;
                const boardGeo = new THREE.PlaneGeometry(boardWidth, boardHeight);
                const boardMesh = new THREE.Mesh(boardGeo, boardMat);
                boardMesh.name = 'sampleTextBoard';

                // Place initially near the model's world position: calculate world pos of model's origin
                const modelWorldPos = new THREE.Vector3();
                object.getWorldPosition(modelWorldPos);
                // Place it roughly 5 units to the right in world space (you can adjust)
                boardMesh.position.copy(modelWorldPos).add(new THREE.Vector3(80, 80, -45));
                // Ensure it renders above other objects
                // boardMesh.renderOrder removed; normal render order
                scene.add(boardMesh);
                window.sampleTextBoard = boardMesh;

                // Helper to update the text on the board
                window.updateSampleText = function (text, texWidth = 2048, texHeight = 1024) {
                    if (!window.sampleTextBoard) return;
                    try {
                        const newTex = createTextTexture(text, texWidth, texHeight);
                        const mat = window.sampleTextBoard.material;
                        mat.map = newTex;
                        mat.needsUpdate = true;
                        console.log('sampleTextBoard updated text to:', text);
                    } catch (e) {
                        console.error('Failed to update sampleTextBoard text', e);
                    }
                };

                // Draw a set of drawing instructions onto the board canvas
                // Instructions: [{type:'text', text:'Hello', x:10,y:10, font:'20px sans', color:'#fff'}, {type:'image', url:'...'}]
                window.drawInstructionsToBoard = async function (instructions, texWidth = 2048, texHeight = 1024) {
                    if (!window.sampleTextBoard) return;
                    const canvas = document.createElement('canvas');
                    canvas.width = texWidth;
                    canvas.height = texHeight;
                    const ctx = canvas.getContext('2d');
                    // Transparent background
                    ctx.clearRect(0, 0, texWidth, texHeight);
                    for (const ins of instructions) {
                        if (ins.type === 'text') {
                            ctx.fillStyle = ins.color || '#fff';
                            ctx.font = ins.font || `${Math.floor(texHeight * 0.04)}px sans-serif`;
                            ctx.textAlign = ins.align || 'left';
                            ctx.textBaseline = ins.baseline || 'top';
                            ctx.fillText(ins.text, ins.x || 0, ins.y || 0);
                        } else if (ins.type === 'image' && ins.url) {
                            try {
                                const img = await new Promise((res, rej) => {
                                    const i = new Image();
                                    i.crossOrigin = 'anonymous';
                                    i.onload = () => res(i);
                                    i.onerror = rej;
                                    i.src = ins.url;
                                });
                                const w = ins.width || img.width;
                                const h = ins.height || img.height;
                                ctx.drawImage(img, ins.x || 0, ins.y || 0, w, h);
                            } catch (e) {
                                console.error('Failed to load instruction image', e);
                            }
                        } else if (ins.type === 'line') {
                            ctx.strokeStyle = ins.color || '#fff';
                            ctx.lineWidth = ins.width || 2;
                            ctx.beginPath();
                            ctx.moveTo(ins.from[0], ins.from[1]);
                            ctx.lineTo(ins.to[0], ins.to[1]);
                            ctx.stroke();
                        }
                    }
                    const tex = new THREE.CanvasTexture(canvas);
                    tex.encoding = THREE.sRGBEncoding;
                    tex.needsUpdate = true;
                    window.sampleTextBoard.material.map = tex;
                    window.sampleTextBoard.material.needsUpdate = true;
                    console.log('Drew instructions to board');
                };

                // Helper to request the server render LaTeX and draw it to the board
                window.drawLaTeXOnBoard = async function (latex, x = 0, y = 0, width = null, height = null) {
                    try {
                        const resp = await fetch('/render_latex', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ latex })
                        });
                        const data = await resp.json();
                        if (data.url) {
                            await window.drawInstructionsToBoard([{ type: 'image', url: data.url, x, y, width, height }]);
                        } else {
                            console.error('LaTeX render failed', data);
                        }
                    } catch (e) {
                        console.error('Failed to render LaTeX on board', e);
                    }
                };

                // Helper to set the board position in world coordinates
                window.setSampleBoardOffset = function (x = 5, y = 5, z = 0) {
                    if (!window.sampleTextBoard) return;
                    // place relative to model's world origin
                    const pos = new THREE.Vector3();
                    object.getWorldPosition(pos);
                    pos.add(new THREE.Vector3(x, y, z));
                    window.sampleTextBoard.position.copy(pos);
                    console.log('sampleTextBoard world position set to', window.sampleTextBoard.position);
                };

                console.log('Created sampleTextBoard in scene (use updateSampleText / setSampleBoardOffset to tweak)');
            } catch (e) {
                console.error('Failed to create sample text board', e);
            }

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
        // ...existing code...
        renderer.render(scene, camera);
    }
    animate();
}
