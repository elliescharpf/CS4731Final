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
let time = 0;
let lastTime = null;
let swayTime = 0;
let autoRotate = false;
let showShadows = true;
let lightOn = true;
let swingLantern = true;
let autoTheta = 0;
let theta = 0;

let tentOBJ      = null;
let campfireOBJ  = null;
let lanternOBJ   = null;

let meshes = {};
let groundTex, tentTex, campfireTex, lanternTex;

// Dictionaries to hold shader locations
let sloc = {}; // Shadow locations
let eloc = {}; // Environment mapping locations
let mloc = {}; // Main shader locations

let reflectionFBO, reflectionTex, reflectionDepth;
let puddleProgram;
let ploc = {};

// Audio
const ambianceAudio = new Audio("audio/ambiance.wav");
ambianceAudio.loop = true;
ambianceAudio.volume = 0.6;
ambianceAudio.play();

const fireAudio = new Audio("audio/fire.wav");
fireAudio.loop = true;
fireAudio.volume = 0.6;
fireAudio.play();

let muted = false;

// Listen for keyboard inputs
window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") theta -= 2;
    if (e.key === "ArrowRight") theta += 2;
    if (e.key === "c" || e.key === "C") autoRotate = !autoRotate;
    if (e.key === "s" || e.key === "S") showShadows = !showShadows;
    if (e.key === "d" || e.key === "D") {
        lightOn = !lightOn;
        if (lightOn) fireAudio.play();
        else fireAudio.pause();
    }
    if (e.key === "a" || e.key === "A") swingLantern = !swingLantern;
    if (e.key === "m" || e.key === "M") {
        muted = !muted;
        ambianceAudio.muted = muted;
        fireAudio.muted = muted;
    }
    updateStatus();
});

// Updates the text beneath the canvas
function updateStatus() {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent =
        `[C] Cam:${autoRotate ? "AUTO" : "MANUAL"}  ` +
        `[S] Shadows:${showShadows ? "ON" : "OFF"}  ` +
        `[D] Fire:${lightOn ? "ON" : "OFF"}  ` +
        `[A] Lantern:${swingLantern ? "SWING" : "STILL"} ` +
        `[M] Sound:${muted ? "OFF" : "ON"}`;
}

// Math trick to smash 3D coordinates onto a flat plane based on a light position
function makeShadowMat(lp, groundY) {
    let A=0, B=1, C=0, D=-groundY;
    let lx=lp[0], ly=lp[1], lz=lp[2], lw=1;
    let dot = B*ly + D*lw;
    return transpose(mat4(
        dot-lx*A,  -ly*A,    -lz*A,    -lw*A,
        -lx*B,    dot-ly*B, -lz*B,    -lw*B,
        -lx*C,    -ly*C,   dot-lz*C,  -lw*C,
        -lx*D,    -ly*D,   -lz*D,    dot-lw*D
    ));
}

// Basic geometry generators. These build vertices, normals, and UVs
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

// Procedural geometry specifically for the campfire flames
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

function makeBottle() {
    // Stack a cylinder body + tapered neck + thin cylinder top
    let parts = [
        makeCylinder(-1.5, 0, -1.5, 0.18, 0.8, 16),  // body
        makeCone(-1.5, 0.8, -1.5, 0.18, 0.25, 16),     // taper to neck
        makeCylinder(-1.5, 0.9, -1.5, 0.07, 0.3, 16), // neck
    ];
    // Merge all parts into one mesh
    let verts=[], norms=[], texs=[], idx=[];
    let offset = 0;
    for (let p of parts) {
        for (let v of p.verts) verts.push(v);
        for (let n of p.norms) norms.push(n);
        for (let t of p.texs)  texs.push(t);
        for (let i of p.idx)   idx.push(i + offset);
        offset += p.verts.length / 4;
    }
    return {verts, norms, texs, idx};
}

// Pushes our generated JS arrays into the GPU's memory buffers
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

// Similar to uploadMesh, but built to handle the output format of our OBJ parser
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

// While images load, we apply a tiny 1x1 solid color texture so things don't look broken
function createSolidTex(r, g, b, a) {
    let t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r,g,b,a]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
}

// Asynchronously loads images and sends them to the GPU
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

// Central helper function to quickly set the material properties before drawing a mesh
function setMainUniforms(modelM, useTex, tex, amb, diff, spec, shin) {
    gl.useProgram(program);
    gl.uniformMatrix4fv(modelMatrixLoc,       false, flatten(modelM));
    // The normal matrix fixes lighting bugs when objects are non uniformly scaled
    gl.uniformMatrix4fv(mloc.normalMat,       false, flatten(transpose(inverse(modelM))));
    gl.uniform1f(mloc.useTex,  useTex ? 1 : 0);
    gl.uniform4fv(mloc.ambient,  flatten(amb));
    gl.uniform4fv(mloc.diffuse,  flatten(diff));
    gl.uniform4fv(mloc.specular, flatten(spec));
    gl.uniform1f(mloc.shininess, shin);
    gl.uniform3fv(mloc.emissive, new Float32Array([0, 0, 0]));

    if (useTex && tex) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(mloc.tex, 0);
    }
}

// Connects buffers to shader variables and fires off the draw command
function drawMesh(mesh) {
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vNormal);

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

// Uses our shadow program to re draw a mesh entirely flat
function drawShadow(mesh, modelM, shadowM) {
    if (!showShadows || !lightOn) return;
    gl.useProgram(shadowProgram);
    gl.uniformMatrix4fv(sloc.shadowMat, false, flatten(mult(shadowM, modelM)));
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(sloc.vPos, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(sloc.vPos);

    // Enable transparency for the shadows
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

// Draws things that reflect the skybox
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
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (mesh.isIndexed) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
        gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    } else {
        gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    gl.disable(gl.BLEND);
}

// Ensure loaded models sit on the floor (Y = 0)
function shiftToGround(parsed) {
    const pos = parsed.vertices;
    let minY = Infinity;
    for (let i=1; i<pos.length; i+=4) if (pos[i] < minY) minY = pos[i];
    for (let i=1; i<pos.length; i+=4) pos[i] -= minY;
}

// Fetch custom OBJ files
async function loadAllOBJs() {
    async function load(path, size) {
        try {
            const r = await fetch(path);
            if (!r.ok) throw new Error("HTTP " + r.status);
            const parsed = parseOBJ(await r.text());
            normalizeOBJ(parsed, size); // Scale it down/up to a standard size
            shiftToGround(parsed);
            return uploadOBJMesh(parsed);
        } catch(e) {
            console.warn("Could not load " + path + ":", e);
            return null;
        }
    }
    tentOBJ     = await load("models/Tent.obj",             3.0);
    campfireOBJ = await load("models/PUSHILIN_campfire.obj", 1.4);
    lanternOBJ  = await load("models/Stylized_Lantern.obj",  0.9);
}

// --- MAIN INIT FUNCTION ---
window.onload = async function init() {
    const canvas = document.getElementById("gl-canvas");
    gl = WebGLUtils.setupWebGL(canvas);
    if (!gl) { alert("WebGL isn't available"); return; }

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0); // Black background
    gl.enable(gl.DEPTH_TEST);          // Make sure objects in front hide objects behind them
    gl.depthFunc(gl.LEQUAL);

    // Compile our shaders and grab variable locations
    program = initShaders(gl, "vertex-shader", "fragment-shader");
    gl.useProgram(program);

    vPosition = gl.getAttribLocation(program, "vPosition");
    vNormal   = gl.getAttribLocation(program, "vNormal");

    modelMatrixLoc = gl.getUniformLocation(program, "uModel");
    viewMatrixLoc  = gl.getUniformLocation(program, "uView");
    projMatrixLoc  = gl.getUniformLocation(program, "uProj");
    lightPosLoc    = gl.getUniformLocation(program, "uLightPos");
    cameraPosLoc   = gl.getUniformLocation(program, "uCameraPos");

    mloc.normalMat  = gl.getUniformLocation(program, "uNormalMat");
    mloc.useTex     = gl.getUniformLocation(program, "uUseTex");
    mloc.tex        = gl.getUniformLocation(program, "uTex");
    mloc.vTex       = gl.getAttribLocation (program, "vTexCoord");
    mloc.ambient    = gl.getUniformLocation(program, "uAmbient");
    mloc.diffuse    = gl.getUniformLocation(program, "uDiffuse");
    mloc.specular   = gl.getUniformLocation(program, "uSpecular");
    mloc.shininess  = gl.getUniformLocation(program, "uShininess");
    mloc.lightOn    = gl.getUniformLocation(program, "uLightOn");
    mloc.ambCol     = gl.getUniformLocation(program, "uAmbientColor");
    mloc.lightColor = gl.getUniformLocation(program, "uLightColor");
    mloc.lanternPos   = gl.getUniformLocation(program, "uLanternPos");
    mloc.lanternColor = gl.getUniformLocation(program, "uLanternColor");
    mloc.lanternOn    = gl.getUniformLocation(program, "uLanternOn");
    mloc.emissive     = gl.getUniformLocation(program, "uEmissive");

    skyboxProgram = initShaders(gl, "skybox-vertex", "skybox-fragment");
    shadowProgram = initShaders(gl, "shadow-vertex", "shadow-fragment");
    envProgram    = initShaders(gl, "envmap-vertex", "reflect-fragment");
    fireProgram   = initShaders(gl, "fire-vertex",   "fire-fragment");

    // Map out shadow locations
    gl.useProgram(shadowProgram);
    sloc.vPos      = gl.getAttribLocation(shadowProgram, "vPosition");
    sloc.shadowMat = gl.getUniformLocation(shadowProgram, "uShadowMat");
    sloc.view      = gl.getUniformLocation(shadowProgram, "uView");
    sloc.proj      = gl.getUniformLocation(shadowProgram, "uProj");

    // Map out environment locations
    gl.useProgram(envProgram);
    eloc.vPos         = gl.getAttribLocation (envProgram, "vPosition");
    eloc.vNorm        = gl.getAttribLocation (envProgram, "vNormal");
    eloc.model        = gl.getUniformLocation(envProgram, "uModel");
    eloc.view         = gl.getUniformLocation(envProgram, "uView");
    eloc.proj         = gl.getUniformLocation(envProgram, "uProj");
    eloc.normalMat    = gl.getUniformLocation(envProgram, "uNormalMat");
    eloc.camPos       = gl.getUniformLocation(envProgram, "uCameraPos");
    eloc.skybox       = gl.getUniformLocation(envProgram, "uSkybox");
    eloc.isRefract    = gl.getUniformLocation(envProgram, "uIsRefract");
    eloc.refractRatio = gl.getUniformLocation(envProgram, "uRefractRatio");

    // --- PUDDLE / FRAME BUFFER SETUP ---
    puddleProgram = initShaders(gl, "puddle-vertex", "puddle-fragment");
    ploc.vPos      = gl.getAttribLocation(puddleProgram,  "vPosition");
    ploc.model     = gl.getUniformLocation(puddleProgram, "uModel");
    ploc.view      = gl.getUniformLocation(puddleProgram, "uView");
    ploc.proj      = gl.getUniformLocation(puddleProgram, "uProj");
    ploc.skybox    = gl.getUniformLocation(puddleProgram, "uSkybox");
    ploc.time      = gl.getUniformLocation(puddleProgram, "uTime");
    ploc.camPos    = gl.getUniformLocation(puddleProgram, "uCameraPos");
    ploc.fireColor = gl.getUniformLocation(puddleProgram, "uFireColor");
    ploc.fireOn    = gl.getUniformLocation(puddleProgram, "uFireOn");

    const REFL_SIZE = 1024;
    reflectionFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, reflectionFBO);

    // Create the texture we will render the reflection INTO
    reflectionTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, reflectionTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, REFL_SIZE, REFL_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, reflectionTex, 0);

    // Give the FBO a depth buffer so 3D sorting works while generating the reflection
    reflectionDepth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, reflectionDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, REFL_SIZE, REFL_SIZE);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, reflectionDepth);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // Skybox cube geometry
    const skyboxVertices = new Float32Array([
        -50,-50,-50,  50,-50,-50, -50, 50,-50,  50, 50,-50,
        -50,-50, 50,  50,-50, 50, -50, 50, 50,  50, 50, 50
    ]);
    const skyboxIndices = new Uint16Array([
        0,1,2, 2,1,3, 4,6,5, 5,6,7, 2,3,6, 6,3,7,
        0,4,1, 1,4,5, 1,5,3, 3,5,7, 0,2,4, 4,2,6
    ]);
    skyboxVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
    gl.bufferData(gl.ARRAY_BUFFER, skyboxVertices, gl.STATIC_DRAW);
    skyboxIBO = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, skyboxIndices, gl.STATIC_DRAW);

    // Procedural generation of primitive objects
    {
        // Simple ground plane made of two big triangles
        const gv = [
            -10,0,-10,1,  10,0,-10,1,  10,0,10,1,
            -10,0,-10,1,  10,0,10,1,  -10,0,10,1
        ];
        const gn = [0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0];
        const gt = [0,0, 1,0, 1,1, 0,0, 1,1, 0,1];
        function vbuf(data) {
            let b=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,b);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); return b;
        }
        meshes.ground = { vbo:vbuf(gv), nbo:vbuf(gn), tbo:vbuf(gt), count:6, isIndexed:false };
    }

    // Irregular puddle shape
    meshes.puddle = uploadMesh(makeIrregularDisk(2.2, 0.005, 1.2, 0.9, 40, 0,1,0));
    meshes.fire    = uploadMesh(buildFireGeo());

    // Irregular disk math to make the puddle not a perfect circle
    function makeIrregularDisk(cx, yVal, cz, r, segs, nx, ny, nz) {
        let verts=[], norms=[], texs=[], idx=[];
        verts.push(cx,yVal,cz,1); norms.push(nx,ny,nz); texs.push(0.5,0.5);
        for (let i=0; i<=segs; i++) {
            let a = (i/segs)*2*Math.PI;
            let rr = r * (1.0 + 0.15*Math.sin(a*2.0) + 0.1*Math.sin(a*3.0+1.0) + 0.08*Math.sin(a*5.0+2.0));
            verts.push(cx+rr*Math.cos(a), yVal, cz+rr*Math.sin(a), 1);
            norms.push(nx,ny,nz);
            texs.push(0.5+0.5*Math.cos(a), 0.5+0.5*Math.sin(a));
        }
        for (let i=1; i<=segs; i++) idx.push(0, i, i+1);
        return {verts, norms, texs, idx};
    }

    // Procedural trees and posts
    meshes.post = uploadMesh(makeCylinder(3.6, 0, 0.5, 0.07, 2.8, 8));
    meshes.arm  = uploadMesh(makeCylinder(0, 0, 0, 0.07, 0.8, 8));
    meshes.trunk1   = uploadMesh(makeCylinder(-7, 0,  3,  0.2,  2.0, 8));
    meshes.leaves1a = uploadMesh(makeCone(-7, 1.5, 3,  1.2, 2.0, 10));
    meshes.leaves1b = uploadMesh(makeCone(-7, 2.5, 3,  0.9, 1.8, 10));
    meshes.leaves1c = uploadMesh(makeCone(-7, 3.3, 3,  0.6, 1.5, 10));
    meshes.trunk2   = uploadMesh(makeCylinder(6,  0, -4,  0.18, 1.8, 8));
    meshes.leaves2a = uploadMesh(makeCone(6, 1.3, -4,  1.0, 1.8, 10));
    meshes.leaves2b = uploadMesh(makeCone(6, 2.1, -4,  0.7, 1.5, 10));
    meshes.bottle = uploadMesh(makeBottle());

    // Start loading textures
    groundTex   = loadTexture("textures/grass.png",                    [60,  100, 40,  255]);
    tentTex     = loadTexture("textures/linen.jpg",                    [200, 160, 110, 255]);
    campfireTex = loadTexture("textures/PUSHILIN_campfire.png",        [180, 100, 30,  255]);
    lanternTex  = loadTexture("textures/Stylized_Lantern_Diffuse.png", [180, 140, 60,  255]);

    await loadAllOBJs();

    // Start rendering only once the heavy skybox textures are done
    loadSkyboxTextures(() => {
        updateStatus();
        requestAnimationFrame(render);
    });
};

function loadSkyboxTextures(onDone) {
    const faces = {
        right:  "textures/galaxyX.png",
        left:   "textures/galaxy-X.png",
        top:    "textures/galaxyY.png",
        bottom: "textures/galaxy-Y.png",
        front:  "textures/galaxyZ.png",
        back:   "textures/galaxy-Z.png"
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
            if (loaded === total) { setupSkyboxCubemap(images); onDone(); }
        };
        img.onerror = function() {
            loaded++;
            if (loaded === total) { setupSkyboxCubemap(images); onDone(); }
        };
    }
}

// Packages our 6 skybox images into a single TEXTURE_CUBE_MAP GPU object
function setupSkyboxCubemap(images) {
    skyboxTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);

    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

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

    gl.useProgram(skyboxProgram);
    gl.uniform1i(gl.getUniformLocation(skyboxProgram, "uSkybox"), 0);
}

// --- THE MAIN RENDER LOOP ---
function render(timestamp) {
    gl.disable(gl.BLEND);

    // Calculate delta time so animations run at the same speed regardless of frame rate
    if (!lastTime) lastTime = timestamp;
    let dt = (timestamp - lastTime) / 1000;
    lastTime = timestamp;
    time += dt;

    // If the toggle is on, update the lantern's time variable
    if (swingLantern) swayTime += dt;

    if (autoRotate) autoTheta += dt * 20;
    let camAngle = theta + autoTheta;

    // View matrix: Where the camera is and where it is looking
    let eye = vec3(14*Math.sin(radians(camAngle)), 6, 14*Math.cos(radians(camAngle)));
    let at  = vec3(0, 1, 0); // Looking at the center
    let up  = vec3(0, 1, 0); // Which way is 'up'

    let viewMatrix = lookAt(eye, at, up);
    // Projection matrix = the camera's lens settings (FOV, near/far clipping planes)
    let projMatrix = perspective(45, 1, 0.1, 100);

    // Add math functions to make the fire naturally pulse and flicker
    let flicker = 0.85 + (Math.random() - 0.5) * 0.25;
    let lightPos   = vec3(0, 1.3 + 0.08*Math.sin(time*9), 0);
    let lightColor = new Float32Array([
        1.0 * flicker,
        0.55 * flicker,
        0.1 * flicker
    ]);

    // Create the shadow squishing matrix for the campfire light
    let shadowM = makeShadowMat([lightPos[0], lightPos[1] + 3.5, lightPos[2]], 0.002);

    // Calculate lantern swing math
    let swayRad   = (8.0 * Math.sin(swayTime * 0.7)) * Math.PI / 180.0;
    let lanternLx = 2.8 + Math.sin(swayRad) * 0.45;
    let lanternLy = 2.8 - Math.cos(swayRad) * 0.45;
    let lanternLightPos   = new Float32Array([lanternLx, lanternLy, 0.5]);
    let lanternLightColor = new Float32Array([1.0, 0.75, 0.25]);

    // This helper draws the ENTIRE scene. We call it twice:
    // Once mirrored into the puddle buffer, and once normally for the main screen.
    function drawScene(isRefl) {
        // If drawing a reflection, flip the lights upside down too
        let passLightPos = isRefl ? vec3(lightPos[0], -lightPos[1], lightPos[2]) : lightPos;
        let passLanternPos = isRefl ? new Float32Array([lanternLx, -lanternLy, 0.5]) : lanternLightPos;

        // ── Draw Skybox ──
        let skyViewFlat = flatten(isRefl ? mult(viewMatrix, scalem(1,-1,1)) : viewMatrix);
        skyViewFlat[12] = 0.0; skyViewFlat[13] = 0.0; skyViewFlat[14] = 0.0; // Remove translation so sky doesn't move
        gl.useProgram(skyboxProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
        gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "uView"), false, skyViewFlat);
        gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "uProj"), false, flatten(projMatrix));
        gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
        let aPos = gl.getAttribLocation(skyboxProgram, "aPosition");
        gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(aPos);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);

        gl.depthMask(false); // Don't write to depth buffer so geometry draws over the skybox perfectly
        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
        gl.depthMask(true);
        gl.clear(gl.DEPTH_BUFFER_BIT); // Clear depth so normal geometry renders normally

        // ── Setup Main Shader Uniforms ──
        gl.useProgram(program);
        gl.uniformMatrix4fv(viewMatrixLoc, false, flatten(viewMatrix));
        gl.uniformMatrix4fv(projMatrixLoc, false, flatten(projMatrix));
        gl.uniform3fv(cameraPosLoc, flatten(eye));
        gl.uniform3fv(lightPosLoc, flatten(passLightPos));
        gl.uniform3fv(mloc.lightColor, lightColor);
        gl.uniform1f(mloc.lightOn, lightOn ? 1.0 : 0.0);
        gl.uniform3fv(mloc.ambCol, new Float32Array([0.15, 0.12, 0.2]));
        gl.uniform3fv(mloc.lanternPos, passLanternPos);
        gl.uniform3fv(mloc.lanternColor, lanternLightColor);
        gl.uniform1f(mloc.lanternOn, 1.0);

        // Prep the shadow shader for later
        gl.useProgram(shadowProgram);
        gl.uniformMatrix4fv(sloc.view, false, flatten(viewMatrix));
        gl.uniformMatrix4fv(sloc.proj, false, flatten(projMatrix));

        // Prep the reflection shader for later
        gl.useProgram(envProgram);
        gl.uniformMatrix4fv(eloc.view, false, flatten(viewMatrix));
        gl.uniformMatrix4fv(eloc.proj, false, flatten(projMatrix));
        gl.uniform3fv(eloc.camPos, flatten(eye));

        gl.useProgram(program);
        const noSpec = vec4(0,0,0,1);
        const spec0  = vec4(0.15,0.15,0.15,1);
        const specMetal = vec4(0.4, 0.4, 0.35, 1);

        // Quick helper to flip things upside down if we are drawing the puddle reflection pass
        function getModel(m) { return m; }

        setMainUniforms(mat4(), true, groundTex, vec4(0.3,0.3,0.3,1), vec4(0.5,0.7,0.3,1), noSpec, 1);
        drawMesh(meshes.ground);

        if (tentOBJ) {
            let tentM = translate(-3.5, 0, 0.5);
            setMainUniforms(getModel(tentM), true, tentTex, vec4(0.3,0.3,0.3,1), vec4(0.7,0.55,0.35,1), spec0, 8);
            drawMesh(tentOBJ);
            if (!isRefl) drawShadow(tentOBJ, tentM, shadowM);
        }

        if (campfireOBJ) {
            setMainUniforms(getModel(mat4()), true, campfireTex, vec4(0.3,0.2,0.1,1), vec4(0.7,0.45,0.2,1), noSpec, 2);
            drawMesh(campfireOBJ);
        }

        if (lightOn) {
            gl.useProgram(fireProgram);
            let fs = 0.6 + 0.15*Math.sin(time*9.1) + 0.1*Math.cos(time*6.7);
            let fireM = mult(translate(0, 0.1, 0), scalem(1+0.08*Math.sin(time*5), fs, 1+0.08*Math.cos(time*4)));
            gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uModel"), false, flatten(getModel(fireM)));
            gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uView"),  false, flatten(viewMatrix));
            gl.uniformMatrix4fv(gl.getUniformLocation(fireProgram, "uProj"),  false, flatten(projMatrix));
            gl.uniform1f(gl.getUniformLocation(fireProgram, "uTime"), time);
            gl.uniform1f(gl.getUniformLocation(fireProgram, "uFlicker"), flicker);

            let fAP = gl.getAttribLocation(fireProgram, "vPosition");
            gl.bindBuffer(gl.ARRAY_BUFFER, meshes.fire.vbo);
            gl.vertexAttribPointer(fAP, 4, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(fAP);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.fire.ibo);

            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // Additive blending makes the fire "glow"
            gl.depthMask(false);
            gl.drawElements(gl.TRIANGLES, meshes.fire.count, gl.UNSIGNED_SHORT, 0);
            gl.depthMask(true); gl.disable(gl.BLEND);
            gl.useProgram(program);
        }

        // Draw trees
        setMainUniforms(getModel(mat4()), false, null, vec4(0.2,0.12,0.05,1), vec4(0.35,0.22,0.1,1), noSpec, 1);
        drawMesh(meshes.trunk1);
        setMainUniforms(getModel(mat4()), false, null, vec4(0.05,0.25,0.05,1), vec4(0.1,0.42,0.1,1), noSpec, 1);
        drawMesh(meshes.leaves1a); drawMesh(meshes.leaves1b); drawMesh(meshes.leaves1c);

        setMainUniforms(getModel(mat4()), false, null, vec4(0.2,0.12,0.05,1), vec4(0.35,0.22,0.1,1), noSpec, 1);
        drawMesh(meshes.trunk2);
        setMainUniforms(getModel(mat4()), false, null, vec4(0.05,0.25,0.05,1), vec4(0.12,0.45,0.12,1), noSpec, 1);
        drawMesh(meshes.leaves2a); drawMesh(meshes.leaves2b);

        // Draw the post for the lantern
        const woodAmb  = vec4(0.15,0.09,0.03,1);
        const woodDiff = vec4(0.32,0.20,0.08,1);
        setMainUniforms(getModel(mat4()), false, null, woodAmb, woodDiff, noSpec, 1);
        drawMesh(meshes.post);
        if (!isRefl) drawShadow(meshes.post, mat4(), shadowM);

        let armM = mult(translate(3.6, 2.8, 0.5), rotateZ(90));
        setMainUniforms(getModel(armM), false, null, woodAmb, woodDiff, noSpec, 1);
        drawMesh(meshes.arm);
        if (!isRefl) drawShadow(meshes.arm, armM, shadowM);

        if (lanternOBJ) {
            let sway = 8.0 * Math.sin(swayTime * 0.7);

            // Build the matrix right-to-left: Translate down -> rotate -> translate to post
            let lanternM = mult(translate(2.8, 2.8, 0.5), mult(rotateZ(sway), translate(0, -0.9, 0)));

            setMainUniforms(getModel(lanternM), true, lanternTex, vec4(0.3, 0.25, 0.1, 1), vec4(0.9, 0.75, 0.4, 1), specMetal, 32);
            gl.uniform3fv(mloc.emissive, new Float32Array([1.2, 0.9, 0.3])); // Make the bulb area glow
            drawMesh(lanternOBJ);
            if (!isRefl) drawShadow(lanternOBJ, lanternM, shadowM);

            // Draw an overlay pass for the reflective glass panes
            drawEnvMesh(lanternOBJ, getModel(lanternM), true, 0.67);
            gl.useProgram(program);
        }

        // Draw bottle - solid dark green glass base first, then refraction overlay
        setMainUniforms(getModel(mat4()), false, null,
            vec4(0.0, 0.05, 0.02, 1),
            vec4(0.02, 0.08, 0.04, 1),
            vec4(0.5, 0.8, 0.6, 1), 64);
        drawMesh(meshes.bottle);
        drawEnvMesh(meshes.bottle, getModel(mat4()), true, 0.35);    }

    // ── PASS 1: NORMAL VIEW (Draw to Screen) ──
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // Return rendering to the HTML canvas
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.0, 0.0, 0.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    drawScene(false); // Draw everything normally

    // ── PASS 2: DRAW THE PUDDLE ──
    gl.useProgram(puddleProgram);
    gl.uniformMatrix4fv(ploc.model, false, flatten(mat4()));
    gl.uniformMatrix4fv(ploc.view,  false, flatten(viewMatrix));
    gl.uniformMatrix4fv(ploc.proj,  false, flatten(projMatrix));
    gl.uniform1f(ploc.time, time);
    gl.uniform3fv(ploc.camPos, flatten(eye));
    gl.uniform3fv(ploc.fireColor, lightColor);
    gl.uniform1f(ploc.fireOn, lightOn ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, skyboxTexture);
    gl.uniform1i(ploc.skybox, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, meshes.puddle.vbo);
    gl.vertexAttribPointer(ploc.vPos, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(ploc.vPos);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);

    if (meshes.puddle.isIndexed) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshes.puddle.ibo);
        gl.drawElements(gl.TRIANGLES, meshes.puddle.count, gl.UNSIGNED_SHORT, 0);
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);

    requestAnimationFrame(render);
}