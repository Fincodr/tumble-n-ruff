// A small batched WebGL 1 renderer for extracted artwork and simple primitives.
const VERTEX = `
attribute vec2 a_position;
attribute vec2 a_uv;
attribute vec4 a_color;
uniform vec2 u_resolution;
varying vec2 v_uv;
varying vec4 v_color;
void main() {
  gl_Position = vec4(a_position / u_resolution * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  v_uv = a_uv; v_color = a_color;
}`;
const FRAGMENT = `
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
varying vec4 v_color;
void main() { gl_FragColor = texture2D(u_texture, v_uv) * v_color; }
`;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) throw new Error('WebGL is unavailable. Enable hardware acceleration or try another browser.');
    this.gl = gl;
    this.canvas = canvas;
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    this.program = program;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [name, size, offset] of [['a_position', 2, 0], ['a_uv', 2, 8], ['a_color', 4, 16]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 32, offset);
    }
    gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), canvas.width, canvas.height);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    this.vertices = new Float32Array(6 * 8 * 4096);
    this.used = 0;
    this.texture = null;
    this.white = this.upload({ width: 1, height: 1, data: new Uint8Array([255, 255, 255, 255]) });
  }

  upload(image) {
    const gl = this.gl, texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (image.data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return { texture, width: image.width, height: image.height };
  }

  begin() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    this.used = 0; this.texture = null;
  }

  sprite(texture, frame, x, y, flip = false, tint = [1, 1, 1, 1], width = frame.w, height = frame.h) {
    if (!frame) return;
    if (this.texture !== texture || this.used + 48 > this.vertices.length) this.flush();
    this.texture = texture;
    x = Math.round(x); y = Math.round(y);
    let u0 = frame.x / texture.width, u1 = (frame.x + frame.w) / texture.width;
    const v0 = frame.y / texture.height, v1 = (frame.y + frame.h) / texture.height;
    if (flip) [u0, u1] = [u1, u0];
    for (const [vx, vy, u, v] of [[x,y,u0,v0],[x+width,y,u1,v0],[x,y+height,u0,v1],[x,y+height,u0,v1],[x+width,y,u1,v0],[x+width,y+height,u1,v1]]) {
      this.vertices.set([vx, vy, u, v, ...tint], this.used); this.used += 8;
    }
  }

  rect(x, y, w, h, color) { this.sprite(this.white, {x:0,y:0,w:1,h:1}, x,y,false,color,w,h); }

  flush() {
    if (!this.used) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.texture.texture);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertices.subarray(0, this.used), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, this.used / 8);
    this.used = 0;
  }
}
