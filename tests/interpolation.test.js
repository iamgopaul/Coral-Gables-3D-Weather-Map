import { describe, it, expect } from 'vitest';
import { interpolate } from '../js/utils/interpolation.js';

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
});
