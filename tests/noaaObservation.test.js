import { describe, it, expect } from 'vitest';
import { parseNOAAObservation } from '../js/api/noaa.js';

/** Minimal api.weather.gov observation `properties` for tests */
function minimalProps(overrides = {}) {
    return {
        timestamp: '2024-06-01T18:00:00+00:00',
        textDescription: 'Clear',
        temperature: { value: 26.7, unitCode: 'wmoUnit:degC' },
        relativeHumidity: { value: 65 },
        barometricPressure: { value: 101325 },
        windDirection: { value: 70, unitCode: 'wmoUnit:degree_(angle)' },
        windSpeed: {
            value: 25.92,
            unitCode: 'wmoUnit:km_h-1'
        },
        windGust: {
            value: 44.64,
            unitCode: 'wmoUnit:km_h-1'
        },
        visibility: { value: 16090, unitCode: 'wmoUnit:m' },
        cloudLayers: [],
        ...overrides
    };
}

describe('parseNOAAObservation wind units', () => {
    it('converts NWS km/h wind speed and gust to mph', () => {
        const obs = parseNOAAObservation({ properties: minimalProps() });
        // 25.92 km/h -> mph
        expect(obs.windSpeed).toBeCloseTo(25.92 / 1.609344, 4);
        // 44.64 km/h -> mph
        expect(obs.windGust).toBeCloseTo(44.64 / 1.609344, 4);
    });

    it('converts m/s when unitCode indicates m/s', () => {
        const props = minimalProps({
            windSpeed: { value: 10, unitCode: 'wmoUnit:m_s-1' },
            windGust: { value: 15, unitCode: 'wmoUnit:m_s-1' }
        });
        const obs = parseNOAAObservation({ properties: props });
        expect(obs.windSpeed).toBeCloseTo(10 * 2.2369362920544, 4);
        expect(obs.windGust).toBeCloseTo(15 * 2.2369362920544, 4);
    });
});
