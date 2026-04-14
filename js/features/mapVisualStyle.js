/**
 * Grid look preset: Gulf Glass (default), Basic Grid, Tidefield Membrane (wow).
 * Grid/point colors follow `TEMP_COLOR_GRADIENT` for every look; presets differ in alpha, beacons, membrane.
 * Runtime choice persists in localStorage; CONFIG.MAP_VISUAL_STYLE is the default when unset.
 */
import { CONFIG } from '../config.js';

const STORAGE_KEY = 'coralGablesMapVisualStyle';

export const VISUAL_STYLE_GULF_GLASS = 'gulf-glass';
/** @deprecated use VISUAL_STYLE_BASIC_GRID — value `first-grid` still accepted for localStorage */
export const VISUAL_STYLE_FIRST_GRID = 'first-grid';
export const VISUAL_STYLE_BASIC_GRID = 'basic-grid';
export const VISUAL_STYLE_TIDEFIELD_MEMBRANE = 'tidefield-membrane';

function readStoredStyle() {
    try {
        if (typeof localStorage === 'undefined') {
            return null;
        }
        return localStorage.getItem(STORAGE_KEY);
    } catch {
        return null;
    }
}

function normalizeStyle(v) {
    if (v === VISUAL_STYLE_TIDEFIELD_MEMBRANE) {
        return VISUAL_STYLE_TIDEFIELD_MEMBRANE;
    }
    if (v === VISUAL_STYLE_BASIC_GRID || v === VISUAL_STYLE_FIRST_GRID) {
        return VISUAL_STYLE_BASIC_GRID;
    }
    if (v === VISUAL_STYLE_GULF_GLASS) {
        return VISUAL_STYLE_GULF_GLASS;
    }
    return VISUAL_STYLE_GULF_GLASS;
}

let runtimeStyle = normalizeStyle(readStoredStyle() || CONFIG.MAP_VISUAL_STYLE);

try {
    if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw === VISUAL_STYLE_FIRST_GRID) {
            localStorage.setItem(STORAGE_KEY, VISUAL_STYLE_BASIC_GRID);
        }
    }
} catch {
    /* ignore */
}

export function getMapVisualStyle() {
    return runtimeStyle;
}

/**
 * @param {string} style — `gulf-glass` | `basic-grid` | `tidefield-membrane` (`first-grid` is accepted as legacy)
 * @param {boolean} [persist=true] — write localStorage
 */
export function setMapVisualStyle(style, persist = true) {
    runtimeStyle = normalizeStyle(style);
    if (persist) {
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, runtimeStyle);
            }
        } catch {
            /* private mode / quota */
        }
    }
}

export function isTidefieldMembraneActive() {
    return runtimeStyle === VISUAL_STYLE_TIDEFIELD_MEMBRANE;
}

export function isGulfGlassActive() {
    return runtimeStyle === VISUAL_STYLE_GULF_GLASS;
}

export function isBasicGridActive() {
    return runtimeStyle === VISUAL_STYLE_BASIC_GRID;
}
