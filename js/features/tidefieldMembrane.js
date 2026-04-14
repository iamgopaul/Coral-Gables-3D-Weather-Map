/**
 * Tidefield Membrane — translucent crumpled grid, micro-ripples, station beacons (styled in main),
 * tethers from stations to sheet, refresh pulse. Loading sweep is the shared CSS overlay in main.
 */
import { CONFIG } from '../config.js';
import { isTidefieldMembraneActive } from './mapVisualStyle.js';

/** @type {{ Graphic?: any; Polygon?: any; Polyline?: any; SimpleFillSymbol?: any; SimpleLineSymbol?: any }} */
let mods = {};

/**
 * Call from main once ArcGIS modules are available (same require as visualization).
 */
export function setTidefieldModules(Graphic, Polygon, Polyline, SimpleFillSymbol, SimpleLineSymbol) {
    mods = { Graphic, Polygon, Polyline, SimpleFillSymbol, SimpleLineSymbol };
}

/** @type {{ id: string, gridLayer: any, membraneLayer: any, tetherLayer: any, views: any[], baseRings: Map<any, number[][]> }[]} */
const contexts = [];

let rafId = null;
let t0 = performance.now();
let pulseStart = 0;

function enabled() {
    return isTidefieldMembraneActive();
}

export function registerTidefieldContext(id, { gridLayer, membraneLayer, tetherLayer, views }) {
    if (!enabled()) {
        return;
    }
    const ctx = { id, gridLayer, membraneLayer, tetherLayer, views: views || [], baseRings: new Map() };
    const i = contexts.findIndex((c) => c.id === id);
    if (i >= 0) {
        contexts[i] = ctx;
    } else {
        contexts.push(ctx);
    }
    startLoopIfNeeded();
}

export function unregisterTidefieldContext(id) {
    const c = contexts.find((x) => x.id === id);
    if (c) {
        try {
            c.membraneLayer?.removeAll();
            c.tetherLayer?.removeAll();
        } catch {
            /* ignore */
        }
    }
    const i = contexts.findIndex((x) => x.id === id);
    if (i >= 0) {
        contexts.splice(i, 1);
    }
    if (contexts.length === 0) {
        stopLoop();
    }
}

export function triggerMembranePulse() {
    if (!enabled()) {
        return;
    }
    pulseStart = performance.now();
}

/**
 * @param {string} contextId
 * @param {object[]} samplingPoints — for tether lines to the sheet
 */
export function afterGridRebuild(contextId, samplingPoints) {
    if (!enabled()) {
        return;
    }
    const ctx = contexts.find((c) => c.id === contextId);
    if (!ctx) {
        return;
    }
    seedBaseRings(ctx);
    rebuildTethers(ctx, samplingPoints || []);
}

function seedBaseRings(ctx) {
    ctx.baseRings.clear();
    try {
        ctx.gridLayer.graphics.forEach((g) => {
            const ring = g.geometry?.rings?.[0];
            if (!ring || ring.length < 3) {
                return;
            }
            ctx.baseRings.set(
                g,
                ring.map((pt) => [
                    pt[0],
                    pt[1],
                    typeof pt[2] === 'number' ? pt[2] : CONFIG.GRID_BASE_ELEVATION_METERS
                ])
            );
        });
    } catch {
        /* ignore */
    }
}

function rebuildTethers(ctx, samplingPoints) {
    if (!CONFIG.TIDEfield_TETHERS_ENABLED || !ctx.tetherLayer || !mods.Graphic || !mods.Polyline || !mods.SimpleLineSymbol) {
        return;
    }
    const { Graphic, Polyline, SimpleLineSymbol } = mods;
    try {
        ctx.tetherLayer.removeAll();
        const z0 = CONFIG.TIDEfield_TETHER_Z_BOTTOM ?? 35;
        const z1 =
            CONFIG.TIDEfield_TETHER_Z_TOP ??
            CONFIG.GRID_BASE_ELEVATION_METERS + (CONFIG.GRID_TEMP_RELIEF_METERS || 3200) * 0.48;
        const col = CONFIG.TIDEfield_TETHER_COLOR || [72, 230, 255, 150];
        const w = CONFIG.TIDEfield_TETHER_WIDTH ?? 1.25;

        samplingPoints.forEach((point) => {
            if (!point || point.weatherData?.error) {
                return;
            }
            const poly = new Polyline({
                paths: [
                    [
                        [point.longitude, point.latitude, z0],
                        [point.longitude, point.latitude, z1]
                    ]
                ],
                spatialReference: { wkid: 4326 }
            });
            ctx.tetherLayer.add(
                new Graphic({
                    geometry: poly,
                    symbol: new SimpleLineSymbol({
                        color: col,
                        width: w,
                        cap: 'round'
                    })
                })
            );
        });
    } catch {
        /* ignore */
    }
}

function stopLoop() {
    if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

let frameN = 0;
function startLoopIfNeeded() {
    if (!enabled() || contexts.length === 0 || rafId != null) {
        return;
    }
    t0 = performance.now();
    const tick = () => {
        if (!enabled() || contexts.length === 0) {
            stopLoop();
            return;
        }
        frameN += 1;
        const now = performance.now();
        const t = (now - t0) / 1000;
        const pulseMs = now - pulseStart;
        const pulseDur = CONFIG.TIDEfield_PULSE_DURATION_MS ?? 2400;
        let pulseBoost = 0;
        if (pulseStart > 0 && pulseMs < pulseDur) {
            const u = pulseMs / pulseDur;
            pulseBoost = Math.sin(Math.PI * u) * (CONFIG.TIDEfield_PULSE_STRENGTH ?? 1.35);
        }

        const skipRipple = frameN % 2 === 0;
        for (const ctx of contexts) {
            try {
                if (!skipRipple) {
                    updateRipplesForContext(ctx, t, pulseBoost);
                }
            } catch {
                /* ignore */
            }
            for (const v of ctx.views) {
                try {
                    if (v && !v.destroyed && typeof v.requestRender === 'function') {
                        v.requestRender();
                    }
                } catch {
                    /* ignore */
                }
            }
        }
        rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
}

function updateRipplesForContext(ctx, t, pulseBoost) {
    const { Polygon } = mods;
    if (!Polygon || ctx.baseRings.size === 0) {
        return;
    }
    const amp = (CONFIG.TIDEfield_RIPPLE_METERS ?? 18) * (1 + pulseBoost);
    const k = CONFIG.TIDEfield_RIPPLE_SPATIAL_FREQ ?? 0.00085;
    const omega = CONFIG.TIDEfield_RIPPLE_SPEED ?? 1.15;

    ctx.baseRings.forEach((baseRing, graphic) => {
        try {
            if (!graphic.geometry) {
                return;
            }
            const ring = baseRing.map(([lon, lat, z]) => {
                const phase = k * (lon * 111320 + lat * 110540) + t * omega;
                const micro = Math.sin(phase) + 0.35 * Math.sin(phase * 2.3 + t * 0.7);
                return [lon, lat, z + amp * micro];
            });
            graphic.geometry = new Polygon({
                rings: [ring],
                spatialReference: { wkid: 4326 }
            });
        } catch {
            /* ignore cell */
        }
    });
}

export function stopMembraneLoop() {
    stopLoop();
}
