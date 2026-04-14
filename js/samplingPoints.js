import { CONFIG } from './config.js';

/**
 * Calculate the 17 sampling points over Coral Gables
 * Pattern: 5 north, 5 middle (including center), 5 south, 2 mid-layer
 */
export function generateSamplingPoints() {
    const points = [];
    const { north, south, east, west } = CONFIG.GRID_EXTENT;

    // Calculate spacing
    const latSpan = north - south;
    const lonSpan = east - west;

    // North row (5 points)
    const northLat = north - latSpan * 0.1;
    for (let i = 0; i < 5; i++) {
        const lon = west + lonSpan * (i / 4);
        points.push({
            id: `north_${i}`,
            latitude: northLat,
            longitude: lon,
            row: 'north',
            index: i
        });
    }

    // Middle row (5 points including center)
    const middleLat = south + latSpan * 0.5;
    for (let i = 0; i < 5; i++) {
        const lon = west + lonSpan * (i / 4);
        const isCenter = i === 2;
        points.push({
            id: isCenter ? 'center' : `middle_${i}`,
            latitude: middleLat,
            longitude: lon,
            row: 'middle',
            index: i,
            isCenter
        });
    }

    // South row (5 points)
    const southLat = south + latSpan * 0.1;
    for (let i = 0; i < 5; i++) {
        const lon = west + lonSpan * (i / 4);
        points.push({
            id: `south_${i}`,
            latitude: southLat,
            longitude: lon,
            row: 'south',
            index: i
        });
    }

    // Mid-layer points (2 additional points)
    // Position between north-center and center-south
    const midNorthLat = south + latSpan * 0.7;
    const midSouthLat = south + latSpan * 0.3;
    const midLon = west + lonSpan * 0.5; // Center longitude

    points.push({
        id: 'mid_layer_north',
        latitude: midNorthLat,
        longitude: midLon,
        row: 'mid-layer',
        index: 0
    });

    points.push({
        id: 'mid_layer_south',
        latitude: midSouthLat,
        longitude: midLon,
        row: 'mid-layer',
        index: 1
    });

    return points;
}

/**
 * Get sampling point by ID
 */
export function getSamplingPoint(points, id) {
    return points.find((point) => point.id === id);
}

/**
 * Get all sampling points in a specific row
 */
export function getPointsByRow(points, row) {
    return points.filter((point) => point.row === row);
}

/**
 * Calculate distance between two points (in kilometers)
 * Using Haversine formula
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = toRadians(lat2 - lat1);
    const dLon = toRadians(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function toRadians(degrees) {
    return degrees * (Math.PI / 180);
}
