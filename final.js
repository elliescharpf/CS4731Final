"use strict";

let gl;
let program;
let skyboxProgram;
let skyboxVBO, skyboxIBO, skyboxTexture;

let vPosition, vNormal;
let modelMatrixLoc, viewMatrixLoc, projMatrixLoc;
let lightPosLoc, cameraPosLoc;

let theta = 0;

let groundVBuffer, groundNBuffer;
let cubeVBuffer, cubeNBuffer, cubeIBO;

window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") theta -= 2;
    if (e.key === "ArrowRight") theta += 2;
});

window.onload = function init() {
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

    modelMatrixLoc = gl.getUniformLocation(program, "modelMatrix");
    viewMatrixLoc  = gl.getUniformLocation(program, "viewMatrix");
    projMatrixLoc  = gl.getUniformLocation(program, "projMatrix");
    lightPosLoc    = gl.getUniformLocation(program, "lightPos");
    cameraPosLoc   = gl.getUniformLocation(program, "cameraPos");

    gl.uniform4fv(gl.getUniformLocation(program, "ambientProduct"), flatten(vec4(0.2,0.2,0.2,1)));
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

    skyboxProgram = initShaders(gl, "skybox-vertex", "skybox-fragment");

    // load cubemap from PNGs
    loadSkyboxTextures(() => {
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

    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.right);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_X, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.left);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.top);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.bottom);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.front);
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, images.back);

    const loc = gl.getUniformLocation(skyboxProgram, "uSkybox");
    gl.uniform1i(loc, 0);
}

function render() {
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    let eye = vec3(14*Math.sin(radians(theta)), 6, 14*Math.cos(radians(theta)));
    let at  = vec3(0,1,0);
    let up  = vec3(0,1,0);

    let viewMatrix = lookAt(eye, at, up);
    let projMatrix = perspective(45, 1, 0.1, 100);

    // --- Draw Skybox ---
    gl.useProgram(skyboxProgram);

    gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "viewMatrix"), false, flatten(viewMatrix));
    gl.uniformMatrix4fv(gl.getUniformLocation(skyboxProgram, "projMatrix"), false, flatten(projMatrix));

    gl.bindBuffer(gl.ARRAY_BUFFER, skyboxVBO);
    let aPos = gl.getAttribLocation(skyboxProgram, "aPosition");
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(aPos);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, skyboxIBO);

    gl.depthMask(false);
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);

    // --- Draw Ground and Cube ---
    gl.useProgram(program);

    gl.uniformMatrix4fv(viewMatrixLoc, false, flatten(viewMatrix));
    gl.uniformMatrix4fv(projMatrixLoc, false, flatten(projMatrix));
    gl.uniform3fv(lightPosLoc, flatten(vec3(0,10,0)));
    gl.uniform3fv(cameraPosLoc, flatten(eye));

    // Ground
    gl.bindBuffer(gl.ARRAY_BUFFER, groundVBuffer);
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vPosition);

    gl.bindBuffer(gl.ARRAY_BUFFER, groundNBuffer);
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vNormal);

    gl.uniformMatrix4fv(modelMatrixLoc, false, flatten(mat4()));
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Cube
    gl.bindBuffer(gl.ARRAY_BUFFER, cubeVBuffer);
    gl.vertexAttribPointer(vPosition, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, cubeNBuffer);
    gl.vertexAttribPointer(vNormal, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIBO);

    gl.uniformMatrix4fv(modelMatrixLoc, false, flatten(mat4()));
    gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);

    requestAnimationFrame(render);
}