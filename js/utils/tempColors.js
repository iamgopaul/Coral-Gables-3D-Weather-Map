import { CONFIG, TEMP_COLOR_GRADIENT } from '../config.js';

/**
 * Map absolute temperature (°F) to RGB using `TEMP_COLOR_GRADIENT` (legend scale).
 */
export function temperatureToColor(temp) {
    const gradient = TEMP_COLOR_GRADIENT;
    if (temp == null || Number.isNaN(temp)) {
        return [...gradient[Math.floor(gradient.length / 2)].color];
    }

    for (let i = 0; i < gradient.length - 1; i++) {
        if (temp >= gradient[i].temp && temp <= gradient[i + 1].temp) {
            const t = (temp - gradient[i].temp) / (gradient[i + 1].temp - gradient[i].temp);
            return [
                Math.round(gradient[i].color[0] + t * (gradient[i + 1].color[0] - gradient[i].color[0])),
                Math.round(gradient[i].color[1] + t * (gradient[i + 1].color[1] - gradient[i].color[1])),
                Math.round(gradient[i].color[2] + t * (gradient[i + 1].color[2] - gradient[i].color[2]))
            ];
        }
    }

    return temp < gradient[0].temp ? [...gradient[0].color] : [...gradient[gradient.length - 1].color];
}

/**
 * Same legend as the grid: normalize temperature to the current frame’s min/max,
 * then sample the classic gradient from cold → hot (matches relief semantics).
 */
export function classicReliefTempRgb(temp, minT, maxT, range) {
    const eps = CONFIG.GRID_TEMP_RANGE_EPSILON || 1e-6;
    const n =
        range < eps || temp == null || Number.isNaN(temp)
            ? 0.5
            : Math.max(0, Math.min(1, (temp - minT) / Math.max(range, eps)));
    const g = TEMP_COLOR_GRADIENT;
    const tMin = g[0].temp;
    const tMax = g[g.length - 1].temp;
    const tSynth = tMin + n * (tMax - tMin);
    return temperatureToColor(tSynth);
}

/** CSS `linear-gradient` matching `TEMP_COLOR_GRADIENT` stop positions (°F). */
export function tempGradientCssLinear() {
    const g = TEMP_COLOR_GRADIENT;
    if (!g.length) {
        return 'linear-gradient(to right, #888, #888)';
    }
    const t0 = g[0].temp;
    const t1 = g[g.length - 1].temp;
    const span = Math.abs(t1 - t0) < 1e-6 ? 1 : t1 - t0;
    const parts = g.map((stop) => {
        const pct = Math.max(0, Math.min(100, ((stop.temp - t0) / span) * 100));
        const [r, gn, b] = stop.color;
        return `rgb(${r},${gn},${b}) ${pct.toFixed(2)}%`;
    });
    return `linear-gradient(to right, ${parts.join(', ')})`;
}
