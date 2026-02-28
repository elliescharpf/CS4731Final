/**
 * objLoader.js
 * Parses a .obj file string into a flat, interleaved mesh ready for WebGL.
 * Supports v, vt, vn, f (triangles and quads). Ignores materials.
 *
 * Usage:
 *   const mesh = parseOBJ(objText);
 *   // mesh.vertices   Float32Array  [x,y,z,1, ...]  (4 floats per vertex)
 *   // mesh.normals    Float32Array  [nx,ny,nz, ...]  (3 floats per vertex)
 *   // mesh.texcoords  Float32Array  [u,v, ...]       (2 floats per vertex)
 *   // mesh.count      Number        total vertex count (already triangulated)
 *
 *   Then upload with gl.drawArrays(gl.TRIANGLES, 0, mesh.count)
 *   — no index buffer needed.
 */
function parseOBJ(text) {
    const positionsRaw  = [];   // vec3
    const normalsRaw    = [];   // vec3
    const texcoordsRaw  = [];   // vec2

    const outPos  = [];
    const outNorm = [];
    const outTex  = [];

    const lines = text.split('\n');

    for (let raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;

        const parts = line.split(/\s+/);
        const type  = parts[0];

        if (type === 'v') {
            positionsRaw.push([
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            ]);
        } else if (type === 'vt') {
            texcoordsRaw.push([
                parseFloat(parts[1]),
                1.0 - parseFloat(parts[2])  // flip V for WebGL
            ]);
        } else if (type === 'vn') {
            normalsRaw.push([
                parseFloat(parts[1]),
                parseFloat(parts[2]),
                parseFloat(parts[3])
            ]);
        } else if (type === 'f') {
            // Collect all verts in this face, then fan-triangulate
            const faceVerts = [];
            for (let i = 1; i < parts.length; i++) {
                faceVerts.push(parseFaceVert(parts[i], positionsRaw, normalsRaw, texcoordsRaw));
            }
            // Fan triangulation: (0,1,2), (0,2,3), (0,3,4), ...
            for (let i = 1; i < faceVerts.length - 1; i++) {
                pushVert(faceVerts[0]);
                pushVert(faceVerts[i]);
                pushVert(faceVerts[i + 1]);
            }
        }
    }

    function parseFaceVert(token, pos, norm, tex) {
        const idx = token.split('/');
        const pi  = parseInt(idx[0]);
        const ti  = idx[1] ? parseInt(idx[1]) : null;
        const ni  = idx[2] ? parseInt(idx[2]) : null;

        const p = pos[(pi > 0 ? pi - 1 : pos.length + pi)];
        const t = (ti != null && tex.length > 0) ? tex[(ti > 0 ? ti - 1 : tex.length + ti)] : [0, 0];
        const n = (ni != null && norm.length > 0) ? norm[(ni > 0 ? ni - 1 : norm.length + ni)] : [0, 1, 0];

        return { p, t, n };
    }

    function pushVert(v) {
        outPos.push(v.p[0], v.p[1], v.p[2], 1.0);
        outNorm.push(v.n[0], v.n[1], v.n[2]);
        outTex.push(v.t[0], v.t[1]);
    }

    // If no normals in file, compute flat normals per triangle
    if (normalsRaw.length === 0) {
        computeFlatNormals(outPos, outNorm);
    }

    return {
        vertices:  new Float32Array(outPos),
        normals:   new Float32Array(outNorm),
        texcoords: new Float32Array(outTex),
        count:     outPos.length / 4
    };
}

function computeFlatNormals(positions, normals) {
    normals.length = 0;
    for (let i = 0; i < positions.length; i += 12) { // 3 verts * 4 floats
        const ax = positions[i],   ay = positions[i+1],  az = positions[i+2];
        const bx = positions[i+4], by = positions[i+5],  bz = positions[i+6];
        const cx = positions[i+8], cy = positions[i+9],  cz = positions[i+10];

        const ux = bx-ax, uy = by-ay, uz = bz-az;
        const vx = cx-ax, vy = cy-ay, vz = cz-az;

        let nx = uy*vz - uz*vy;
        let ny = uz*vx - ux*vz;
        let nz = ux*vy - uy*vx;
        const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
        nx /= len; ny /= len; nz /= len;

        for (let k = 0; k < 3; k++) {
            normals.push(nx, ny, nz);
        }
    }
}

/**
 * Upload a parsed OBJ mesh to WebGL buffers.
 *
 * Returns an object you can pass to drawOBJMesh():
 *   { vbo, nbo, tbo, count }
 */
function uploadOBJ(gl, mesh) {
    function buf(data) {
        const b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
    }
    return {
        vbo:   buf(mesh.vertices),
        nbo:   buf(mesh.normals),
        tbo:   buf(mesh.texcoords),
        count: mesh.count
    };
}

/**
 * Fetch a .obj file and return a parsed + uploaded mesh.
 *
 * Usage (inside an async function or with .then):
 *   const tentMesh = await loadOBJ(gl, 'models/tent.obj');
 */
async function loadOBJ(gl, url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load OBJ: ${url}`);
    const text = await response.text();
    const parsed = parseOBJ(text);
    return uploadOBJ(gl, parsed);
}

/**
 * Center and scale a parsed OBJ mesh so it fits in a unit cube.
 * Call this on the parsed mesh BEFORE calling uploadOBJ.
 *
 * targetSize: the desired max extent (e.g. 2.0 means it fits in a 2-unit cube)
 */
function normalizeOBJ(mesh, targetSize) {
    const pos = mesh.vertices;
    let minX=Infinity, maxX=-Infinity;
    let minY=Infinity, maxY=-Infinity;
    let minZ=Infinity, maxZ=-Infinity;

    for (let i = 0; i < pos.length; i += 4) {
        if (pos[i]   < minX) minX = pos[i];
        if (pos[i]   > maxX) maxX = pos[i];
        if (pos[i+1] < minY) minY = pos[i+1];
        if (pos[i+1] > maxY) maxY = pos[i+1];
        if (pos[i+2] < minZ) minZ = pos[i+2];
        if (pos[i+2] > maxZ) maxZ = pos[i+2];
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const scale = targetSize / Math.max(maxX-minX, maxY-minY, maxZ-minZ);

    for (let i = 0; i < pos.length; i += 4) {
        pos[i]   = (pos[i]   - cx) * scale;
        pos[i+1] = (pos[i+1] - cy) * scale;
        pos[i+2] = (pos[i+2] - cz) * scale;
    }

    return mesh; // modified in place
}