// Liquid-glass orb — WebGPU port of the demo's "Siri wave" program.
// Extra UI-only effects: state colors, cursor-following highlight and external audio bands.
(() => {
  const SHADER = `
struct U{size:vec2<f32>,time:f32,radius:f32,zoom:f32,warp:f32,ridge:f32,shade:f32,sheen:f32,gloss:f32,midA:f32,edgeA:f32,exposure:f32,glass:f32,contour:f32,pad:f32,
fx:vec4<f32>,
cA:vec4<f32>,cB:vec4<f32>,cC:vec4<f32>,cD:vec4<f32>,hi:vec4<f32>,sIn:vec4<f32>,sMid:vec4<f32>,sEdge:vec4<f32>,sheenC:vec4<f32>,spec:vec4<f32>,canvasC:vec4<f32>};
@group(0) @binding(0) var<uniform> u:U;

fn ov(d:vec3<f32>,s:vec3<f32>,a:f32)->vec3<f32>{let k=clamp(a,0.0,1.0);return s*k+d*(1.0-k);}
fn finish(c0:vec3<f32>,p:vec2<f32>)->vec3<f32>{
  var c=c0;
  c=mix(c,u.hi.rgb,u.shade*0.22*smoothstep(0.15,1.15,dot(p,vec2<f32>(-0.32,0.78))));
  c=c*(1.0-u.shade*0.34*smoothstep(-0.1,1.2,dot(p,vec2<f32>(0.45,-0.62))));
  c=c*(1.0-u.shade*0.22*smoothstep(0.72,1.08,length(p)));
  return clamp(c,vec3<f32>(0.0),vec3<f32>(1.0));
}
fn band(q:vec2<f32>,dr:f32,ph:f32,amp:f32,my:f32,env:f32,so:f32)->vec2<f32>{
  let y=amp*env*sin(q.x+dr+ph);
  let d=abs(q.y-y);
  let line=0.018/(sqrt(d*d+so*so)+0.026);
  let bd=max(0.0,max(q.y-max(my,y),min(my,y)-q.y));
  return vec2<f32>(line,0.018/(bd+0.075));
}
fn siri(p:vec2<f32>,t:f32)->vec3<f32>{
  let q=p/(0.74+u.zoom*0.34);
  let eb=cos(1.57079633*min(abs(0.9*q.x),1.0));
  let env=eb*eb;
  let low=0.5+0.5*cos(t*0.37);
  let mid=0.5+0.5*sin(t*0.51+1.2);
  let high=0.5+0.5*cos(t*0.73+2.1);
  let dr=t*2.4;
  let ma=0.25+u.ridge*0.075+low*0.018;
  let ba=ma+mid*0.025+high*0.018;
  let my=ma*env*sin(q.x*1.1+dr);
  let sp=1.85+u.warp*0.2+mid*0.28;
  let so=0.035+(1.0-u.ridge)*0.018+mid*0.006;
  let b0=band(q,dr,-sp,ba,my,env,so);
  let b1=band(q,dr,-sp*0.34,ba,my,env,so);
  let b2=band(q,dr,sp*0.34,ba,my,env,so);
  let b3=band(q,dr,sp,ba,my,env,so);
  let w0=b0.x+b0.y; let w1=b1.x+b1.y; let w2=b2.x+b2.y; let w3=b3.x+b3.y;
  let d0=w0*w0; let d1=w1*w1; let d2=w2*w2; let d3=w3*w3;
  let spc=(u.cA.rgb*d0+u.cC.rgb*d1+u.cB.rgb*d2+u.cD.rgb*d3)/max(d0+d1+d2+d3,0.0001);
  let en=(1.0-exp(-(w0+w1+w2+w3)*0.58))*env;
  let md=abs(q.y-my);
  let wc=exp(-md*md/0.0028)*env;
  var c=mix(u.cD.rgb,u.cB.rgb,smoothstep(-0.7,0.7,q.y))*0.018+spc*en*1.14;
  c=c+u.hi.rgb*wc*(0.18+0.1*low);
  c=c/(vec3<f32>(1.0)+c*0.18);
  return finish(c,p);
}
fn prof(t:f32)->f32{let d=clamp(t,0.0,1.0);return 1.0-sqrt(max(1.0-(1.0-d)*(1.0-d),0.0));}
fn lobe(n:vec2<f32>,dir:vec2<f32>,cut:f32,pw:f32)->f32{return pow(clamp((dot(n,dir)-cut)/max(1.0-cut,0.001),0.0,1.0),pw);}
fn cwave(a:f32,t:f32)->vec2<f32>{
  let w=sin(a*3.0+t*0.62)*0.52+sin(a*5.0-t*0.41+1.7)*0.31+sin(a*2.0+t*0.23+3.1)*0.17;
  let s=cos(a*3.0+t*0.62)*1.56+cos(a*5.0-t*0.41+1.7)*1.55+cos(a*2.0+t*0.23+3.1)*0.34;
  return vec2<f32>(w,s);
}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4<f32>{
  var p=array<vec2<f32>,3>(vec2<f32>(-1.0,-1.0),vec2<f32>(3.0,-1.0),vec2<f32>(-1.0,3.0));
  return vec4<f32>(p[i],0.0,1.0);
}
@fragment fn fs(@builtin(position) pos:vec4<f32>)->@location(0) vec4<f32>{
  let fc=vec2<f32>(pos.x,u.size.y-pos.y);
  let m=max(min(u.size.x,u.size.y),1.0);
  let uv=(2.0*fc-u.size)/m;
  let rad=max(u.radius,0.05);
  let t=u.time;
  let cw=cwave(atan2(uv.y,uv.x),t);
  let ca=clamp(u.contour,0.0,1.0)*0.09;
  let cr=rad*(1.0+ca*cw.x);
  let d=length(uv);
  let fq=(2.0*fc-u.size)/u.size;
  let fit=1.0-smoothstep(min(mix(cr,1.0,0.5),1.0-2.0/m),1.0,max(abs(fq.x),abs(fq.y)));
  if(d>cr*1.01){return vec4<f32>(0.0);}
  let p=uv/cr;
  let pd=length(p);
  let fa=1.0-smoothstep(0.995,1.04,pd);
  let rd=uv/max(d,0.0001);
  let n=normalize(rd-vec2<f32>(-rd.y,rd.x)*(rad*ca*cw.y/max(d,0.0001)));
  let ed=max(1.0-pd,0.0);
  let rw=0.015+0.95*clamp(u.midA,0.0,1.0);
  let pf=pow(prof(ed/max(rw,0.001)),0.68);
  let go=clamp(u.glass,0.0,1.0);
  let rp=p-n*(1.6*go*pf);
  let sp=n*(0.14*clamp(u.gloss,0.0,2.0)*go*pf);
  let f=vec3<f32>(siri(rp-sp,t).r,siri(rp,t).g,siri(rp+sp,t).b);
  let lum=dot(f,vec3<f32>(0.213,0.715,0.072));
  let cs=clamp(vec3<f32>(lum)+(f-vec3<f32>(lum))*1.22,vec3<f32>(0.0),vec3<f32>(1.0));
  var col=ov(u.canvasC.rgb,cs,0.99*fa);
  let sw=0.026+0.055*clamp(u.edgeA,0.0,1.0);
  let rim=pow((1.0-smoothstep(0.0,sw,ed))*fa,1.8);
  col=ov(col,u.sIn.rgb,rim*u.glass*0.45);
  let cool=lobe(n,normalize(vec2<f32>(0.84,0.54)),-0.32,1.8);
  let warm=lobe(n,normalize(vec2<f32>(-0.62,-0.78)),-0.28,2.0);
  let disp=rim*clamp(u.gloss,0.0,2.0)*(0.8+0.8*u.edgeA);
  col=ov(col,u.sMid.rgb,disp*cool);
  col=ov(col,u.sEdge.rgb,disp*warm);
  let es=rim*(0.015+0.15*u.edgeA)*(0.15+0.85*max(dot(n,vec2<f32>(0.45,-0.89)),0.0));
  col=col*(1.0-es);
  let sh=clamp(u.sheen,0.0,2.0);
  col=ov(col,u.sheenC.rgb,rim*lobe(n,normalize(vec2<f32>(-0.68,0.73)),0.2,2.8)*sh*1.4);
  col=ov(col,u.spec.rgb,rim*lobe(n,normalize(vec2<f32>(0.74,-0.67)),0.4,3.6)*sh);

  // Cursor-following glass highlight. fx.xy is normalized pointer position in the orb.
  let mouse=clamp(u.fx.xy,vec2<f32>(-1.0),vec2<f32>(1.0));
  let mp=mouse*0.68;
  let mDist=length(p-mp);
  let mg=exp(-mDist*mDist/0.11);
  let mdir=normalize(mouse+vec2<f32>(0.001,0.001));
  let mSpec=lobe(n,mdir,-0.08,2.6);
  col=ov(col,u.hi.rgb,mg*(0.10+0.20*go));
  col=ov(col,vec3<f32>(0.86,0.96,1.0),mSpec*rim*(0.10+0.20*go));

  // Extra demo states. 0 idle, 1 listen, 2 think, 3 speak, 4 success, 5 error.
  let success=clamp(1.0-abs(u.fx.w-4.0)*1.35,0.0,1.0);
  let error=smoothstep(4.15,5.0,u.fx.w);
  let pulse=0.5+0.5*sin(t*6.2);
  col=ov(col,vec3<f32>(0.08,1.0,0.56),success*(0.16+0.14*pulse));
  col=ov(col,vec3<f32>(1.0,0.10,0.18),error*(0.18+0.16*pulse));
  col += vec3<f32>(0.08,1.0,0.56)*success*rim*(0.06+0.05*pulse);
  col += vec3<f32>(1.0,0.08,0.16)*error*rim*(0.07+0.06*pulse);

  let ba=1.0-smoothstep(0.99,1.01,pd);
  col=clamp(col*max(u.exposure,0.0),vec3<f32>(0.0),vec3<f32>(1.0))*ba;
  let al=clamp(max(ba,max(col.r,max(col.g,col.b))),0.0,1.0);
  return vec4<f32>(col*fit,al*fit);
}`;

  // [speed, radius, zoom, warp, ridge, shade, sheen, gloss, midA, edgeA, exposure, glass, contour] + 11 colours
  const IDLE = [.246, .72, .3384, 1.664, .24, .12, .28, .24, .18, .18, 1.36, .44, 0,
    .7098, .651, .4549, .3686, .5294, .5804, .6039, .3922, .5412, .3882, .3569, .5412, .7137, .7686, .8235,
    1, 1, 1, .6078, .9569, 1, .7725, .6627, 1, .9176, .9569, 1, .8627, .9176, 1, .0118, .0157, .0353];
  const THINK = [.82, .72, .36, 3.2, .5, .12, .28, .24, .18, .18, 2, .44, 0,
    1, .847, .4196, .5098, .9569, 1, 1, .4824, .8353, .5569, .4235, 1, 1, 1, 1,
    1, 1, 1, .6078, .9569, 1, .7725, .6627, 1, .9176, .9569, 1, .8627, .9176, 1, .0118, .0157, .0353];
  const THINKING = THINK.slice(); THINKING[0]=.62; THINKING[2]=.40; THINKING[3]=2.6; THINKING[10]=1.78;
  const ALERT = THINK.slice(); ALERT[0]=.95; ALERT[2]=.33; ALERT[3]=3.6; ALERT[10]=2.12;
  const AUDIO = [[0, 'all', 0, .7, 5], [3, 'mid', .85, 0, 7], [12, 'low', .075, 0, 1], [6, 'high', .16, 0, 2], [10, 'all', 0, .12, 4]];

  const host = document.getElementById('orb');
  const canvas = host.querySelector('canvas');
  let state = 0, stateTarget = 0;
  let to = IDLE, from = IDLE.slice(), cur = IDLE.slice(), t0 = 0, dur = 0;
  let simTarget = 0, sim = 0, ext = null;
  let mouseX = 0, mouseY = 0;

  const stateConfig = {
    idle: { params: IDLE, target: 0, dur: 650 },
    listen: { params: THINK, target: 1, dur: 220 },
    thinking: { params: THINKING, target: 2, dur: 320 },
    speak: { params: THINK, target: 3, dur: 220 },
    success: { params: ALERT, target: 4, dur: 240 },
    error: { params: ALERT, target: 5, dur: 200 }
  };

  window.orbFx = {
    set(nextState = 'idle') {
      const key = stateConfig[nextState] ? nextState : 'idle';
      const next = stateConfig[key];
      if (next.params !== to) { from = cur.slice(); to = next.params; t0 = performance.now(); dur = next.dur; }
      stateTarget = next.target;
      simTarget = { idle: 0, listen: 0.5, thinking: 0.72, speak: 1, success: 0.9, error: 0.96 }[key] ?? 0;
    },
    bands(b) { ext = b; }
  };

  host.addEventListener('pointermove', (e) => {
    const r = host.getBoundingClientRect();
    mouseX = ((e.clientX - r.left) / Math.max(r.width, 1)) * 2 - 1;
    mouseY = 1 - ((e.clientY - r.top) / Math.max(r.height, 1)) * 2;
  });
  host.addEventListener('pointerleave', () => { mouseX = 0; mouseY = 0; });

  async function init() {
    if (!navigator.gpu) throw new Error('no webgpu');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no adapter');
    const device = await adapter.requestDevice();
    const ctx = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'premultiplied' });
    const module = device.createShaderModule({ code: SHADER });
    const k = { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' };
    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format, blend: { color: k, alpha: k } }] }
    });
    const buf = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });
    const out = new Float32Array(64);
    let phase = 0, last = 0;

    const frame = (now) => {
      requestAnimationFrame(frame);
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;

      const p = dur ? Math.min(1, (now - t0) / dur) : 1;
      const e = to === THINK ? 1 - (1 - p) ** 3 : p * p * (3 - 2 * p);
      for (let i = 0; i < cur.length; i++) cur[i] = from[i] + (to[i] - from[i]) * e;

      sim += (simTarget - sim) * 0.08;
      const s = now / 1000, env = 0.6 + 0.4 * Math.sin(s * 1.3);
      const b = ext || {
        low: sim * env * (0.5 + 0.5 * Math.sin(s * 2.3)),
        mid: sim * env * (0.5 + 0.5 * Math.sin(s * 3.7 + 1)),
        high: sim * env * (0.5 + 0.5 * Math.sin(s * 5.1 + 2)),
        all: sim * env * (0.5 + 0.5 * Math.sin(s * 2.9 + 0.5))
      };
      const v = cur.slice();
      for (const [i, band, add, prop, cap] of AUDIO) {
        const l = Math.max(0, Math.min(1, b[band] || 0)) * 0.8;
        if (l) v[i] = Math.min(Math.max(cap, v[i]), v[i] * (1 + prop * l) + add * l);
      }
      phase += dt * Math.max(v[0], 0);

      const dpr = Math.min(devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

      out[0] = w; out[1] = h; out[2] = phase;
      for (let i = 1; i <= 12; i++) out[2 + i] = v[i];
      out[16] = mouseX; out[17] = mouseY; out[18] = sim; out[19] = stateTarget;
      for (let c = 0; c < 11; c++) {
        out.set([v[13 + c * 3], v[14 + c * 3], v[15 + c * 3], 1], 20 + c * 4);
      }
      device.queue.writeBuffer(buf, 0, out);

      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }]
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
      device.queue.submit([enc.finish()]);
    };
    requestAnimationFrame(frame);
  }

  init().catch(() => host.classList.add('nogpu'));
})();
