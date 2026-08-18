const HEX_COLOR_RE = /^#([0-9a-f]{6})$/i;
const SHORT_HEX_COLOR_RE = /^#([0-9a-f]{3})$/i;

export const RING_BUILDING_COLOR_KEYS = Object.freeze([
    'building_01',
    'building_02',
    'building_03',
    'building_04',
    'building_05',
    'building_06',
    'building_07',
    'building_08',
    'building_09',
    'building_10',
    'mega_building_01',
    'storefronts'
]);

const DEFAULT_BUILDING_COLORS = Object.freeze({
    building_01: '#9acaf5',
    building_02: '#9a9ef5',
    building_03: '#c59af5',
    building_04: '#e99af5',
    building_05: '#f59ae3',
    building_06: '#f59abe',
    building_07: '#f5a79a',
    building_08: '#f5d19a',
    building_09: '#f5f29a',
    building_10: '#d9f59a',
    mega_building_01: '#b9d7ff',
    storefronts: '#b9e8ff'
});

export const RING_COLOR_DEFAULTS = Object.freeze({
    dome: Object.freeze({
        shell: '#438caf',
        frame: '#62c5ec'
    }),
    buildings: DEFAULT_BUILDING_COLORS
});

let activeRingColors = cloneRingColorConfig(RING_COLOR_DEFAULTS);

function cloneRingColorConfig(config) {
    return {
        dome: { ...config.dome },
        buildings: { ...config.buildings }
    };
}

export function normalizeRingHexColor(value, fallback = '#ffffff') {
    const text = String(value ?? '').trim();
    const shortMatch = SHORT_HEX_COLOR_RE.exec(text);
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].toLowerCase();
        return `#${r}${r}${g}${g}${b}${b}`;
    }
    if (HEX_COLOR_RE.test(text)) return text.toLowerCase();
    return HEX_COLOR_RE.test(String(fallback)) ? String(fallback).toLowerCase() : '#ffffff';
}

export function normalizeRingColorConfig(patch = {}, base = activeRingColors) {
    const source = patch && typeof patch === 'object' ? patch : {};
    const sourceDome = source.dome && typeof source.dome === 'object' ? source.dome : {};
    const sourceBuildings = source.buildings && typeof source.buildings === 'object'
        ? source.buildings
        : {};
    const next = {
        dome: {
            shell: normalizeRingHexColor(sourceDome.shell, base.dome.shell),
            frame: normalizeRingHexColor(sourceDome.frame, base.dome.frame)
        },
        buildings: {}
    };

    for (const key of RING_BUILDING_COLOR_KEYS) {
        next.buildings[key] = normalizeRingHexColor(sourceBuildings[key], base.buildings[key]);
    }
    return next;
}

export function getRingColorConfig() {
    return cloneRingColorConfig(activeRingColors);
}

export function setRingColorConfig(patch = {}) {
    activeRingColors = normalizeRingColorConfig(patch, activeRingColors);
    return getRingColorConfig();
}

export function resetRingColorConfig() {
    activeRingColors = cloneRingColorConfig(RING_COLOR_DEFAULTS);
    return getRingColorConfig();
}

function setMaterialColor(material, property, value) {
    const color = material?.[property];
    if (!color || typeof color.set !== 'function') return false;
    color.set(value);
    material.needsUpdate = true;
    return true;
}

export function applyRingDomeMaterialColor(material, part = 'shell') {
    if (!material) return material;
    const role = part === 'frame' ? 'dome-frame' : 'dome-shell';
    material.userData = { ...(material.userData || {}), ringColorRole: role };
    setMaterialColor(material, 'color', activeRingColors.dome[part === 'frame' ? 'frame' : 'shell']);
    return material;
}

export function applyRingBuildingMaterialColor(material, materialKey) {
    const key = String(materialKey || '');
    if (!material || !Object.prototype.hasOwnProperty.call(activeRingColors.buildings, key)) return material;
    material.userData = {
        ...(material.userData || {}),
        ringColorRole: 'building',
        ringColorKey: key
    };
    // Tekstury emissive są maską okien. Zmiana emissive daje wyraźny kolor
    // budynku bez barwienia czarnych ścian i bez utraty detalu albedo.
    setMaterialColor(material, 'emissive', activeRingColors.buildings[key]);
    return material;
}

export function applyRingColorToMaterial(material) {
    const role = material?.userData?.ringColorRole;
    if (role === 'dome-shell') return applyRingDomeMaterialColor(material, 'shell');
    if (role === 'dome-frame') return applyRingDomeMaterialColor(material, 'frame');
    if (role === 'building') {
        return applyRingBuildingMaterialColor(material, material.userData.ringColorKey);
    }
    return material;
}

export function applyRingColorsToObject(root) {
    if (!root) return 0;
    const materials = new Set();
    const collect = (material) => {
        if (!material) return;
        if (Array.isArray(material)) {
            for (const entry of material) collect(entry);
            return;
        }
        materials.add(material);
    };
    const collectObject = (object) => {
        collect(object?.material);
        collect(object?.userData?.nearMaterial);
        collect(object?.userData?.farMaterial);
    };

    if (typeof root.traverse === 'function') root.traverse(collectObject);
    else collectObject(root);
    for (const material of materials) applyRingColorToMaterial(material);
    return materials.size;
}

