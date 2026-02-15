// src/3d/modelBaker.js
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const ModelBaker = {
    renderer: null,
    scene: null,
    camera: null,
    light: null,
    ambient: null,
    loader: new GLTFLoader(),
    
    init() {
        if (this.renderer) return;

        this.renderer = new THREE.WebGLRenderer({ 
            alpha: true, 
            antialias: true,
            preserveDrawingBuffer: true 
        });
        
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.scene = new THREE.Scene();
        
        this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10000);
        this.camera.position.set(0, 1000, 0); 
        this.camera.lookAt(0, 0, 0);

        this.ambient = new THREE.AmbientLight(0xffffff, 1.5);
        this.scene.add(this.ambient);

        this.light = new THREE.DirectionalLight(0xffffff, 1.0);
        this.light.position.set(500, 1000, 200); 
        this.scene.add(this.light);
    },

    async bakeFromUrl(url, resolution = 1024, rotationY = 0, zoom = 1.0) {
        this.init();
        
        return new Promise((resolve, reject) => {
            this.loader.load(url, async (gltf) => {
                const result = await this.bakeModel(gltf.scene, resolution, rotationY, zoom);
                resolve(result);
            }, undefined, reject);
        });
    },

    async bakeFromFile(file, resolution = 1024, rotationY = 0, zoom = 1.0) {
        this.init();
        const url = URL.createObjectURL(file);
        
        return new Promise((resolve, reject) => {
            this.loader.load(url, async (gltf) => {
                try {
                    const result = await this.bakeModel(gltf.scene, resolution, rotationY, zoom);
                    URL.revokeObjectURL(url);
                    resolve(result);
                } catch (error) {
                    URL.revokeObjectURL(url);
                    reject(error);
                }
            }, undefined, (error) => {
                URL.revokeObjectURL(url);
                reject(error);
            });
        });
    },

    loadImage(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = dataUrl;
        });
    },

    async bakeModel(modelGroup, resolution, rotationY = 0, zoom = 1.0) {
        while(this.scene.children.length > 2) { 
            const obj = this.scene.children[this.scene.children.length - 1];
            this.scene.remove(obj);
        }

        const rawBox = new THREE.Box3().setFromObject(modelGroup);
        const center = rawBox.getCenter(new THREE.Vector3());
        modelGroup.position.sub(center);

        const wrapper = new THREE.Group();
        wrapper.add(modelGroup);
        wrapper.rotation.y = rotationY;
        this.scene.add(wrapper);

        const finalBox = new THREE.Box3().setFromObject(wrapper);
        const finalSize = finalBox.getSize(new THREE.Vector3());

        const maxDim = Math.max(finalSize.x, finalSize.z);
        const margin = maxDim * 0.1; 
        
        // --- ZMIANA: Uwzględniamy ZOOM aparatu ---
        const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1.0;
        const viewSize = ((maxDim / 2) + margin) / safeZoom;

        this.camera.left = -viewSize;
        this.camera.right = viewSize;
        this.camera.top = viewSize;
        this.camera.bottom = -viewSize;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(resolution, resolution);

        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.render(this.scene, this.camera);
        const albedoUrl = this.renderer.domElement.toDataURL("image/png");

        this.scene.overrideMaterial = new THREE.MeshNormalMaterial();
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.render(this.scene, this.camera);
        const normalUrl = this.renderer.domElement.toDataURL("image/png");
        
        this.scene.overrideMaterial = null;

        const albedoImg = await this.loadImage(albedoUrl);
        const normalImg = await this.loadImage(normalUrl);
        
        return { albedo: albedoImg, normal: normalImg };
    }
};
