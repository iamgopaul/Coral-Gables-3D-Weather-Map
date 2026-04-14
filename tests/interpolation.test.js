import { describe, it, expect } from 'vitest';
import {
    interpolate,
    interpolateMultiple,
    interpolateGrid,
    calculateTemperatureGradient,
    detectHeatIslands,
    detectColdZones
} from '../js/utils/interpolation.js';

describe('interpolate (IDW)', () => {
    it('returns null when no valid sampling points', () => {
        expect(interpolate(25.7, -80.27, [], 'temperature')).toBeNull();
        expect(
            interpolate(
                25.7,
                -80.27,
                [{ latitude: 25.7, longitude: -80.27, weatherData: { error: true } }],
                'temperature'
            )
        ).toBeNull();
    });

    it('returns station value when target coincides with a point', () => {
        const pts = [
            {
                latitude: 25.72,
                longitude: -80.27,
                weatherData: { temperature: 77, error: false }
            }
        ];
        expect(interpolate(25.72, -80.27, pts, 'temperature')).toBe(77);
    });

    it('ignores sampling points with NaN / non-finite values for that field', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: NaN, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.26,
                weatherData: { temperature: 72, error: false }
            }
        ];
        expect(interpolate(25.7, -80.27, pts, 'temperature', 2)).toBe(72);
    });

    it('interpolates between two stations (midpoint roughly average for symmetric layout)', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: 70, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.26,
                weatherData: { temperature: 80, error: false }
            }
        ];
        const mid = interpolate(25.7, -80.27, pts, 'temperature', 2);
        expect(mid).not.toBeNull();
        expect(mid).toBeGreaterThan(70);
        expect(mid).toBeLessThan(80);
    });

    it('rejects Infinity so it does not poison the weighted sum', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: Infinity, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.26,
                weatherData: { temperature: 71, error: false }
            }
        ];
        expect(interpolate(25.7, -80.27, pts, 'temperature')).toBe(71);
    });

    it('accepts numeric strings for that field (coerced in IDW; coincident snap returns raw)', () => {
        const pts = [
            {
                latitude: 25.72,
                longitude: -80.27,
                weatherData: { temperature: '74.5', error: false }
            }
        ];
        expect(interpolate(25.72, -80.27, pts, 'temperature')).toBe('74.5');
    });

    it('higher power weights nearer stations more (midpoint closer to nearer station)', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: 60, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.2,
                weatherData: { temperature: 80, error: false }
            }
        ];
        const targetLat = 25.7;
        const targetLon = -80.27;
        const lowP = interpolate(targetLat, targetLon, pts, 'temperature', 1);
        const highP = interpolate(targetLat, targetLon, pts, 'temperature', 4);
        expect(lowP).not.toBeNull();
        expect(highP).not.toBeNull();
        const distWest = Math.abs(-80.27 - -80.28);
        const distEast = Math.abs(-80.2 - -80.27);
        expect(distWest).toBeLessThan(distEast);
        // Larger IDW power weights the nearer (west) station more → closer to 60°F.
        expect(highP).toBeLessThan(lowP);
    });
});

describe('interpolateMultiple', () => {
    it('returns per-key null when no station has data for that key', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.27,
                weatherData: { temperature: 70, error: false }
            }
        ];
        const m = interpolateMultiple(25.7, -80.27, pts, ['temperature', 'pressure'], 2);
        expect(m.temperature).toBe(70);
        expect(m.pressure).toBeNull();
    });

    it('interpolates several keys independently', () => {
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: 70, humidity: 40, pressure: 1010, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.26,
                weatherData: { temperature: 80, humidity: 60, pressure: 1020, error: false }
            }
        ];
        const m = interpolateMultiple(25.7, -80.27, pts, ['temperature', 'humidity', 'pressure'], 2);
        expect(m.temperature).toBeGreaterThan(70);
        expect(m.temperature).toBeLessThan(80);
        expect(m.humidity).toBeGreaterThan(40);
        expect(m.humidity).toBeLessThan(60);
        expect(m.pressure).toBeGreaterThan(1010);
        expect(m.pressure).toBeLessThan(1020);
    });
});

describe('interpolateGrid', () => {
    it('maps each cell center through interpolateMultiple', () => {
        const cells = [
            { id: 'a', centerLat: 25.7, centerLon: -80.27 },
            { id: 'b', centerLat: 25.71, centerLon: -80.27 }
        ];
        const pts = [
            {
                latitude: 25.7,
                longitude: -80.28,
                weatherData: { temperature: 70, error: false }
            },
            {
                latitude: 25.7,
                longitude: -80.26,
                weatherData: { temperature: 80, error: false }
            }
        ];
        const out = interpolateGrid(cells, pts, ['temperature'], 2);
        expect(out).toHaveLength(2);
        expect(out[0].interpolatedData.temperature).not.toBeNull();
        expect(out[1].interpolatedData.temperature).not.toBeNull();
    });
});

describe('calculateTemperatureGradient', () => {
    it('returns max minus min across cells with temperatures', () => {
        const grid = [
            { interpolatedData: { temperature: 70 } },
            { interpolatedData: { temperature: 80 } },
            { interpolatedData: { temperature: null } }
        ];
        expect(calculateTemperatureGradient(grid)).toBe(10);
    });
});

describe('detectHeatIslands / detectColdZones', () => {
    const grid = [
        { interpolatedData: { temperature: 0 } },
        { interpolatedData: { temperature: 50 } },
        { interpolatedData: { temperature: 50 } }
    ];

    it('treats 0°F as a valid temperature (not falsy)', () => {
        const hot = detectHeatIslands(grid, 20);
        expect(hot.some((c) => c.interpolatedData.temperature === 0)).toBe(false);
        const cold = detectColdZones(grid, 20);
        expect(cold.some((c) => c.interpolatedData.temperature === 0)).toBe(true);
    });
});
