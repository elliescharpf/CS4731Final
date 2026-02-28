"use strict";

let gl;
let program;
let skyboxProgram;
let shadowProgram;
let envProgram;
let fireProgram;
let skyboxVBO, skyboxIBO, skyboxTexture;

let vPosition, vNormal;
let modelMatrixLoc, viewMatrixLoc, projMatrixLoc;
let lightPosLoc, cameraPosLoc;

//Render vars
let time = 0;
let lastTime = null;

//Toggle states
let autoRotate = false; // C key toggles camera auto-rotation
let showShadows = true; // S key toggles shadows
let lightOn = true; // D toggles shadows

//Auto-rotation accumulator
let autoTheta = 0;

// Manual camera rotation
let theta = 0;

//OBJ meshes loaded async
let tentOBJ = null;
let campfireOBJ = null;
let flashlightOBJ = null;

// procedural mesh storage
let meshes = {};

//textures
let groundTex, tentTex, campfireTex;

/*let groundVBuffer, groundNBuffer;
let cubeVBuffer, cubeNBuffer, cubeIBO;
*/

//shadow / env-map uniform location caches
let sloc = {}; //shadow program locations
let eloc = {}; //env-map program locations
let mloc = {}; //locations added to main program


//Keyboard handler -- added new keys for toggle states
window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") theta -= 2;
    if (e.key === "ArrowRight") theta += 2;
    if (e.key === "c" || e.key === "C") autoRotate = !autoRotate;
    if (e.key === "s" || e.key === "S") showShadows = !showShadows;
    if (e.key === "d" || e.key === "D") lightOn = !lightOn;
    updateStatus();
});

//Status display 
function updateStatus() {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent =
        `[C] Cam:${autoRotate ? "AUTO" : "MANUAL"}  ` +
        `[S] Shadows:${showShadows ? "ON" : "OFF"}  ` +
        `[D] Fire:${lightOn ? "ON" : "OFF"}`;
}

//Shadow matrix ──────────────
function makeShadowMat(lp, groundY) {
    let A=0, B=1, C=0, D=-groundY;
    let lx=lp[0], ly=lp[1], lz=lp[2], lw=1;
    let dot = B*ly + D*lw;
    return mat4(
        dot-lx*A,  -ly*A,    -lz*A,    -lw*A,
        -lx*B,    dot-ly*B, -lz*B,    -lw*B,
        -lx*C,    -ly*C,   dot-lz*C,  -lw*C,
        -lx*D,    -ly*D,   -lz*D,    dot-lw*D
    );
}

//small vec3 helpers 
function normalize3(v) {
    let l = Math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) || 1;
    return [v[0]/l, v[1]/l, v[2]/l];
}

//procedural geometry helpers 

function makeDisk(cx, yVal, cz, r, segs, nx, ny, nz) {
    let verts=[], norms=[], texs=[], idx=[];
    verts.push(cx,yVal,cz,1); norms.push(nx,ny,nz); texs.push(0.5,0.5);
    for (let i=0; i<=segs; i++) {
        let a = (i/segs)*2*Math.PI;
        verts.push(cx+r*Math.cos(a), yVal, cz+r*Math.sin(a), 1);
        norms.push(nx,ny,nz);
        texs.push(0.5+0.5*Math.cos(a), 0.5+0.5*Math.sin(a));
    }
    for (let i=1; i<=segs; i++) idx.push(0, i, i+1);
    return {verts, norms, texs, idx};
}

function makeCylinder(cx, y0, cz, r, h, segs) {
    let verts=[], norms=[], texs=[], idx=[];
    for (let i=0; i<=segs; i++) {
        let a=(i/segs)*2*Math.PI, nx=Math.cos(a), nz=Math.sin(a);
        verts.push(cx+r*nx, y0,   cz+r*nz, 1); norms.push(nx,0,nz); texs.push(i/segs, 0);
        verts.push(cx+r*nx, y0+h, cz+r*nz, 1); norms.push(nx,0,nz); texs.push(i/segs, 1);
    }
    for (let i=0; i<segs; i++) {
        let b=i*2;
        idx.push(b, b+1, b+3, b, b+3, b+2);
    }
    return {verts, norms, texs, idx};
}

function makeCone(cx, y0, cz, r, h, segs) {
    let verts=[], norms=[], texs=[], idx=[];
    let tipY=y0+h, slope=r/h;
    for (let i=0; i<=segs; i++) {
        let a=(i/segs)*2*Math.PI, ca=Math.cos(a), sa=Math.sin(a);
        let d = Math.sqrt(1+slope*slope);
        verts.push(cx+r*ca, y0,   cz+r*sa, 1); norms.push(ca/d, slope/d, sa/d); texs.push(i/segs, 0);
        verts.push(cx,      tipY, cz,       1); norms.push(ca/d, slope/d, sa/d); texs.push(i/segs, 1);
    }
    for (let i=0; i<segs; i++) idx.push(i*2, i*2+2, i*2+1);
    return {verts, norms, texs, idx};
}

function makeSphere(cx, cy, cz, r, stacks, slices) {
    let verts=[], norms=[], texs=[], idx=[];
    for (let i=0; i<=stacks; i++) {
        let phi = Math.PI*i/stacks;
        for (let j=0; j<=slices; j++) {
            let the = 2*Math.PI*j/slices;
            let nx=Math.sin(phi)*Math.cos(the), ny=Math.cos(phi), nz=Math.sin(phi)*Math.sin(the);
            verts.push(cx+r*nx, cy+r*ny, cz+r*nz, 1);
            norms.push(nx, ny, nz);
            texs.push(j/slices, i/stacks);
        }
    }
    for (let i=0; i<stacks; i++)
        for (let j=0; j<slices; j++) {
            let a = (slices+1)*i+j;
            idx.push(a, a+slices+1, a+1, a+1, a+slices+1, a+slices+2);
        }
    return {verts, norms, texs, idx};
}

function buildFireGeo() {
    let verts=[], norms=[], texs=[], idx=[];
    for (let i=0; i<8; i++) {
        let a=(i/8)*2*Math.PI, r=0.15;
        let bx=r*Math.cos(a), bz=r*Math.sin(a), b=verts.length/4;
        verts.push(bx-0.15, 0,   bz, 1); norms.push(0,0,1); texs.push(0,0);
        verts.push(bx+0.15, 0,   bz, 1); norms.push(0,0,1); texs.push(1,0);
        verts.push(bx,      1.0, bz, 1); norms.push(0,0,1); texs.push(0.5,1);
        idx.push(b, b+1, b+2);
    }
    return {verts, norms, texs, idx};
}

//Upload helpers 

//Upload an indexed procedural mesh
function uploadMesh(geo) {
    function vbuf(data) {
        let b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
        return b;
    }
    let ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(geo.idx), gl.STATIC_DRAW);
    return {
        vbo: vbuf(geo.verts), nbo: vbuf(geo.norms), tbo: vbuf(geo.texs),
        ibo: ib, count: geo.idx.length, isIndexed: true
    };
}

//Upload a parsed OBJ mesh (flat triangles, drawArrays)
function uploadOBJMesh(parsed) {
    function vbuf(data) {
        let b = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        return b;
    }
    return {
        vbo: vbuf(parsed.vertices), nbo: vbuf(parsed.normals),
        tbo: vbuf(parsed.texcoords), count: parsed.count, isIndexed: false
    };
}

//texture helpers 

function createSolidTex(r, g, b, a) {
    let t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r,g,b,a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
}

function loadTexture(url, fallback) {
    let t = createSolidTex(...fallback);
    let img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    };
    img.src = url;
    return t;
}

//draw helpers

function setMainUniforms(modelM, useTex, tex, amb, diff, spec, shin) {
    gl.useProgram(program);
    gl.uniformMatrix4fv(modelMatrixLoc,       false, flatten(modelM));
    gl.uniformMatrix4fv(mloc.normalMat,       false, flatten(transpose(inverse(modelM))));
    gl.uniform1f(mloc.useTex,  useTex ? 1 : 0);
    gl.uniform4fv(mloc.ambient,  flatten(amb));
    gl.uniform4fv(mloc.diffuse,  flatten(diff));
    gl.uniform4fv(mloc.specular, flatten(spec));
    gl.uniform1f(mloc.shininess, shin);
    if (useTex && tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(mloc.tex, 0);
    }
}

function drawMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vNormal);

    // tex coords — only bind if the attribute exists
    if (mloc.vTex >= 0 && mesh.tbo) {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.tbo);
        gl.vertexAttribPointer(mloc.vTex, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(mloc.vTex);
    }

    if (mesh.isIndexed) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
}

function drawShadow(mesh, modelM, shadowM) {
    if (!showShadows || !lightOn) return;
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(sloc.shadowMat, false, flatten(mult(shadowM, modelM)));
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(sloc.vPos, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(sloc.vPos);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (mesh.isIndexed) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.disable(gl.BLEND);
}

function drawEnvMesh(mesh, modelM, isRefract, eta) {
    gl.useProgram(envProgram);
    gl.uniformMatrix4fv(eloc.model,     false, flatten(modelM));
    gl.uniformMatrix4fv(eloc.normalMat, false, flatten(transpose(inverse(modelM))));
    gl.uniform1f(eloc.isRefract,    isRefract ? 1 : 0);
    gl.uniform1f(eloc.refractRatio, eta);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(eloc.skybox, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(eloc.vPos, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(eloc.vPos);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
    gl.vertexAttribPointer(eloc.vNorm, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(eloc.vNorm);
    gl.enable(gl.BLEND);
    //added -
    gl.enableVertexAttribArray(eloc.vNorm);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (mesh.isIndexed) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.disable(gl.BLEND);
}

//shadow matrix 
function shiftToGround(parsed) {
    const pos = parsed.vertices;
    let minY = Infinity;
    for (let i=1; i<pos.length; i+=4) if (pos[i] < minY) minY = pos[i];
    for (let i=1; i<pos.length; i+=4) pos[i] -= minY;
}

async function loadAllOBJs() {
    async function load(path, size) {
        try {
            const r = await fetch(path);
            if (!r.ok) throw new Error("HTTP " + r.status);
            const parsed = parseOBJ(await r.text());
            normalizeOBJ(parsed, size);
            shiftToGround(parsed);
            return uploadOBJMesh(parsed);
        } catch(e) {
            console.warn("Could not load " + path + ":", e);
            return null;
        }
    }
    tentOBJ       = await load("models/Tent.obj",             3.0);
    campfireOBJ   = await load("models/PUSHILIN_campfire.obj",1.4);
}

//init - adding new setup
window.onload = async function init() {
    const canvas = document.getElementById("gl-canvas");
    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { alert("WebGL isn't available"); return; }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.enable(gl.DEPTH_TEST);

    // main program
    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    vPosition = gl.getAttribLocation(program, "vPosition");
    vNormal   = gl.getAttribLocation(program, "vNormal");

    modelMatrixLoc = gl.getUniformLocation(program, "uModel");
    viewMatrixLoc  = gl.getUniformLocation(program, "uView");
    projMatrixLoc  = gl.getUniformLocation(program, "uProj");
    lightPosLoc    = gl.getUniformLocation(program, "uLightPos");
    cameraPosLoc   = gl.getUniformLocation(program, "uCameraPos");

    //added - uniform locations on same main program
    mloc.normalMat = gl.getUniformLocation(program, "uNormalMat");
    mloc.useTex    = gl.getUniformLocation(program, "uUseTex");
    mloc.tex       = gl.getUniformLocation(program, "uTex");
    mloc.vTex      = gl.getAttribLocation (program, "vTexCoord");
    mloc.ambient   = gl.getUniformLocation(program, "uAmbient"); 
    mloc.diffuse   = gl.getUniformLocation(program, "uDiffuse");
    mloc.specular  = gl.getUniformLocation(program, "uSpecular");
    mloc.shininess = gl.getUniformLocation(program, "uShininess");
    mloc.lightOn   = gl.getUniformLocation(program, "uLightOn");
    mloc.ambCol    = gl.getUniformLocation(program, "uAmbientColor");
    mloc.lightColor = gl.getUniformLocation(program, "uLightColor");

    //removed original ground plane geometry - now useing a textured ground mesh below so it responds to Phong

    /*gl.uniform4fv(gl.getUniformLocation(program, "ambientProduct"), flatten(vec4(0.2,0.2,0.2,1)));
    gl.uniform4fv(gl.getUniformLocation(program, "diffuseProduct"), flatten(vec4(0.35,0.25,0.15,1)));
    gl.uniform4fv(gl.getUniformLocation(program, "specularProduct"), flatten(vec4(0,0,0,1)));
    gl.uniform1f(gl.getUniformLocation(program, "shininess"), 1);

    // --- Ground plane ---
    const groundVerts = [
        vec4(-10, 0, -10, 1),
        vec4( 10, 0, -10, 1),
        vec4( 10, 0,  10, 1),

        vec4(-10, 0, -10, 1),
        vec4( 10, 0,  10, 1),
        vec4(-10, 0,  10, 1)
    ];

    const groundNorms = [
        vec3(0,1,0), vec3(0,1,0), vec3(0,1,0),
        vec3(0,1,0), vec3(0,1,0), vec3(0,1,0)
    ];

    groundVBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(groundVerts), gl.STATIC_DRAW);

    groundNBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, groundNBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(groundNorms), gl.STATIC_DRAW);

    // --- Cube geometry ---
    const cubeVerts = [
        // front
        vec4(-1,0,-1,1), vec4(1,0,-1,1), vec4(1,2,-1,1), vec4(-1,2,-1,1),
        // back
        vec4(-1,0,1,1), vec4(1,0,1,1), vec4(1,2,1,1), vec4(-1,2,1,1)
    ];

    const cubeNorms = [
        // front normals
        vec3(0,0,-1), vec3(0,0,-1), vec3(0,0,-1), vec3(0,0,-1),
        // back normals
        vec3(0,0,1), vec3(0,0,1), vec3(0,0,1), vec3(0,0,1)
    ];

    const cubeIndices = [
        0,1,2, 0,2,3,   // front
        4,6,5, 4,7,6,   // back
        3,2,6, 3,6,7,   // top
        0,4,5, 0,5,1,   // bottom
        1,5,6, 1,6,2,   // right
        0,3,7, 0,7,4    // left
    ];

    cubeVBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(cubeVerts), gl.STATIC_DRAW);

    cubeNBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeNBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, flatten(cubeNorms), gl.STATIC_DRAW);

    cubeIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(cubeIndices), gl.STATIC_DRAW);
    

    // --- Skybox Geometry ---
    const skyboxVertices = new Float32Array([
        -50,-50,-50,  50,-50,-50, -50, 50,-50,  50, 50,-50,
        -50,-50, 50,  50,-50, 50, -50, 50, 50,  50, 50, 50
    ]);

    const skyboxIndices = new Uint16Array([
        0,1,2, 2,1,3,   // back
        4,6,5, 5,6,7,   // front
        2,3,6, 6,3,7,   // top
        0,4,1, 1,4,5,   // bottom
        1,5,3, 3,5,7,   // right
        0,2,4, 4,2,6    // left
    ]);

    skyboxVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
    gl.bufferData(gl.ARRAY_BUFFER, skyboxVertices, gl.STATIC_DRAW);

    skyboxIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, skyboxIndices, gl.STATIC_DRAW);
    */

    //skybox program
    skyboxProgram = initShaders(gl, "skybox-vertex", "skybox-fragment");

    //added - additional programs
    shadowProgram = initShaders(gl, "shadow-vertex", "shadow-fragment");
    envProgram = initShaders(gl, "envmap-vertex", "reflect-fragment");
    fireProgram = initShaders(gl, "fire-vertex", "fire-fragment");

    gl.useProgram(shadowProgram);
    sloc.vPos = gl.getAttribLocation(shadowProgram, "vPosition");
    sloc.shadowMat = gl.getUniformLocation(shadowProgram, "uShadowMat");
    sloc.view = gl.getUniformLocation(shadowProgram, "uView");
    sloc.proj = gl.getUniformLocation(shadowProgram, "uProj");

    gl.useProgram(envProgram);
    eloc.vPos        = gl.getAttribLocation (envProgram, "vPosition");
    eloc.vNorm       = gl.getAttribLocation (envProgram, "vNormal");
    eloc.model       = gl.getUniformLocation(envProgram, "uModel");
    eloc.view        = gl.getUniformLocation(envProgram, "uView");
    eloc.proj        = gl.getUniformLocation(envProgram, "uProj");
    eloc.normalMat   = gl.getUniformLocation(envProgram, "uNormalMat");
    eloc.camPos      = gl.getUniformLocation(envProgram, "uCameraPos");
    eloc.skybox      = gl.getUniformLocation(envProgram, "uSkybox");
    eloc.isRefract   = gl.getUniformLocation(envProgram, "uIsRefract");
    eloc.refractRatio= gl.getUniformLocation(envProgram, "uRefractRatio");

    //added back original skybox geometry

    // --- Skybox Geometry ---
    const skyboxVertices = new Float32Array([
        -50,-50,-50,  50,-50,-50, -50, 50,-50,  50, 50,-50,
        -50,-50, 50,  50,-50, 50, -50, 50, 50,  50, 50, 50
    ]);

    const skyboxIndices = new Uint16Array([
        0,1,2, 2,1,3,   // back
        4,6,5, 5,6,7,   // front
        2,3,6, 6,3,7,   // top
        0,4,1, 1,4,5,   // bottom
        1,5,3, 3,5,7,   // right
        0,2,4, 4,2,6    // left
    ]);

    skyboxVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
    gl.bufferData(gl.ARRAY_BUFFER, skyboxVertices, gl.STATIC_DRAW);

    skyboxIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, skyboxIndices, gl.STATIC_DRAW);

    //added - procedural meshes
    //Ground (replaces original triangles - now has normals + texcoords)
    {
        const gv = [
            -10,0,-10,1,  10,0,-10,1,  10,0,10,1,
            -10,0,-10,1,  10,0,10,1,  -10,0,10,1
        ];
        const gn = [0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0];
        const gt = [0,0, 1,0, 1,1, 0,0, 1,1, 0,1];
        function vbuf(data, isF32) {
            let b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b;
        }
        meshes.ground = { vbo:vbuf(gv), nbo:vbuf(gn), tbo:vbuf(gt), count:6, isIndexed:false };
    }

    meshes.puddle      = uploadMesh(makeDisk(2.2, 0.005, 1.2,   0.9,  24, 0,1,0));
    meshes.fire        = uploadMesh(buildFireGeo());
    meshes.stick       = uploadMesh(makeCylinder(-0.05,-0.05,-0.05, 0.025, 1.8, 6));
    meshes.marshmallow = uploadMesh(makeSphere(0, 1.7, 0, 0.12, 6, 8));
    //trees
    meshes.trunk1   = uploadMesh(makeCylinder(-7, 0,  3,  0.2,  2.0, 8));
    meshes.leaves1a = uploadMesh(makeCone(-7, 1.5, 3,  1.2, 2.0, 10));
    meshes.leaves1b = uploadMesh(makeCone(-7, 2.5, 3,  0.9, 1.8, 10));
    meshes.leaves1c = uploadMesh(makeCone(-7, 3.3, 3,  0.6, 1.5, 10));
    meshes.trunk2   = uploadMesh(makeCylinder(6,  0, -4,  0.18, 1.8, 8));
    meshes.leaves2a = uploadMesh(makeCone(6, 1.3, -4,  1.0, 1.8, 10));
    meshes.leaves2b = uploadMesh(makeCone(6, 2.1, -4,  0.7, 1.5, 10));

    //added - textures
    groundTex = loadTexture("textures/grass.png", [60,  100, 40,  255]);
    tentTex     = loadTexture("textures/linen.jpg", [200, 160, 110, 255]); //warm tan/beige color for tent as fallback if texture doesnt load
    campfireTex = loadTexture("textures/PUSHILIN_campfire.png",[180, 100, 30,  255]);

    //added - load OBJ models
    await loadAllOBJs();

    // load cubemap from PNGs - skybox texture loader then start render
    loadSkyboxTextures(() => {
        updateStatus();
        requestAnimationFrame(render);
    });
};


function loadSkyboxTextures(onDone) {
    const faces = {
        right:  "right.png",
        left:   "left.png",
        top:    "top.png",
        bottom: "bottom.png",
        front:  "front.png",
        back:   "back.png"
    };

    let images = {};
    let loaded = 0;
    const total = 6;

    for (let key in faces) {
        const img = new Image();
        img.src = faces[key];
        img.onload = function () {
            images[key] = img;
            loaded++;
            if (loaded === total) {
                setupSkyboxCubemap(images);
                onDone();
            }
        };
        //added - fallback so missing images don't block startup
        img.onerror = function() {
            loaded++;
            if(loaded === total){
                setupSkyboxCubemap(images);
                onDone();
            }
        };
    }
}

function setupSkyboxCubemap(images) {
    skyboxTexture = gl.createTexture();
    gl.useProgram(skyboxProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);

    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    /*
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.right);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.left);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.top);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.bottom);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.front);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.back);
    */

    const fallback = new Uint8Array([15, 15, 50, 255]);
    function upload(target, img) {
        if (img) {
            gl.texImage2D(target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        } else {
            gl.texImage2D(target, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallback);
        }
    }
    upload(gl.TEXTURE_CUBE_MAP_POSITIVE_X, images.right);
    upload(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, images.left);
    upload(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, images.top);
    upload(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, images.bottom);
    upload(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, images.front);
    upload(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, images.back);


    const loc = gl.getUniformLocation(skyboxProgram, "uSkybox");
    gl.uniform1i(loc, 0);
}

//render - expanded on
function render(timestamp) {
    //added - only enable blending explicitly where needed to keep state clean
    gl.disable(gl.BLEND);

    // added - delta time for smooth animation
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    time += dt;

    // added - auto-rotate accumulates separately from manual theta
    if (autoRotate) autoTheta += dt * 20;
    let camAngle = theta + autoTheta;

    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // eye calculation -- now uses combined angle
    let eye = vec3(14*Math.sin(radians(camAngle)), 6, 14*Math.cos(radians(camAngle)));
    let at  = vec3(0, 1, 0);
    let up  = vec3(0, 1, 0);

    let viewMatrix = lookAt(eye, at, up);
    let projMatrix = perspective(45, 1, 0.1, 100);

    // added - campfire light flicker ───────────────────────────────────────────
    let flicker   = 0.85 + 0.1*Math.sin(time*7.3) + 0.05*Math.cos(time*11.7);
    let lightPos  = vec3(0, 1.3 + 0.08*Math.sin(time*9), 0);
    let lightColor= new Float32Array([1.0*flicker, 0.55*flicker, 0.08*flicker]);

    // added - shadow matrix ────────────────────────────────────────────────────
    let shadowM = makeShadowMat([lightPos[0], lightPos[1], lightPos[2]], 0.002);

    gl.useProgram(skyboxProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "uView"), false, flatten(viewMatrix));
    gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "uProj"), false, flatten(projMatrix));
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
    let aPos = gl.getAttribLocation(skyboxProgram, "aPosition");
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPos);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);
    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    //added - clear skybox
    gl.clear(gl.DEPTH_BUFFER_BIT);


    //switch to main program
    gl.useProgram(program);

    //set lighting uniforms before drawing anything
    gl.uniform1f(mloc.lightOn, lightOn ? 1.0 : 0.0); 

    gl.uniformMatrix4fv(viewMatrixLoc,  false, flatten(viewMatrix));
    gl.uniformMatrix4fv(projMatrixLoc,  false, flatten(projMatrix));
    gl.uniform3fv(cameraPosLoc,         flatten(eye));

    // added - upload dynamic light uniforms 
    gl.uniform3fv(lightPosLoc, flatten(lightPos));
    gl.uniform3fv(mloc.lightColor, lightColor);  // requires uLightColor in shader
    gl.uniform1f(mloc.lightOn,   lightOn ? 1.0 : 0.0);
    gl.uniform3fv(mloc.ambCol,   new Float32Array([0.05, 0.04, 0.1]));
   
    // added - also push view/proj to shadow and env programs
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(sloc.view, false, flatten(viewMatrix));
    gl.uniformMatrix4fv(sloc.proj, false, flatten(projMatrix));

    gl.useProgram(envProgram);
    gl.uniformMatrix4fv(eloc.view,  false, flatten(viewMatrix));
    gl.uniformMatrix4fv(eloc.proj,  false, flatten(projMatrix));
    gl.uniform3fv(eloc.camPos, flatten(eye));

    gl.useProgram(program);
    const noSpec = vec4(0,0,0,1);
    const spec0  = vec4(0.15,0.15,0.15,1);

    // ── Ground (textured, Phong) ───────────────────────────────────────────────
    setMainUniforms(mat4(), true, groundTex,
        vec4(0.3,0.3,0.3,1), vec4(0.5,0.7,0.3,1), noSpec, 1);
    drawMesh(meshes.ground);

    // ── Tent OBJ ──────────────────────────────────────────────────────────────
    if (tentOBJ) {
        let tentM = translate(-3.5, 0, 0.5);
        setMainUniforms(tentM, true, tentTex,
            vec4(0.3,0.3,0.3,1), vec4(0.7,0.55,0.35,1), spec0, 8);
        drawMesh(tentOBJ);
        drawShadow(tentOBJ, tentM, shadowM);
    }

    // ── Campfire OBJ (textured) ────────────────────────────────────────────────
    if (campfireOBJ) {
        setMainUniforms(mat4(), true, campfireTex,
            vec4(0.3,0.2,0.1,1), vec4(0.7,0.45,0.2,1), noSpec, 2);
        drawMesh(campfireOBJ);
    }

    // ── Animated fire (triangle flames on top of campfire OBJ) ────────────────
    if (lightOn) {
        gl.useProgram(fireProgram);
        let fs = 0.6 + 0.15*Math.sin(time*9.1) + 0.1*Math.cos(time*6.7);
        let fireM = mult(translate(0, 0.1, 0),
                    scalem(1+0.08*Math.sin(time*5), fs, 1+0.08*Math.cos(time*4)));
        gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uModel"), false, flatten(fireM));
        gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uView"),  false, flatten(viewMatrix));
        gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uProj"),  false, flatten(projMatrix));
        gl.uniform1f(gl.getUniformLocation(fireProgram, "uTime"),    time);
        gl.uniform1f(gl.getUniformLocation(fireProgram, "uFlicker"), flicker);
        let fAP = gl.getAttribLocation(fireProgram, "vPosition");
        gl.bindBuffer(gl.ARRAY_BUFFER, meshes.fire.vbo);
        gl.vertexAttribPointer(fAP, 4, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(fAP);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.fire.ibo);
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.depthMask(false);
        gl.drawElements(gl.TRIANGLES, meshes.fire.count, gl.UNSIGNED_SHORT, 0);
        gl.depthMask(true); gl.disable(gl.BLEND);
        gl.useProgram(program);
    }

    // ── Puddle reflection ──────────────────────────────────────────────────────
    drawEnvMesh(meshes.puddle, mat4(), false, 1.0);

    // ── Trees ──────────────────────────────────────────────────────────────────
    setMainUniforms(mat4(), false, null,
        vec4(0.2,0.12,0.05,1), vec4(0.35,0.22,0.1,1), noSpec, 1);
    drawMesh(meshes.trunk1);
    setMainUniforms(mat4(), false, null,
        vec4(0.05,0.25,0.05,1), vec4(0.1,0.42,0.1,1), noSpec, 1);
    drawMesh(meshes.leaves1a); drawMesh(meshes.leaves1b); drawMesh(meshes.leaves1c);
    setMainUniforms(mat4(), false, null,
        vec4(0.2,0.12,0.05,1), vec4(0.35,0.22,0.1,1), noSpec, 1);
    drawMesh(meshes.trunk2);
    setMainUniforms(mat4(), false, null,
        vec4(0.05,0.25,0.05,1), vec4(0.12,0.45,0.12,1), noSpec, 1);
    drawMesh(meshes.leaves2a); drawMesh(meshes.leaves2b);

    // ── Marshmallow on stick ───────────────────────────────────────────────────
    let stickRot = 30 * Math.sin(time * 0.4);
    let stickM   = mult(translate(0.5,0,0.3), mult(rotateY(stickRot), rotateZ(-40)));
    setMainUniforms(stickM, false, null,
        vec4(0.25,0.15,0.05,1), vec4(0.45,0.28,0.1,1), noSpec, 1);
    drawMesh(meshes.stick);
    setMainUniforms(stickM, false, null,
        vec4(0.4,0.35,0.3,1),
        lightOn ? vec4(1.0,0.75,0.55,1) : vec4(1.0,0.95,0.9,1),
        vec4(0.3,0.3,0.3,1), 16);
    drawMesh(meshes.marshmallow);

    requestAnimationFrame(render);
}