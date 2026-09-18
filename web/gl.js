// gl.js — raw-WebGL rendering for the cockpit and miniature map objects.
// World mapping: netrek (x, y, z) -> WebGL (x, z, y); game Z is altitude.
"use strict";

const TEAM_COLORS = {
  F: [1.0, 0.84, 0.31], R: [0.94, 0.33, 0.31], K: [0.40, 0.73, 0.42],
  O: [0.39, 0.71, 0.96], I: [0.62, 0.62, 0.62],
};

const FOV = 65 * Math.PI / 180;
const EYE_HEIGHT = 0;
const PLANET_RADIUS = 600;        // ORBDIST is 800, so orbits skim the surface
const PLANET_FADE = 18000, PLANET_MAX = 25000;
const SHIP_FADE = 10000, SHIP_MAX = 20000; // matches the minimap radar range
const BOOM_MAX = 30000; // distant battle flashes, but not cross-galaxy
const SHIP_SCALE = 140;
const SHIP_SPECULAR = 0.6;
const PLANET_SPECULAR = 0.1;
// Keep fragment lighting vectors and their squared lengths in mediump range.
const LIGHT_SCALE = 1 / 2048;

// ---------- matrix helpers (column-major mat4) ----------
function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1,
          0, 0, 2 * far * near * nf, 0];
}
function mat4Mul(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
// Camera basis in WebGL coordinates (game altitude maps to Y).
function cockpitFrame(you, planet = null) {
  const c=Math.cos(you.d), n=Math.sin(you.d), cp=Math.cos(you.pitch), sp=Math.sin(you.pitch);
  let f=[c*cp,sp,n*cp], r=[-n,0,c], u=[-c*sp,cp,-n*sp];
  if (planet) {
    const radial=[you.x-planet.x,you.z-planet.z,you.y-planet.y];
    const distance=Math.hypot(...radial);
    if (distance > PLANET_RADIUS) {
      u=radial.map(v=>v/distance);
      const dot=f.reduce((sum,v,i)=>sum+v*u[i],0);
      const tangent=f.map((v,i)=>v-dot*u[i]);
      const length=Math.hypot(...tangent);
      if(length>1e-6) {
        f=tangent.map(v=>v/length);
        r=[f[1]*u[2]-f[2]*u[1],f[2]*u[0]-f[0]*u[2],f[0]*u[1]-f[1]*u[0]];
        // Put the nearest limb at 95% of viewport height: a 5% sliver.
        const tilt=Math.PI/2-Math.asin(PLANET_RADIUS/distance)-Math.atan(0.9*Math.tan(FOV/2));
        const ct=Math.cos(tilt),st=Math.sin(tilt),forward=f;
        f=forward.map((v,i)=>v*ct-u[i]*st);
        u=u.map((v,i)=>v*ct+forward[i]*st);
      }
    }
  }
  return {f,r,u};
}
function mat4LookFrame(eye, {f,r,u}) {
  const dot = v => v[0]*eye[0]+v[1]*eye[1]+v[2]*eye[2];
  return [r[0],u[0],-f[0],0, r[1],u[1],-f[1],0, r[2],u[2],-f[2],0,
          -dot(r),-dot(u),dot(f),1];
}
function mat4LookYaw(eye, yaw, pitch = 0) {
  return mat4LookFrame(eye,cockpitFrame({d:yaw,pitch}));
}
function mat4Model(x, y, z, yaw, s, pitch = 0) {
  const c = Math.cos(yaw), n = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [c*cp*s,sp*s,n*cp*s,0, -c*sp*s,cp*s,-n*sp*s,0, -n*s,0,c*s,0,x,y,z,1];
}

// ---------- shaders ----------
const MESH_VS = `
attribute vec3 aPos; attribute vec3 aNorm;
uniform mat4 uPV, uModel; uniform vec3 uEye;
varying mediump vec3 vNorm; varying mediump vec3 vRelative;
void main() { vec4 w = uModel * vec4(aPos, 1.0);
  gl_Position = uPV * w; vRelative = (w.xyz - uEye) * ${LIGHT_SCALE};
  vNorm = normalize(mat3(uModel[0].xyz, uModel[1].xyz, uModel[2].xyz) * aNorm); }`;
const MESH_FS = `
precision mediump float;
uniform vec4 uColor; uniform vec3 uLight; uniform float uEmissive;
uniform float uSpec;
uniform vec3 uBoomPos[4]; uniform vec4 uBoomCol[4]; // rgb premultiplied, w = radius
varying mediump vec3 vNorm; varying mediump vec3 vRelative;
void main() {
  vec3 n = normalize(vNorm);
  vec3 c = uColor.rgb * (0.30 + 0.75 * max(dot(n, uLight), 0.0));
  // Blinn-Phong sun glint: white, view-dependent, strength per object type
  vec3 h = normalize(uLight + normalize(-vRelative));
  c += uSpec * pow(max(dot(n, h), 0.0), 32.0);
  for (int i = 0; i < 4; i++) {
    vec3 dv = uBoomPos[i] - vRelative;
    float dist = max(length(dv), ${LIGHT_SCALE});
    if (dist < uBoomCol[i].w) {
      float att = 1.0 - dist / uBoomCol[i].w;
      c += uColor.rgb * uBoomCol[i].rgb * max(dot(n, dv / dist), 0.0) * att * att;
    }
  }
  gl_FragColor = vec4(mix(c, uColor.rgb, uEmissive), uColor.a);
}`;
const POINT_VS = `
attribute vec3 aPos; attribute vec4 aColor; attribute float aSize;
uniform mat4 uPV; varying vec4 vColor;
void main() { gl_Position = uPV * vec4(aPos, 1.0); vColor = aColor;
  gl_PointSize = aSize; }`;
const POINT_FS = `
precision mediump float; varying vec4 vColor;
void main() { vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - smoothstep(0.6, 1.0, r))); }`;
const LINE_VS = `
attribute vec3 aPos; attribute vec4 aColor; uniform mat4 uPV; varying vec4 vColor;
void main() { gl_Position = uPV * vec4(aPos, 1.0); vColor = aColor; }`;
const LINE_FS = `
precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;

function makeProgram(gl, vsSrc, fsSrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function meshLocations(gl, program) {
  const loc = {
    aPos: gl.getAttribLocation(program, 'aPos'),
    aNorm: gl.getAttribLocation(program, 'aNorm'),
  };
  for (const name of ['uPV','uModel','uColor','uLight','uEmissive','uEye','uSpec'])
    loc[name] = gl.getUniformLocation(program, name);
  loc.uBoomPos = gl.getUniformLocation(program, 'uBoomPos[0]');
  loc.uBoomCol = gl.getUniformLocation(program, 'uBoomCol[0]');
  return loc;
}

// ---------- geometry ----------
function makeSphere(lon, lat) {
  const verts = [], idx = [];
  for (let j = 0; j <= lat; j++) {
    const t = j / lat * Math.PI, st = Math.sin(t), ct = Math.cos(t);
    for (let i = 0; i <= lon; i++) {
      const f = i / lon * 2 * Math.PI;
      const x = st * Math.cos(f), y = ct, z = st * Math.sin(f);
      verts.push(x, y, z, x, y, z);
    }
  }
  for (let j = 0; j < lat; j++) for (let i = 0; i < lon; i++) {
    const a = j * (lon + 1) + i, b = a + lon + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}
function makeShipMesh() {
  // flattened dart pointing +X; per-face normals
  const nose = [1.6, 0, 0], top = [-0.6, 0.45, 0], bot = [-0.6, -0.25, 0],
        left = [-1.0, 0, -0.9], right = [-1.0, 0, 0.9];
  const tri = (a, b, c) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    return [...a, nx, ny, nz, ...b, nx, ny, nz, ...c, nx, ny, nz];
  };
  const verts = [
    ...tri(nose, left, top), ...tri(nose, top, right),
    ...tri(nose, bot, left), ...tri(nose, right, bot),
    ...tri(top, left, right), ...tri(bot, right, left),
  ];
  return { verts: new Float32Array(verts), count: verts.length / 6 };
}

// ---------- renderer ----------
function Renderer(canvas) {
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) throw new Error("WebGL unavailable");
  this.gl = gl;
  this.canvas = canvas;

  this.meshProg = makeProgram(gl, MESH_VS, MESH_FS);
  this.pointProg = makeProgram(gl, POINT_VS, POINT_FS);
  this.lineProg = makeProgram(gl, LINE_VS, LINE_FS);
  this.loc = {
    mesh: meshLocations(gl, this.meshProg),
    point: { aPos: gl.getAttribLocation(this.pointProg, "aPos"),
             aColor: gl.getAttribLocation(this.pointProg, "aColor"),
             aSize: gl.getAttribLocation(this.pointProg, "aSize"),
             uPV: gl.getUniformLocation(this.pointProg, "uPV") },
    line: { aPos: gl.getAttribLocation(this.lineProg, "aPos"),
            aColor: gl.getAttribLocation(this.lineProg, "aColor"),
            uPV: gl.getUniformLocation(this.lineProg, "uPV") },
  };

  const sphere = makeSphere(28, 18);
  this.sphereBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.verts, gl.STATIC_DRAW);
  this.sphereIdx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.idx, gl.STATIC_DRAW);
  this.sphereCount = sphere.idx.length;

  const ship = makeShipMesh();
  this.shipBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.shipBuf);
  gl.bufferData(gl.ARRAY_BUFFER, ship.verts, gl.STATIC_DRAW);
  this.shipCount = ship.count;

  this.pointBuf = gl.createBuffer();
  this.lineBuf = gl.createBuffer();

  // starfield: fixed random points on a big sphere (slightly biased up so the
  // horizon isn't empty), drawn with rotation only
  const stars = [];
  for (let i = 0; i < 900; i++) {
    const az = Math.random() * 2 * Math.PI;
    const el = (Math.random() - 0.35) * Math.PI * 0.9;
    const r = 40000;
    const b = 0.4 + Math.random() * 0.6, sz = Math.random() < 0.08 ? 3 : 1.6;
    stars.push(r * Math.cos(el) * Math.cos(az), r * Math.sin(el),
               r * Math.cos(el) * Math.sin(az), b, b, b * (0.9 + Math.random() * 0.1),
               1, sz);
  }
  this.starData = new Float32Array(stars);
  this.starBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
  gl.bufferData(gl.ARRAY_BUFFER, this.starData, gl.STATIC_DRAW);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0.008, 0.008, 0.02, 1);
}

Renderer.prototype.resize = function () {
  const c = this.canvas, dpr = window.devicePixelRatio || 1;
  const w = Math.floor(c.clientWidth * dpr), h = Math.floor(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  this.gl.viewport(0, 0, w, h);
};

// Camera position maps game altitude Z to WebGL Y; orientation uses yaw and pitch.
// boomLights: up to 4 explosion point lights [{x, y, z, i(ntensity), r(adius)}]
Renderer.prototype.begin = function (cx, cy, yaw, boomLights, cz = 0, pitch = 0, camera = null) {
  const gl = this.gl;
  this.resize();
  this.aspect = this.canvas.width / this.canvas.height;
  this.proj = mat4Perspective(FOV, this.aspect, 20, 120000);
  this.eye = [cx, cz, cy];
  this.pv = mat4Mul(this.proj, mat4LookFrame(this.eye, camera || cockpitFrame({d:yaw,pitch})));
  this.pvRot = mat4Mul(this.proj, mat4LookFrame([0, 0, 0], camera || cockpitFrame({d:yaw,pitch})));
  this.pxFactor = (this.canvas.height / 2) / Math.tan(FOV / 2);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  this.points = [];   // accumulated point sprites: x,y,z, r,g,b,a, size
  this.lines = [];    // accumulated lines: x,y,z, r,g,b,a per vertex

  this.setLighting(this.eye, boomLights);
  this.drawStars();
};

Renderer.prototype.setLighting = function (eye, boomLights) {
  const gl = this.gl;
  // Lighting uses scaled, camera-relative coordinates in the fragment shader.
  // Upload explosion lights once per frame (unused slots have radius 0).
  const pos = new Float32Array(12), col = new Float32Array(16);
  (boomLights || []).slice(0, 4).forEach((b, i) => {
    pos[i * 3] = (b.x - eye[0]) * LIGHT_SCALE;
    pos[i * 3 + 1] = (b.z - eye[1]) * LIGHT_SCALE;
    pos[i * 3 + 2] = (b.y - eye[2]) * LIGHT_SCALE;
    col[i * 4] = 1.0 * b.i; col[i * 4 + 1] = 0.6 * b.i; col[i * 4 + 2] = 0.3 * b.i;
    col[i * 4 + 3] = b.r * LIGHT_SCALE;
  });
  gl.useProgram(this.meshProg);
  gl.uniform3fv(this.loc.mesh.uBoomPos, pos);
  gl.uniform4fv(this.loc.mesh.uBoomCol, col);
  gl.uniform3fv(this.loc.mesh.uEye, eye);
};

// world -> screen px; null if behind camera
Renderer.prototype.project = function (x, y, z) {
  const m = this.pv;
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w <= 0) return null;
  const sx = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
  const sy = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
  const dpr = window.devicePixelRatio || 1;
  return [(sx * 0.5 + 0.5) * this.canvas.width / dpr,
          (0.5 - sy * 0.5) * this.canvas.height / dpr];
};

Renderer.prototype.drawStars = function () {
  const gl = this.gl, L = this.loc.point;
  gl.depthMask(false);
  gl.useProgram(this.pointProg);
  gl.uniformMatrix4fv(L.uPV, false, this.pvRot);
  gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf);
  gl.enableVertexAttribArray(L.aPos);
  gl.enableVertexAttribArray(L.aColor);
  gl.enableVertexAttribArray(L.aSize);
  gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 32, 0);
  gl.vertexAttribPointer(L.aColor, 4, gl.FLOAT, false, 32, 12);
  gl.vertexAttribPointer(L.aSize, 1, gl.FLOAT, false, 32, 28);
  gl.drawArrays(gl.POINTS, 0, this.starData.length / 8);
  gl.depthMask(true);
};

Renderer.prototype.drawMesh = function (buf, count, indexed, model, color, emissive, spec) {
  const gl = this.gl, L = this.loc.mesh;
  gl.useProgram(this.meshProg);
  gl.uniformMatrix4fv(L.uPV, false, this.pv);
  gl.uniformMatrix4fv(L.uModel, false, model);
  gl.uniform4fv(L.uColor, color);
  gl.uniform3f(L.uLight, 0.45, 0.72, -0.53);
  gl.uniform1f(L.uEmissive, emissive || 0);
  gl.uniform1f(L.uSpec, spec || 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(L.aPos);
  gl.enableVertexAttribArray(L.aNorm);
  gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribPointer(L.aNorm, 3, gl.FLOAT, false, 24, 12);
  if (indexed) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIdx);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }
};

// planet: shrink with distance, become a dot, fade out, disappear
Renderer.prototype.drawPlanet = function (px, py, team, dist, pz = 0) {
  if (dist > PLANET_MAX) return 0;
  const alpha = dist < PLANET_FADE ? 1 :
    1 - (dist - PLANET_FADE) / (PLANET_MAX - PLANET_FADE);
  const color = TEAM_COLORS[team] || TEAM_COLORS.I;
  const pxRadius = PLANET_RADIUS / Math.max(dist, 1) * this.pxFactor;
  if (pxRadius < 2) {
    this.points.push(px, pz, py, color[0], color[1], color[2], alpha,
                     Math.max(2.5, pxRadius * 2));
  } else {
    const spin = 0; // planets don't need to spin; sphere is uniform
    this.drawMesh(this.sphereBuf, this.sphereCount, true,
                  mat4Model(px, pz, py, spin, PLANET_RADIUS),
                  [color[0], color[1], color[2], alpha], 0, PLANET_SPECULAR);
  }
  return alpha;
};

Renderer.prototype.drawShip = function (px, py, yaw, team, dist, dim, pz = 0, pitch = 0) {
  if (dist > SHIP_MAX) return 0;
  let alpha = dist < SHIP_FADE ? 1 : 1 - (dist - SHIP_FADE) / (SHIP_MAX - SHIP_FADE);
  if (dim) alpha *= 0.35;
  const color = TEAM_COLORS[team] || TEAM_COLORS.I;
  const pxSize = SHIP_SCALE / Math.max(dist, 1) * this.pxFactor;
  if (pxSize < 2) {
    this.points.push(px, pz, py, color[0], color[1], color[2], alpha, 3);
  } else {
    this.drawMesh(this.shipBuf, this.shipCount, false,
                  mat4Model(px, pz, py, yaw, SHIP_SCALE, pitch),
                  [color[0], color[1], color[2], alpha], 0, SHIP_SPECULAR);
  }
  return alpha;
};

Renderer.prototype.drawTorp = function (px, py, team, dist, pz = 0) {
  if (dist > BOOM_MAX) return;
  const alpha = dist < SHIP_MAX ? 1 : 1 - (dist - SHIP_MAX) / (BOOM_MAX - SHIP_MAX);
  const color = TEAM_COLORS[team] || TEAM_COLORS.I;
  const size = Math.min(10, Math.max(2.5, 90 / Math.max(dist, 1) * this.pxFactor));
  this.points.push(px, pz, py, Math.min(1, color[0] + .3), Math.min(1, color[1] + .3),
                   Math.min(1, color[2] + .3), alpha, size);
};

Renderer.prototype.drawExplosion = function (px, py, age, scale, pz = 0) { // age 0..1
  if (Math.hypot(px - this.eye[0], py - this.eye[2], pz - this.eye[1]) > BOOM_MAX) return;
  const r = (100 + age * 900) * (scale || 1);
  this.gl.depthMask(false); // translucent shell must not occlude torps/beams
  this.drawMesh(this.sphereBuf, this.sphereCount, true,
                mat4Model(px, pz, py, 0, r), [1, .6, .15, (1 - age) * .8], 1);
  this.gl.depthMask(true);
};

Renderer.prototype.drawPhaser = function (x1, y1, x2, y2, team, alpha, z1 = 0, z2 = 0) {
  const d1 = Math.hypot(x1 - this.eye[0], y1 - this.eye[2], z1 - this.eye[1]);
  const d2 = Math.hypot(x2 - this.eye[0], y2 - this.eye[2], z2 - this.eye[1]);
  if (Math.min(d1, d2) > BOOM_MAX) return; // beams flash like explosions do
  const c = TEAM_COLORS[team] || TEAM_COLORS.I;
  this.lines.push(x1, z1, y1, c[0], c[1], c[2], alpha,
                  x2, z2, y2, c[0], c[1], c[2], alpha);
};

Renderer.prototype.finish = function () {
  const gl = this.gl;
  if (this.lines.length) {
    const L = this.loc.line;
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(L.uPV, false, this.pv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.lines), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(L.aPos);
    gl.enableVertexAttribArray(L.aColor);
    gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(L.aColor, 4, gl.FLOAT, false, 28, 12);
    gl.drawArrays(gl.LINES, 0, this.lines.length / 7);
  }
  if (this.points.length) {
    const L = this.loc.point;
    gl.depthMask(false);
    gl.useProgram(this.pointProg);
    gl.uniformMatrix4fv(L.uPV, false, this.pv);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pointBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.points), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(L.aPos);
    gl.enableVertexAttribArray(L.aColor);
    gl.enableVertexAttribArray(L.aSize);
    gl.vertexAttribPointer(L.aPos, 3, gl.FLOAT, false, 32, 0);
    gl.vertexAttribPointer(L.aColor, 4, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(L.aSize, 1, gl.FLOAT, false, 32, 28);
    gl.drawArrays(gl.POINTS, 0, this.points.length / 8);
    gl.depthMask(true);
  }
};

// Small map sprites use the cockpit meshes and shader, rendered into separate
// transparent atlas tiles. The 2D map can then interleave ships and planets in
// depth order, with its labels and selection rings still on top.
const MAP_ICON_SIZE = 32;
const SHIP_ICON_SCALE = 5; // the 2.6-unit hull is about 13 CSS pixels long
const MAP_ICON_WORLD_SCALE = 1 / 16; // keep distant map lighting in mediump range

function mapIconProjection(point, rect) {
  const focal = Math.min(rect.w, rect.h) * 1.25;
  const projection = mat4Perspective(2*Math.atan(MAP_ICON_SIZE/(2*focal)), 1,
    2000*MAP_ICON_WORLD_SCALE, 1000000*MAP_ICON_WORLD_SCALE);
  // Crop the map's perspective around this contact, preserving its view angle.
  projection[8] = 2*(point.x-rect.x-rect.w/2)/MAP_ICON_SIZE;
  projection[9] = -2*(point.y-rect.y-rect.h/2)/MAP_ICON_SIZE;
  return projection;
}

class MapIconRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = this.gl = canvas.getContext('webgl', {alpha:true, antialias:true});
    if (!gl) throw new Error('WebGL unavailable for map objects');
    this.meshProg = makeProgram(gl, MESH_VS, MESH_FS);
    this.loc = {mesh:meshLocations(gl, this.meshProg)};
    const ship = makeShipMesh();
    this.shipBuf = gl.createBuffer(); this.shipCount = ship.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ship.verts, gl.STATIC_DRAW);
    const sphere = makeSphere(28, 18);
    this.sphereBuf = gl.createBuffer(); this.sphereCount = sphere.idx.length;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereBuf);
    gl.bufferData(gl.ARRAY_BUFFER, sphere.verts, gl.STATIC_DRAW);
    this.sphereIdx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.idx, gl.STATIC_DRAW);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
  }
  render(points, camera, rect, lights, pixelRatio) {
    const gl = this.gl, scale = MAP_ICON_WORLD_SCALE;
    const tile = Math.ceil(MAP_ICON_SIZE * pixelRatio), columns = 16;
    const height = Math.ceil(points.length/columns)*tile;
    if (this.canvas.width !== columns*tile || this.canvas.height < height) {
      this.canvas.width = columns*tile; this.canvas.height = height;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const eye = camera.eye.map(v=>v*scale);
    const view = mat4LookFrame(eye, camera.frame);
    Renderer.prototype.setLighting.call(this, eye, lights.map(b=>({
      ...b,x:b.x*scale,y:b.y*scale,z:b.z*scale,r:b.r*scale,
    })));
    points.forEach((point, i) => {
      const x = i%columns*tile, y = Math.floor(i/columns)*tile;
      gl.viewport(x,y,tile,tile); gl.scissor(x,y,tile,tile);
      this.pv = mat4Mul(mapIconProjection(point, rect), view);
      const p = point.object, color = TEAM_COLORS[point.team] || TEAM_COLORS.I;
      if (point.kind === 'planet') {
        Renderer.prototype.drawMesh.call(this, this.sphereBuf, this.sphereCount, true,
          mat4Model(p.x*scale,p.z*scale,p.y*scale,0,point.radius/point.scale*scale),
          [...color,1],0,PLANET_SPECULAR);
      } else {
        Renderer.prototype.drawMesh.call(this, this.shipBuf, this.shipCount, false,
          mat4Model(p.x*scale,p.z*scale,p.y*scale,p.d,SHIP_ICON_SCALE/point.scale*scale,p.pitch),
          [...color,1],0,SHIP_SPECULAR);
      }
      point.icon = {x,y:this.canvas.height-y-tile,tile};
    });
  }
  draw(ctx, point) {
    const {x,y,tile} = point.icon, size = MAP_ICON_SIZE;
    ctx.drawImage(this.canvas,x,y,tile,tile,point.x-size/2,point.y-size/2,size,size);
  }
}
