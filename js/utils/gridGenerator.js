import { CONFIG } from '../config.js';

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
            const cellSouth = south + (row * latStep);
            const cellNorth = cellSouth + latStep;
            const cellWest = west + (col * lonStep);
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
                    { lat: cellSouth, lon: cellEast },  // SE
                    { lat: cellNorth, lon: cellEast },  // NE
                    { lat: cellNorth, lon: cellWest }   // NW
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
    
    gridCells.forEach(cell => {
        cell.vertices.forEach(vertex => {
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
    
    gridCells.forEach(cell => {
        const indices = cell.vertices.map(vertex => {
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
        .filter(cell => cell.interpolatedData?.temperature !== null)
        .map(cell => cell.interpolatedData.temperature);
    
    if (temperatures.length === 0) {
        return gridCells.map(cell => ({ ...cell, elevation: 0 }));
    }
    
    const minTemp = Math.min(...temperatures);
    const maxTemp = Math.max(...temperatures);
    const tempRange = maxTemp - minTemp;
    
    return gridCells.map(cell => {
        const temp = cell.interpolatedData?.temperature;
        
        if (temp === null || temp === undefined) {
            return { ...cell, elevation: CONFIG.ELEVATION_OFFSET_BASE };
        }
        
        // Normalize temperature to 0-1 range
        const normalizedTemp = tempRange > 0 ? (temp - minTemp) / tempRange : 0.5;
        
        // Map to elevation (warmer = higher)
        const elevation = CONFIG.ELEVATION_OFFSET_BASE + 
            (normalizedTemp * CONFIG.MAX_ELEVATION);
        
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
    return gridCells.map(cell => {
        const temp = cell.interpolatedData?.temperature;
        
        if (temp === null || temp === undefined) {
            return { ...cell, color: [128, 128, 128] }; // Gray for no data
        }
        
        return {
            ...cell,
            color: temperatureToColor(temp)
        };
    });
}

/**
 * Convert temperature to RGB color
 */
function temperatureToColor(temperature) {
    // Color gradient: Blue (cold) -> Cyan -> Green -> Yellow -> Orange -> Red (hot)
    const gradient = CONFIG.TEMP_COLOR_GRADIENT || [
        { temp: -10, color: [0, 0, 255] },
        { temp: 32, color: [0, 255, 255] },
        { temp: 60, color: [0, 255, 0] },
        { temp: 80, color: [255, 255, 0] },
        { temp: 100, color: [255, 165, 0] },
        { temp: 120, color: [255, 0, 0] }
    ];
    
    // Find the two gradient points to interpolate between
    let lowerPoint = gradient[0];
    let upperPoint = gradient[gradient.length - 1];
    
    for (let i = 0; i < gradient.length - 1; i++) {
        if (temperature >= gradient[i].temp && temperature <= gradient[i + 1].temp) {
            lowerPoint = gradient[i];
            upperPoint = gradient[i + 1];
            break;
        }
    }
    
    // If outside range, clamp to endpoints
    if (temperature < gradient[0].temp) {
        return gradient[0].color;
    }
    if (temperature > gradient[gradient.length - 1].temp) {
        return gradient[gradient.length - 1].color;
    }
    
    // Linear interpolation between colors
    const tempRange = upperPoint.temp - lowerPoint.temp;
    const t = (temperature - lowerPoint.temp) / tempRange;
    
    return [
        Math.round(lowerPoint.color[0] + t * (upperPoint.color[0] - lowerPoint.color[0])),
        Math.round(lowerPoint.color[1] + t * (upperPoint.color[1] - lowerPoint.color[1])),
        Math.round(lowerPoint.color[2] + t * (upperPoint.color[2] - lowerPoint.color[2]))
    ];
}
