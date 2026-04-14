import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    getSnapshotAtTime,
    getForecastData,
    formatTimestamp,
    interpolateSnapshots
} from '../js/features/timeFeatures.js';

describe('getSnapshotAtTime', () => {
    it('returns null for empty or invalid target', () => {
        expect(getSnapshotAtTime([], 1000)).toBeNull();
        expect(getSnapshotAtTime([{ timestamp: 100 }], NaN)).toBeNull();
    });

    it('picks closest valid snapshot by timestamp', () => {
        const a = { timestamp: 1000, data: [] };
        const b = { timestamp: 2000, data: [] };
        expect(getSnapshotAtTime([a, b], 1600)).toBe(b);
        expect(getSnapshotAtTime([a, b], 1100)).toBe(a);
    });

    it('skips snapshots with invalid timestamps', () => {
        const bad = { timestamp: 'x' };
        const good = { timestamp: 5000 };
        expect(getSnapshotAtTime([bad, good], 5000)).toBe(good);
    });
});

describe('getForecastData', () => {
    const base = 1_704_000_000_000;

    beforeEach(() => {
        vi.spyOn(Date, 'now').mockReturnValue(base);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null when no results', () => {
        expect(getForecastData(null, 3)).toBeNull();
        expect(getForecastData([], 3)).toBeNull();
    });

    it('selects forecast period closest to target time', () => {
        const threeHoursMs = 3 * 60 * 60 * 1000;
        const p1 = { timestamp: base + 1 * 3600 * 1000, temperature: 70 };
        const p2 = { timestamp: base + threeHoursMs, temperature: 72 };
        const out = getForecastData(
            [
                {
                    pointId: 'center',
                    forecasts: [p1, p2],
                    source: 'Test'
                }
            ],
            3
        );
        expect(out).toHaveLength(1);
        expect(out[0].temperature).toBe(72);
        expect(out[0].pointId).toBe('center');
    });

    it('returns error object when forecasts array is empty', () => {
        const out = getForecastData([{ pointId: 'a', forecasts: [], source: 'X' }], 1);
        expect(out[0].success).toBe(false);
        expect(out[0].error).toBe('no_forecast_periods');
    });
});

describe('formatTimestamp', () => {
    it('returns em dash for invalid input', () => {
        expect(formatTimestamp('bad')).toBe('—');
        expect(formatTimestamp(NaN)).toBe('—');
    });

    it('formats a known instant', () => {
        const s = formatTimestamp(Date.UTC(2024, 0, 15, 14, 30, 0));
        expect(s).toMatch(/Jan/);
        expect(s).toMatch(/15/);
    });
});

describe('interpolateSnapshots', () => {
    it('returns single snapshot when other is missing', () => {
        const a = { timestamp: 0, data: [{ x: 1 }] };
        expect(interpolateSnapshots(a, null)).toBe(a);
        expect(interpolateSnapshots(null, a)).toBe(a);
    });

    it('interpolates numeric fields at t=0.5', () => {
        const s1 = {
            timestamp: 0,
            data: [
                {
                    temperature: 60,
                    humidity: 40,
                    windSpeed: 10,
                    pressure: 1000,
                    error: false
                }
            ]
        };
        const s2 = {
            timestamp: 1000,
            data: [
                {
                    temperature: 80,
                    humidity: 60,
                    windSpeed: 20,
                    pressure: 1010,
                    error: false
                }
            ]
        };
        const mid = interpolateSnapshots(s1, s2, 0.5);
        expect(mid.data[0].temperature).toBe(70);
        expect(mid.data[0].humidity).toBe(50);
    });
});
