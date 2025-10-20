// FBX viewer module — uses ES modules and CDN for Three.js
// This file creates a Three.js scene inside #fbx-container, loads classroom.fbx and model.fbx,
// and plays model@idle.fbx animation.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { avatarEvents } from './script.js';

const container = document.getElementById('fbx-container');

class FBXViewer {
    constructor(container){
        this.container = container;
        if (!this.container) return console.warn('FBX container not found');
        this._initRenderer();
        this._initScene();
        this.clock = new THREE.Clock();
        this.mixer = null;
        this.idleAction = null;
        this.fbxLoader = new FBXLoader();
        // gaze/engagement state used to drive apple behavior
        this._gazeEngaged = true;
        this._gazeTimer = null; // timer id for not-engaged -> show apple
        this._gazeNotEngagedSince = null;
        this._appleFadeTween = null; // used to track fade transitions
        this._loadAssets();
        this._bindEvents();
        // listen for gaze events if available
        try {
            window.addEventListener('gaze-engagement', (ev) => this._onGazeEngagement(ev.detail && ev.detail.engaged));
            window.addEventListener('gaze-tracking', (ev) => this._onGazeTracking(ev.detail && ev.detail.enabled));
        } catch (e) { /* ignore */ }
        this._animate();
    }

    _initRenderer(){
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.container.appendChild(this.renderer.domElement);
    }

    _initScene(){
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x000000);
        const CAMERA_FOV = 45;
        const CAMERA_NEAR = 0.1;
        const CAMERA_FAR = 1000;
        this.camera = new THREE.PerspectiveCamera(
            CAMERA_FOV,
            this.container.clientWidth / this.container.clientHeight,
            CAMERA_NEAR,
            CAMERA_FAR
        );
        const HEAD_DISTANCE = 100;
        this.camera.position.set(-30, 1.5 * 55, HEAD_DISTANCE);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.target.set(-30, 1.5 * 55, HEAD_DISTANCE - 1);
        this.controls.enableZoom = false;
        this.controls.enablePan = false;
        this.controls.minPolarAngle = Math.PI * 0.4;
        this.controls.maxPolarAngle = Math.PI * 0.55;
        this.controls.minAzimuthAngle = -Math.PI * 0.2;
        this.controls.maxAzimuthAngle = Math.PI * 0.2;
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemi.position.set(0, 20, 0);
        this.scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 0.8);
        dir.position.set(5, 10, 7.5);
        this.scene.add(dir);

        const grid = new THREE.GridHelper(10, 10, 0x222222, 0x111111);
        grid.material.opacity = 0.15;
        grid.material.transparent = true;
        this.scene.add(grid);
    }

    _bindEvents(){
        window.addEventListener('resize', ()=> this._onWindowResize());
    }

    _onWindowResize(){
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }

    _loadAssets(){
        const classroomPath = '/static/fbx/ClassRoom.fbx';
        const modelPath = '/static/fbx/model.fbx';
        const animPath = '/static/fbx/model@Idle.fbx';

        this.fbxLoader.load(classroomPath, (classroomObj) => this._onClassroomLoaded(classroomObj), undefined, (err) => console.error('Error loading classroom FBX:', err));
        this.modelPath = modelPath;
        this.animPath = animPath;
    }

    _applyTextTextureToMesh(mesh, text){
        try {
            const sampleTex = this._createTextTexture(text);
            const mat = mesh.material && mesh.material.clone ? mesh.material.clone() : new THREE.MeshBasicMaterial();
            mat.map = sampleTex;
            mat.transparent = true;
            mat.side = THREE.DoubleSide;
            mesh.material = mat;
        } catch (e){
            console.error('Failed to apply text texture', e);
        }
    }

    _createTextTexture(text, width = 1024, height = 512){
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = '#fff';
        const fontSize = Math.floor(height * 0.08);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        const margin = Math.floor(height * 0.05);
        const maxWidth = width - (margin * 2);
        const lineHeight = fontSize * 1.2;
        const paragraphs = text.split('\n');
        let y = margin;
        for (const paragraph of paragraphs){
            const words = paragraph.split(' ');
            let line = '';
            for (const word of words){
                const testLine = line + (line ? ' ' : '') + word;
                const metrics = ctx.measureText(testLine);
                if (metrics.width > maxWidth && line){
                    ctx.fillText(line, margin, y);
                    line = word;
                    y += lineHeight;
                } else {
                    line = testLine;
                }
            }
            if (line){ ctx.fillText(line, margin, y); y += lineHeight * 1.5; }
        }
        const tex = new THREE.CanvasTexture(canvas);
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;
        return tex;
    }

    _onClassroomLoaded(classroomObj){
        classroomObj.position.set(0,0,0);
        this.scene.add(classroomObj);
        classroomObj.traverse((child)=>{
            if (child.isMesh && child.name === 'plane023') this._applyTextTextureToMesh(child, 'Sample Text');
        });

        // now load model
        this.fbxLoader.load(this.modelPath, (object) => this._onModelLoaded(object), undefined, (err) => console.error('Error loading model FBX:', err));
    }

    _onModelLoaded(object){
        object.position.set(-35,0,-50);
        object.scale.set(55,55,55);
        object.traverse((child)=>{
            if (!child.isMesh) return;
            child.castShadow = true; child.receiveShadow = true;
            if (child.name === 'plane023') this._applyTextTextureToMesh(child, 'Sample Text');
            if (child.morphTargetInfluences && child.morphTargetInfluences.length > 0){
                if (child.name === 'AvatarHead') this._setupAvatarMorphs(child);
            }
        });
        this.scene.add(object);
        this._createSampleBoard(object);
        // create apple sprite attached to avatar head
        try { this._createAppleSprite(object); } catch(e){ console.error('Failed to create apple sprite', e); }
        this.fbxLoader.load(this.animPath, (anim)=> this._onAnimLoaded(anim, object), undefined, (err) => console.error('Failed to load idle animation:', err));
    }

    _createAppleSprite(object){
        // create a small canvas texture with an apple emoji drawn centrally
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        // transparent background
        ctx.clearRect(0,0,size,size);
        // draw emoji using font; fallback to a red circle if emoji unsupported
        const fontSize = Math.floor(size * 0.7);
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        try{
            ctx.fillText('🍎', size/2, size/2);
        }catch(e){
            // draw a simple red apple graphic
            ctx.fillStyle = '#c62828';
            ctx.beginPath(); ctx.arc(size/2, size/2, size*0.28, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#2e7d32'; ctx.fillRect(size/2 + size*0.12, size/2 - size*0.28, size*0.05, size*0.2);
        }

        const tex = new THREE.CanvasTexture(canvas);
        tex.encoding = THREE.sRGBEncoding;
        tex.needsUpdate = true;

    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 1.0 });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(12,12,1); // adjust to roughly head size; tuned for model scale
        sprite.name = 'appleSprite';
        this.scene.add(sprite);
        this.appleSprite = sprite;

        // store reference to avatar object for positioning; prefer AvatarHead or model root
        this.avatarObject = object;
        // initial hide until positioned
    sprite.visible = false;
    // ensure material opacity is 0 while hidden to support fades
    try { sprite.material.opacity = 0; } catch(e) { /* ignore */ }

        // expose simple helpers for runtime tweaking from console
        try{
            window.toggleAppleSprite = (v) => {
                if (!this.appleSprite) return;
                const show = typeof v === 'boolean' ? v : !this.appleSprite.visible;
                this.appleSprite.visible = show;
                try{ this.appleSprite.material.opacity = show ? 1.0 : 0.0; } catch(e) {}
                console.log('toggleAppleSprite ->', show, this.appleSprite);
            };
            window.setAppleSpriteScale = (s) => { if (!this.appleSprite) return; const val = typeof s === 'number' ? s : 18; this.appleSprite.scale.set(val, val, 1); };
        }catch(e){ /* ignore */ }
    }

    // Gaze event handlers
    _onGazeTracking(enabled){
        // if tracking is off, hide apple immediately and clear timers
        if (!enabled){
            // Cancel any running fade
            if (this._appleFadeTween && this._appleFadeTween.cancel) try{ this._appleFadeTween.cancel(); }catch(e){}
        }
        console.log('_onGazeTracking', enabled);
        if (!enabled){
            this._clearGazeTimer();
            if (this.appleSprite){
                this.appleSprite.visible = false;
                try{ this.appleSprite.material.opacity = 0; }catch(e){}
            }
            this._gazeEngaged = true; // treat as engaged so apple won't reappear
        }
    }

    _onGazeEngagement(engaged){
        console.log('_onGazeEngagement', engaged);
        // engaged === true/false
        this._gazeEngaged = !!engaged;
        if (this._gazeEngaged){
            // user re-engaged: fade apple out over 2s
            this._clearGazeTimer();
            this._fadeAppleOut(2000);
        } else {
            // user not engaged: start 3s timer (only if not already running), then show apple
            if (!this._gazeTimer) {
                this._gazeNotEngagedSince = Date.now();
                console.log('Starting disengagement timer for apple appearance');
                this._gazeTimer = setTimeout(()=>{
                    console.log('Disengagement timer fired: showing apple');
                    this._showAppleImmediate();
                    this._gazeTimer = null;
                }, 3000);
            }
        }
    }

    _clearGazeTimer(){ if (this._gazeTimer){ clearTimeout(this._gazeTimer); this._gazeTimer = null; } }

    _showAppleImmediate(){
        if (!this.appleSprite) return;
        // Cancel any running fade
        if (this._appleFadeTween && this._appleFadeTween.cancel) try{ this._appleFadeTween.cancel(); }catch(e){}
        try{
            this.appleSprite.visible = true;
            this.appleSprite.material.opacity = 1.0;
        } catch(e){}
        console.log('_showAppleImmediate');
    }

    _fadeAppleOut(durationMs = 2000){
        if (!this.appleSprite) return;
        // cancel any running fade
        if (this._appleFadeTween && this._appleFadeTween.cancel) try{ this._appleFadeTween.cancel(); }catch(e){}
        const start = performance.now();
        const startOpacity = (this.appleSprite.material && typeof this.appleSprite.material.opacity === 'number') ? this.appleSprite.material.opacity : 1.0;
        const step = (now) => {
            const t = Math.min(1, (now - start) / durationMs);
            const newOp = startOpacity * (1 - t);
            try{ this.appleSprite.material.opacity = newOp; } catch(e){}
            if (t < 1){ this._appleFadeTween = { cancel: false }; requestAnimationFrame(step); }
            else {
                try{
                    this.appleSprite.visible = false;
                    this.appleSprite.material.opacity = 0.0;
                }catch(e){}
                this._appleFadeTween = null;
            }
        };
        requestAnimationFrame(step);
    }

    _setupAvatarMorphs(child){
        window.avatarMorphMesh = child;
        const visemeToMorph = {0:'sil',1:'PP',2:'FF',3:'TH',4:'DD',5:'kk',6:'CH',7:'SS',8:'nn',9:'RR',10:'aa',11:'E',12:'ih',13:'oh',14:'ou'};
        const morphDict = child.morphTargetDictionary;
        window.avatarVisemeMap = {};
        for (const [visemeId, morphName] of Object.entries(visemeToMorph)){
            if (morphDict && morphDict.hasOwnProperty(morphName)) window.avatarVisemeMap[visemeId] = morphDict[morphName];
        }
    }

    _createSampleBoard(object){
        try{
            const initialText = 'Welcome\nMy name is Nova\nwhat would you like to learn today';
            const boardWidth = 130; const boardHeight = 65;
            const sampleTex = this._createTextTexture(initialText, 2048, 1024);
            const boardMat = new THREE.MeshBasicMaterial({ map: sampleTex, transparent: true, side: THREE.DoubleSide });
            boardMat.depthTest = true;
            const boardGeo = new THREE.PlaneGeometry(boardWidth, boardHeight);
            const boardMesh = new THREE.Mesh(boardGeo, boardMat);
            boardMesh.name = 'sampleTextBoard';
            const modelWorldPos = new THREE.Vector3();
            object.getWorldPosition(modelWorldPos);
            boardMesh.position.copy(modelWorldPos).add(new THREE.Vector3(80,80,-45));
            this.scene.add(boardMesh);
            window.sampleTextBoard = boardMesh;

            window.updateSampleText = (text, texWidth = 2048, texHeight = 1024) => {
                if (!window.sampleTextBoard) return;
                try{ const newTex = this._createTextTexture(text, texWidth, texHeight); const mat = window.sampleTextBoard.material; mat.map = newTex; mat.needsUpdate = true; }
                catch(e){ console.error('Failed to update sampleTextBoard text', e); }
            };

            window.drawInstructionsToBoard = async (instructions, texWidth = 2048, texHeight = 1024) => {
                if (!window.sampleTextBoard) return;
                const canvas = document.createElement('canvas'); canvas.width = texWidth; canvas.height = texHeight; const ctx = canvas.getContext('2d'); ctx.clearRect(0,0,texWidth,texHeight);
                for (const ins of instructions){
                    if (ins.type === 'text'){ ctx.fillStyle = ins.color || '#fff'; ctx.font = ins.font || `${Math.floor(texHeight * 0.04)}px sans-serif`; ctx.textAlign = ins.align || 'left'; ctx.textBaseline = ins.baseline || 'top'; ctx.fillText(ins.text, ins.x || 0, ins.y || 0); }

                    else if (ins.type === 'image' && ins.url){
                        try{ const img = await new Promise((res, rej)=>{ const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = ()=> res(i); i.onerror = rej; i.src = ins.url; }); const w = ins.width || img.width; const h = ins.height || img.height; ctx.drawImage(img, ins.x || 0, ins.y || 0, w, h);} catch(e){ console.error('Failed to load instruction image', e); }
                    } else if (ins.type === 'line'){ ctx.strokeStyle = ins.color || '#fff'; ctx.lineWidth = ins.width || 2; ctx.beginPath(); ctx.moveTo(ins.from[0], ins.from[1]); ctx.lineTo(ins.to[0], ins.to[1]); ctx.stroke(); }
                }
                const tex = new THREE.CanvasTexture(canvas); tex.encoding = THREE.sRGBEncoding; tex.needsUpdate = true; window.sampleTextBoard.material.map = tex; window.sampleTextBoard.material.needsUpdate = true; console.log('Drew instructions to board');
            };

            window.drawLaTeXOnBoard = async (latex, x = 0, y = 0, width = null, height = null) => {
                try{ const resp = await fetch('/render_latex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ latex }) }); const data = await resp.json(); if (data.url) await window.drawInstructionsToBoard([{ type: 'image', url: data.url, x, y, width, height }]); else console.error('LaTeX render failed', data); } catch (e){ console.error('Failed to render LaTeX on board', e); }
            };

            window.setSampleBoardOffset = (x = 5, y = 5, z = 0) => { if (!window.sampleTextBoard) return; const pos = new THREE.Vector3(); object.getWorldPosition(pos); pos.add(new THREE.Vector3(x, y, z)); window.sampleTextBoard.position.copy(pos); };

            console.log('Created sampleTextBoard in scene (use updateSampleText / setSampleBoardOffset to tweak)');
        } catch (e){ console.error('Failed to create sample text board', e); }
    }

    _onAnimLoaded(anim, object){
        this.mixer = new THREE.AnimationMixer(object);
        const idleClip = anim.animations && anim.animations.length ? anim.animations[0] : null;
        if (idleClip){ this.idleAction = this.mixer.clipAction(idleClip); this.idleAction.play(); }
        else console.warn('No idle animation clip found');

        avatarEvents.addEventListener('startSpeaking', ()=> { if (this.idleAction) this.idleAction.timeScale = 1.5; });
        avatarEvents.addEventListener('stopSpeaking', ()=> { if (this.idleAction) this.idleAction.timeScale = 1.0; });
    }

    _animate(){
        const loop = ()=>{
            requestAnimationFrame(loop);
            const delta = this.clock.getDelta();
            if (this.mixer) this.mixer.update(delta);
            this.controls.update();
            // update apple sprite to follow avatar head
            try{
                if (this.appleSprite && this.avatarObject){
                    // prefer morph mesh if available (set in _setupAvatarMorphs)
                    let headWorldPos = new THREE.Vector3();
                    if (window.avatarMorphMesh){
                        window.avatarMorphMesh.getWorldPosition(headWorldPos);
                    } else {
                        const head = this.avatarObject.getObjectByName && this.avatarObject.getObjectByName('AvatarHead');
                        if (head) head.getWorldPosition(headWorldPos);
                        else this.avatarObject.getWorldPosition(headWorldPos);
                    }
                    // the avatar is scaled (e.g., 55). Multiply head position by avatar scale so offsets scale with model
                    const avatarScale = (this.avatarObject && this.avatarObject.scale) ? (this.avatarObject.scale.x || this.avatarObject.scale.y || this.avatarObject.scale.z || 1) : 1;
                    const scaledHeadPos = new THREE.Vector3(headWorldPos.x, headWorldPos.y , headWorldPos.z);
                    // offset sprite slightly above the head (scaled)
                    const offset = new THREE.Vector3(-1, 1.7 * avatarScale, 20);
                    scaledHeadPos.add(offset);
                    this.appleSprite.position.copy(scaledHeadPos);
                    // ensure sprite faces the camera (Three.Sprite does this by default)
                    // do not force visibility here; visibility and opacity are controlled by gaze logic
                    try{
                        if (typeof this.appleSprite.material.opacity === 'number' && this.appleSprite.material.opacity > 0) this.appleSprite.visible = true;
                    }catch(e){}
                }
            } catch(e){ /* non-fatal */ }
            this.renderer.render(this.scene, this.camera);
        };
        loop();
    }
}

if (container) new FBXViewer(container);
