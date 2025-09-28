function createAsteroidBelt3D(gl){
  if (!gl) {
    return { render(){} };
  }

  const isGL2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
  const ext = isGL2 ? null : gl.getExtension('ANGLE_instanced_arrays');
  if (!isGL2 && !ext) {
    throw new Error('WebGL instancing not supported');
  }

  const vsSrcGL2 = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNrm;
  layout(location=2) in vec3 iPos;
  layout(location=3) in vec3 iRot;
  layout(location=4) in float iScale;
  uniform mat4 uViewProj;
  out vec3 vN;
  out float vH;
  mat3 rotXYZ(vec3 r){
    float cx=cos(r.x), sx=sin(r.x);
    float cy=cos(r.y), sy=sin(r.y);
    float cz=cos(r.z), sz=sin(r.z);
    mat3 Rx=mat3(1,0,0, 0,cx,-sx, 0,sx,cx);
    mat3 Ry=mat3(cy,0,sy, 0,1,0, -sy,0,cy);
    mat3 Rz=mat3(cz,-sz,0, sz,cz,0, 0,0,1);
    return Rz*Ry*Rx;
  }
  void main(){
    mat3 R = rotXYZ(iRot);
    vec3 P = R*(aPos*iScale) + iPos;
    vN = normalize(R*aNrm);
    vH = P.z;
    gl_Position = uViewProj * vec4(P.xy, 0.0, 1.0);
  }`;

  const fsSrcGL2 = `#version 300 es
  precision mediump float;
  in vec3 vN;
  in float vH;
  out vec4 outC;
  uniform vec3 uLightDir;
  void main(){
    float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
    float rim = pow(1.0 - ndl, 2.0);
    vec3 base = vec3(0.72);
    vec3 col = base*(0.35+0.65*ndl) + rim*vec3(0.08,0.1,0.15);
    outC = vec4(col, 1.0);
  }`;

  const vsSrcGL1 = `attribute vec3 aPos;
  attribute vec3 aNrm;
  attribute vec3 iPos;
  attribute vec3 iRot;
  attribute float iScale;
  uniform mat4 uViewProj;
  varying vec3 vN;
  varying float vH;
  mat3 rotXYZ(vec3 r){
    float cx=cos(r.x), sx=sin(r.x);
    float cy=cos(r.y), sy=sin(r.y);
    float cz=cos(r.z), sz=sin(r.z);
    mat3 Rx=mat3(1.0,0.0,0.0, 0.0,cx,-sx, 0.0,sx,cx);
    mat3 Ry=mat3(cy,0.0,sy, 0.0,1.0,0.0, -sy,0.0,cy);
    mat3 Rz=mat3(cz,-sz,0.0, sz,cz,0.0, 0.0,0.0,1.0);
    return Rz*Ry*Rx;
  }
  void main(){
    mat3 R = rotXYZ(iRot);
    vec3 P = R*(aPos*iScale) + iPos;
    vN = normalize(R*aNrm);
    vH = P.z;
    gl_Position = uViewProj * vec4(P.xy, 0.0, 1.0);
  }`;

  const fsSrcGL1 = `precision mediump float;
  varying vec3 vN;
  varying float vH;
  uniform vec3 uLightDir;
  void main(){
    float ndl = max(dot(normalize(vN), normalize(uLightDir)), 0.0);
    float rim = pow(1.0 - ndl, 2.0);
    vec3 base = vec3(0.72);
    vec3 col = base*(0.35+0.65*ndl) + rim*vec3(0.08,0.1,0.15);
    gl_FragColor = vec4(col, 1.0);
  }`;

  const prog = createProgram(gl, isGL2 ? vsSrcGL2 : vsSrcGL1, isGL2 ? fsSrcGL2 : fsSrcGL1);
  gl.useProgram(prog);
  const loc = {
    uViewProj: gl.getUniformLocation(prog, 'uViewProj'),
    uLightDir: gl.getUniformLocation(prog, 'uLightDir')
  };

  const rock = createLowPolyRockMesh(gl);
  const N = 2200;
  const iPos = new Float32Array(N*3);
  const iRot = new Float32Array(N*3);
  const iScale = new Float32Array(N);
  const radius = 3600;
  const thickness = 550;
  for (let i=0;i<N;i++){
    const ang = (i/N)*Math.PI*2.0 + (Math.random()*0.5);
    const r = radius + (Math.random()*2-1)*thickness;
    iPos[i*3+0] = Math.cos(ang)*r;
    iPos[i*3+1] = Math.sin(ang)*r;
    iPos[i*3+2] = (Math.random()*2-1)*80;
    iRot[i*3+0] = Math.random()*Math.PI*2;
    iRot[i*3+1] = Math.random()*Math.PI*2;
    iRot[i*3+2] = Math.random()*Math.PI*2;
    iScale[i]    = 18 + Math.random()*60;
  }

  const iPosBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, iPosBuf);
  gl.bufferData(gl.ARRAY_BUFFER, iPos, gl.STATIC_DRAW);
  setupAttrib(gl, 2, iPosBuf, 3, isGL2, ext);

  const iRotBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, iRotBuf);
  gl.bufferData(gl.ARRAY_BUFFER, iRot, gl.DYNAMIC_DRAW);
  setupAttrib(gl, 3, iRotBuf, 3, isGL2, ext);

  const iScaBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, iScaBuf);
  gl.bufferData(gl.ARRAY_BUFFER, iScale, gl.STATIC_DRAW);
  setupAttrib(gl, 4, iScaBuf, 1, isGL2, ext);

  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);

  function render({cam, viewport}){
    const c = gl.canvas;
    if (c.width !== viewport.w || c.height !== viewport.h){
      c.width = viewport.w;
      c.height = viewport.h;
    }
    gl.viewport(0,0,c.width,c.height);
    gl.clearColor(0,0,0,0);
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    for (let i=0;i<N;i++){
      const base = i*3;
      iRot[base+2] += 0.05 * 0.016;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, iRotBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, iRot);

    const sx = 2/(viewport.w*cam.zoom);
    const sy = 2/(viewport.h*cam.zoom);
    const tx = -cam.x*sx;
    const ty = -cam.y*sy;
    const uViewProj = new Float32Array([
      sx, 0,  0, 0,
      0,  sy, 0, 0,
      0,  0,  1, 0,
      tx, ty, 0, 1
    ]);
    gl.useProgram(prog);
    gl.uniformMatrix4fv(loc.uViewProj, false, uViewProj);
    gl.uniform3f(loc.uLightDir, -0.3, -0.7, 0.6);

    bindMesh(gl, rock);

    if (isGL2){
      gl.drawArraysInstanced(gl.TRIANGLES, 0, rock.count, N);
    } else {
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, rock.count, N);
    }
  }

  return { render };
}

function createLowPolyRockMesh(gl){
  const verts = [];
  const nrms = [];
  const rnd = () => (Math.random()*2-1);
  for (let i=0;i<180;i++){
    const a=[rnd(),rnd(),rnd()], b=[rnd(),rnd(),rnd()], c=[rnd(),rnd(),rnd()];
    const u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
    const n=[ u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0] ];
    const len=Math.hypot(n[0],n[1],n[2])||1;
    n[0]/=len; n[1]/=len; n[2]/=len;
    verts.push(...a,...b,...c);
    nrms.push(...n,...n,...n);
  }
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  const nbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(nrms), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
  return { vbo, nbo, count: verts.length/3 };
}

function setupAttrib(gl, loc, buf, size, isGL2, ext){
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
  if (isGL2){
    gl.vertexAttribDivisor(loc, 1);
  } else if (ext){
    ext.vertexAttribDivisorANGLE(loc, 1);
  }
}

function createProgram(gl, vsSrc, fsSrc){
  function compile(type, src){
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      const info = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(info || 'Shader compile failed');
    }
    return sh;
  }
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)){
    const info = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(info || 'Program link failed');
  }
  return p;
}

function bindMesh(gl, mesh){
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0,3,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.nbo);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1,3,gl.FLOAT,false,0,0);
}
