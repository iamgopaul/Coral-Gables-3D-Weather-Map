import { CONFIG } from '../config.js';
import { temperatureToColor } from './tempColors.js';

/**
 * Generate 3D grid cells for mesh visualization
 */

/**
 * Generate grid cells covering the Coral Gables extent
 */
export function generateGridCells() {
    const { north, south, east, west } = CONFIG.GRID_EXTENT;
    const { GRID_ROWS, GRID_COLS } = CONFIG;

    const cells = [];
    const latStep = (north - south) / GRID_ROWS;
    const lonStep = (east - west) / GRID_COLS;

    for (let row = 0; row < GRID_ROWS; row++) {
        for (let col = 0; col < GRID_COLS; col++) {
            const cellSouth = south + row * latStep;
            const cellNorth = cellSouth + latStep;
            const cellWest = west + col * lonStep;
            const cellEast = cellWest + lonStep;

            const centerLat = (cellNorth + cellSouth) / 2;
            const centerLon = (cellEast + cellWest) / 2;

            cells.push({
                id: `cell_${row}_${col}`,
                row,
                col,
                bounds: {
                    north: cellNorth,
                    south: cellSouth,
                    east: cellEast,
                    west: cellWest
                },
                centerLat,
                centerLon,
                vertices: [
                    { lat: cellSouth, lon: cellWest }, // SW
                    { lat: cellSouth, lon: cellEast }, // SE
                    { lat: cellNorth, lon: cellEast }, // NE
                    { lat: cellNorth, lon: cellWest } // NW
                ]
            });
        }
    }

    return cells;
}

/**
 * Generate vertices for 3D mesh
 * Each cell has 4 vertices (corners)
 */
export function generateMeshVertices(gridCells, elevationData) {
    const vertices = [];
    const vertexMap = new Map();

    gridCells.forEach((cell) => {
        cell.vertices.forEach((vertex) => {
            const key = `${vertex.lat.toFixed(6)},${vertex.lon.toFixed(6)}`;

            if (!vertexMap.has(key)) {
                const elevation = calculateVertexElevation(vertex.lat, vertex.lon, elevationData);

                vertices.push({
                    lat: vertex.lat,
                    lon: vertex.lon,
                    elevation: elevation,
                    index: vertices.length
                });

                vertexMap.set(key, vertices.length - 1);
            }
        });
    });

    return { vertices, vertexMap };
}

/**
 * Calculate elevation for a vertex based on temperature
 */
function calculateVertexElevation(lat, lon, elevationData) {
    if (!elevationData || elevationData.length === 0) {
        return 0;
    }

    // Find nearest cell for this vertex
    let nearestCell = elevationData[0];
    let minDistance = calculateDistance2D(lat, lon, nearestCell.centerLat, nearestCell.centerLon);

    for (const cell of elevationData) {
        const distance = calculateDistance2D(lat, lon, cell.centerLat, cell.centerLon);
        if (distance < minDistance) {
            minDistance = distance;
            nearestCell = cell;
        }
    }

    return nearestCell.elevation || 0;
}

/**
 * Simple 2D distance calculation
 */
function calculateDistance2D(lat1, lon1, lat2, lon2) {
    const dLat = lat2 - lat1;
    const dLon = lon2 - lon1;
    return Math.sqrt(dLat * dLat + dLon * dLon);
}

/**
 * Generate faces (triangles) for the mesh
 * Each grid cell becomes 2 triangles
 */
export function generateMeshFaces(gridCells, vertexMap) {
    const faces = [];

    gridCells.forEach((cell) => {
        const indices = cell.vertices.map((vertex) => {
            const key = `${vertex.lat.toFixed(6)},${vertex.lon.toFixed(6)}`;
            return vertexMap.get(key);
        });

        // Create two triangles for the quad
        // Triangle 1: SW, SE, NE
        faces.push([indices[0], indices[1], indices[2]]);

        // Triangle 2: SW, NE, NW
        faces.push([indices[0], indices[2], indices[3]]);
    });

    return faces;
}

/**
 * Calculate elevation for each cell based on temperature
 */
export function calculateCellElevations(gridCells) {
    const temperatures = gridCells
        .filter((cell) => cell.interpolatedData?.temperature !== null)
        .map((cell) => cell.interpolatedData.temperature);

    if (temperatures.length === 0) {
        return gridCells.map((cell) => ({ ...cell, elevation: 0 }));
    }

    const minTemp = Math.min(...temperatures);
    const maxTemp = Math.max(...temperatures);
    const tempRange = maxTemp - minTemp;

    return gridCells.map((cell) => {
        const temp = cell.interpolatedData?.temperature;

        if (temp === null || temp === undefined) {
            return { ...cell, elevation: CONFIG.ELEVATION_OFFSET_BASE };
        }

        // Normalize temperature to 0-1 range
        const normalizedTemp = tempRange > 0 ? (temp - minTemp) / tempRange : 0.5;

        // Map to elevation (warmer = higher)
        const elevation = CONFIG.ELEVATION_OFFSET_BASE + normalizedTemp * CONFIG.MAX_ELEVATION;

        return {
            ...cell,
            elevation,
            temperature: temp
        };
    });
}

/**
 * Calculate color for each cell based on temperature
 */
export function calculateCellColors(gridCells) {
    return gridCells.map((cell) => {
        const temp = cell.interpolatedData?.temperature;

        if (temp === null || temp === undefined) {
            return { ...cell, color: [52, 72, 60] };
        }

        return {
            ...cell,
            color: temperatureToColor(temp)
        };
    });
}
