// FBX viewer module — uses ES modules and CDN for Three.js
// This file will create a Three.js scene inside #fbx-container, load model.fbx and model@idle.fbx animation, and play it.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const container = document.getElementById('fbx-container');
if (!container) {
    console.warn('FBX container not found');
} else {
    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
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

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        const delta = clock.getDelta();
        if (mixer) mixer.update(delta);
        renderer.render(scene, camera);
    }
    animate();
}
