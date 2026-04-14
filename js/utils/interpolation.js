import { calculateDistance } from '../samplingPoints.js';

/**
 * Inverse Distance Weighting (IDW) Interpolation
 * Estimates values at unknown points based on known sample points
 */

/**
 * Interpolate a value at a target point using IDW
 * @param {number} targetLat - Target latitude
 * @param {number} targetLon - Target longitude
 * @param {Array} samplingPoints - Array of sampling points with data
 * @param {string} valueKey - The key of the value to interpolate (e.g., 'temperature')
 * @param {number} power - IDW power parameter (default: 2)
 * @returns {number} Interpolated value
 */
export function interpolate(targetLat, targetLon, samplingPoints, valueKey, power = 2) {
    // Filter out points without valid numeric data (NaN must not participate in IDW).
    const validPoints = samplingPoints.filter((point) => {
        if (!point.weatherData || point.weatherData.error) {
            return false;
        }
        const v = point.weatherData[valueKey];
        return v !== null && v !== undefined && Number.isFinite(Number(v));
    });

    if (validPoints.length === 0) {
        return null;
    }

    // Calculate distances and weights
    let weightedSum = 0;
    let totalWeight = 0;

    for (const point of validPoints) {
        const distance = calculateDistance(targetLat, targetLon, point.latitude, point.longitude);

        // If target coincides with sampling point, return its value
        if (distance < 0.001) {
            return point.weatherData[valueKey];
        }

        // Calculate weight: w = 1 / d^p
        const weight = 1 / Math.pow(distance, power);
        const value = point.weatherData[valueKey];

        weightedSum += weight * value;
        totalWeight += weight;
    }

    if (totalWeight === 0) {
        return null;
    }

    return weightedSum / totalWeight;
}

/**
 * Interpolate multiple values at once
 * @returns {Object} Object with interpolated values for each key
 */
export function interpolateMultiple(targetLat, targetLon, samplingPoints, valueKeys, power = 2) {
    const result = {};

    for (const key of valueKeys) {
        result[key] = interpolate(targetLat, targetLon, samplingPoints, key, power);
    }

    return result;
}

/**
 * Interpolate values for an entire grid
 * @param {Array} gridCells - Array of grid cell objects with lat/lon
 * @param {Array} samplingPoints - Array of sampling points with weather data
 * @param {Array} valueKeys - Array of value keys to interpolate
 * @returns {Array} Grid cells with interpolated values
 */
export function interpolateGrid(gridCells, samplingPoints, valueKeys, power = 2) {
    return gridCells.map((cell) => ({
        ...cell,
        interpolatedData: interpolateMultiple(
            cell.centerLat,
            cell.centerLon,
            samplingPoints,
            valueKeys,
            power
        )
    }));
}

/**
 * Calculate temperature gradient across the grid
 * Returns max temperature difference
 */
export function calculateTemperatureGradient(gridCells) {
    const temperatures = gridCells
        .map((cell) => cell.interpolatedData?.temperature)
        .filter((temp) => temp !== null && temp !== undefined);

    if (temperatures.length === 0) {
        return 0;
    }

    const min = Math.min(...temperatures);
    const max = Math.max(...temperatures);

    return max - min;
}

/**
 * Detect heat islands (areas significantly warmer than average)
 */
export function detectHeatIslands(gridCells, threshold) {
    const temperatures = gridCells
        .map((cell) => cell.interpolatedData?.temperature)
        .filter((temp) => temp !== null && temp !== undefined);

    if (temperatures.length === 0) {
        return [];
    }

    const avgTemp = temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length;

    return gridCells.filter((cell) => {
        const temp = cell.interpolatedData?.temperature;
        return temp != null && Number.isFinite(temp) && temp - avgTemp > threshold;
    });
}

/**
 * Detect cold zones (areas significantly cooler than average)
 */
export function detectColdZones(gridCells, threshold) {
    const temperatures = gridCells
        .map((cell) => cell.interpolatedData?.temperature)
        .filter((temp) => temp !== null && temp !== undefined);

    if (temperatures.length === 0) {
        return [];
    }

    const avgTemp = temperatures.reduce((sum, temp) => sum + temp, 0) / temperatures.length;

    return gridCells.filter((cell) => {
        const temp = cell.interpolatedData?.temperature;
        return temp != null && Number.isFinite(temp) && avgTemp - temp > threshold;
    });
}
