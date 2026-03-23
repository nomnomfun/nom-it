import Phaser from 'phaser';

/**
 * Bakes a white sticker-style outline border around a source texture using a raw WebGL shader.
 *
 * The output texture is (srcW + 2*border) × (srcH + 2*border). For each output pixel, the
 * shader checks whether any source pixel within `border` pixels (square neighborhood) has
 * non-zero alpha. If so, and the current pixel is transparent, it outputs white. This produces
 * a clean border on any alpha shape — rectangles today, arbitrary PNGs later.
 *
 * Y-flip convention: the shader writes visual-top content to framebuffer y=0 (bottom), matching
 * the convention Phaser expects for textures registered via addGLTexture / rt.saveTexture.
 * v=0 of the resulting texture samples the visual top of the bordered image.
 *
 * Context loss: the baked texture is created via renderer.createTextureFromSource so Phaser
 * tracks it. The pixel content is not automatically restored on context loss — callers that
 * need persistence should listen to the renderer's 'restorecontext' event and rebake.
 */

// ---------------------------------------------------------------------------
// GLSL source
// ---------------------------------------------------------------------------

const VERT_SRC = `
attribute vec2 aPos;
void main() {
    gl_Position = vec4(aPos, 0.0, 1.0);
}`.trim();

// Border size is baked into the shader as a #define so loop bounds are
// compile-time constants — required for GLSL ES 1.0 loop validation.
function buildFragSrc (border: number): string {
    return `
precision mediump float;
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
uniform bool uBorderLeft;
uniform bool uBorderRight;
uniform bool uBorderTop;
uniform bool uBorderBottom;
#define B ${border}

void main() {
    // gl_FragCoord.y = 0 at the bottom of the framebuffer.
    // We treat y = 0 as content-top (visual top of the bordered image).
    // This achieves the Y-flip that Phaser's addGLTexture convention requires:
    // v = 0 of the registered texture will sample the visual top.
    vec2 p = gl_FragCoord.xy - vec2(0.5);

    // Shift into source-pixel space (remove border padding).
    vec2 s = p - vec2(float(B));

    bool inside = s.x >= 0.0 && s.x < uSrcSize.x &&
                  s.y >= 0.0 && s.y < uSrcSize.y;

    // If we are inside the source bounds and the source pixel is non-transparent,
    // output the source colour directly.
    if (inside) {
        vec4 c = texture2D(uSrc, s / uSrcSize);
        if (c.a > 0.0) {
            gl_FragColor = c;
            return;
        }
    }

    // Suppress the border on disabled edge zones (cut sides of bitten segments).
    // s.x < 0 is the left padding zone; s.x >= srcW is the right padding zone.
    // s.y < 0 is the visual-top padding zone; s.y >= srcH is the visual-bottom zone.
    if (s.x < 0.0 && !uBorderLeft)         { gl_FragColor = vec4(0.0); return; }
    if (s.x >= uSrcSize.x && !uBorderRight) { gl_FragColor = vec4(0.0); return; }
    if (s.y < 0.0 && !uBorderTop)           { gl_FragColor = vec4(0.0); return; }
    if (s.y >= uSrcSize.y && !uBorderBottom){ gl_FragColor = vec4(0.0); return; }

    // Otherwise check every neighbour within the border radius.
    // If any neighbour has non-zero alpha we are on the outline — output white.
    for (int dx = -B; dx <= B; dx++) {
        for (int dy = -B; dy <= B; dy++) {
            vec2 n = s + vec2(float(dx), float(dy));
            if (n.x >= 0.0 && n.x < uSrcSize.x &&
                n.y >= 0.0 && n.y < uSrcSize.y) {
                if (texture2D(uSrc, n / uSrcSize).a > 0.0) {
                    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0);
                    return;
                }
            }
        }
    }

    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
}`.trim();
}

// ---------------------------------------------------------------------------
// Shader program cache (keyed by border size — the only compile-time variable)
// ---------------------------------------------------------------------------

interface CompiledProgram {
    program: WebGLProgram;
    border: number;
    aPosLoc: number;
    uSrcLoc: WebGLUniformLocation;
    uSrcSizeLoc: WebGLUniformLocation;
    uBorderLeftLoc: WebGLUniformLocation;
    uBorderRightLoc: WebGLUniformLocation;
    uBorderTopLoc: WebGLUniformLocation;
    uBorderBottomLoc: WebGLUniformLocation;
}

let cachedProgram: CompiledProgram | null = null;

function compileShader (gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`OutlineTextureBuilder: shader compile error — ${log}`);
    }
    return shader;
}

function getProgram (gl: WebGLRenderingContext, border: number): CompiledProgram {
    if (cachedProgram && cachedProgram.border === border) {
        return cachedProgram;
    }

    if (cachedProgram) {
        gl.deleteProgram(cachedProgram.program);
        cachedProgram = null;
    }

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, buildFragSrc(border));

    const program = gl.createProgram()!;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    gl.deleteShader(vert);
    gl.deleteShader(frag);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(program);
        gl.deleteProgram(program);
        throw new Error(`OutlineTextureBuilder: shader link error — ${log}`);
    }

    cachedProgram = {
        program,
        border,
        aPosLoc: gl.getAttribLocation(program, 'aPos'),
        uSrcLoc: gl.getUniformLocation(program, 'uSrc')!,
        uSrcSizeLoc: gl.getUniformLocation(program, 'uSrcSize')!,
        uBorderLeftLoc: gl.getUniformLocation(program, 'uBorderLeft')!,
        uBorderRightLoc: gl.getUniformLocation(program, 'uBorderRight')!,
        uBorderTopLoc: gl.getUniformLocation(program, 'uBorderTop')!,
        uBorderBottomLoc: gl.getUniformLocation(program, 'uBorderBottom')!,
    };

    return cachedProgram;
}

// Fullscreen NDC quad (two triangles, 6 vertices × 2 floats)
const QUAD_VERTS = new Float32Array([
    -1, -1,   1, -1,  -1,  1,
    -1,  1,   1, -1,   1,  1,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Which sides of the output texture should receive the white sticker border.
 * Defaults to `true` (border shown) when omitted. Set a side to `false` to
 * suppress the border on that edge — used for cut edges on bitten segments.
 */
export interface BorderEdges {
    left?: boolean;
    right?: boolean;
    top?: boolean;
    bottom?: boolean;
}

/**
 * Bakes a white outline border around `sourceKey` and registers the result as
 * `outputKey` in Phaser's TextureManager.
 *
 * The output texture dimensions are (srcW + 2*border) × (srcH + 2*border).
 * If `outputKey` already exists it is removed before registration.
 *
 * Must be called after the WebGL context is ready (i.e. inside or after create()).
 * No-ops gracefully when the renderer is not WebGL.
 */
export function bakeOutlineTexture (
    scene: Phaser.Scene,
    sourceKey: string,
    border: number,
    outputKey: string,
    edges: BorderEdges = {},
): void {
    // Guard: canvas renderer has no gl context
    if (!(scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer)) {
        // Cannot bake without WebGL; callers should handle this gracefully
        return;
    }

    const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    const gl = renderer.gl;

    // Resolve source texture dimensions and raw GL handle
    const srcSource = scene.textures.get(sourceKey).source[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const srcWrapper = srcSource.glTexture as any;
    const srcGLTex = srcWrapper.webGLTexture as WebGLTexture;
    const srcW = srcSource.width;
    const srcH = srcSource.height;

    const dstW = srcW + border * 2;
    const dstH = srcH + border * 2;

    // Compile / retrieve cached shader
    const prog = getProgram(gl, border);

    // ---------------------------------------------------------------------------
    // Save GL state BEFORE createTextureFromSource, which changes texture binding
    // ---------------------------------------------------------------------------
    const prevFBO = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevProgram = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null;
    const prevBuffer = gl.getParameter(gl.ARRAY_BUFFER_BINDING) as WebGLBuffer | null;
    const prevActiveTexture = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    const prevTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    const prevBlend = gl.getParameter(gl.BLEND) as boolean;
    const prevClearColor = gl.getParameter(gl.COLOR_CLEAR_VALUE) as Float32Array;
    // Phaser tracks its own currentFramebuffer; null it so the next setFramebuffer
    // call re-binds correctly regardless of what we did to the raw GL state.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const phaserRenderer = renderer as any;
    const prevPhaserFBO = phaserRenderer.currentFramebuffer;

    // Create the output texture via Phaser so it is tracked for context restore
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outWrapper = (renderer as any).createTextureFromSource(null, dstW, dstH, 0) as any;

    // Create a temporary framebuffer pointing at the output texture
    const fbo = gl.createFramebuffer()!;

    try {
        // ---------------------------------------------------------------------------
        // Set up our offscreen render pass
        // ---------------------------------------------------------------------------
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D, outWrapper.webGLTexture, 0,
        );

        const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error(`OutlineTextureBuilder: framebuffer incomplete — status 0x${fbStatus.toString(16)}`);
        }

        gl.viewport(0, 0, dstW, dstH);
        gl.disable(gl.BLEND);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Bind our shader and set uniforms
        gl.useProgram(prog.program);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, srcGLTex);
        gl.uniform1i(prog.uSrcLoc, 0);
        gl.uniform2f(prog.uSrcSizeLoc, srcW, srcH);
        gl.uniform1i(prog.uBorderLeftLoc,   edges.left   !== false ? 1 : 0);
        gl.uniform1i(prog.uBorderRightLoc,  edges.right  !== false ? 1 : 0);
        gl.uniform1i(prog.uBorderTopLoc,    edges.top    !== false ? 1 : 0);
        gl.uniform1i(prog.uBorderBottomLoc, edges.bottom !== false ? 1 : 0);

        // Upload the fullscreen quad and draw
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(prog.aPosLoc);
        gl.vertexAttribPointer(prog.aPosLoc, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.disableVertexAttribArray(prog.aPosLoc);
        gl.deleteBuffer(vbo);

    } finally {
        // ---------------------------------------------------------------------------
        // Restore raw GL state unconditionally
        // ---------------------------------------------------------------------------
        gl.bindFramebuffer(gl.FRAMEBUFFER, prevFBO);
        gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
        gl.useProgram(prevProgram);
        gl.bindBuffer(gl.ARRAY_BUFFER, prevBuffer);
        gl.activeTexture(prevActiveTexture);
        gl.bindTexture(gl.TEXTURE_2D, prevTexture);
        if (prevBlend) gl.enable(gl.BLEND); else gl.disable(gl.BLEND);
        gl.clearColor(prevClearColor[0], prevClearColor[1], prevClearColor[2], prevClearColor[3]);
        gl.deleteFramebuffer(fbo);

        phaserRenderer.currentFramebuffer = prevPhaserFBO;

        // PipelineManager.rebind() is the canonical Phaser API for returning GL control
        // back to Phaser after raw WebGL operations. It resets currentProgram, blend mode,
        // VAO binding, and marks all pipelines to fully re-sync on their next draw.
        phaserRenderer.pipelines.rebind();
    }

    // Register the baked texture with Phaser's TextureManager
    if (scene.textures.exists(outputKey)) {
        scene.textures.remove(outputKey);
    }
    scene.textures.addGLTexture(outputKey, outWrapper);
}
