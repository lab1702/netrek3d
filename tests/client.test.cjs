const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({innerWidth:1280,innerHeight:720});
vm.runInContext(fs.readFileSync(path.join(root,'web/gl.js'),'utf8'),context);
const game = fs.readFileSync(path.join(root,'web/game.js'),'utf8');
vm.runInContext(game.slice(game.indexOf('function bearingFromScreen'),game.indexOf('addEventListener("mousemove"')),context);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('center reticle and view matrix agree at every pitch, including poles',()=>{
 for (const pitch of [-Math.PI/2,-0.8,0,0.8,Math.PI/2]) {
  const yaw=1.2, eye=[1000,2500,4000];
  const aim=context.bearingFromScreen(640,360,{d:yaw,pitch});
  close(aim.pitch,pitch);
  const f=[Math.cos(aim.d)*Math.cos(aim.pitch),Math.sin(aim.pitch),Math.sin(aim.d)*Math.cos(aim.pitch)];
  const m=context.mat4LookYaw(eye,yaw,pitch);
  const w=f.map((v,i)=>eye[i]+v*1000);
  close(m[0]*w[0]+m[4]*w[1]+m[8]*w[2]+m[12],0);
  close(m[1]*w[0]+m[5]*w[1]+m[9]*w[2]+m[13],0);
  close(m[2]*w[0]+m[6]*w[1]+m[10]*w[2]+m[14],-1000);
 }
});
test('off-center reticle ray projects back to the requested pixel',()=>{
 for (const pitch of [-1.5,-0.5,0.5,1.5]) for (const [x,y] of [[100,100],[1100,600]]) {
  const yaw=0.7, aim=context.bearingFromScreen(x,y,{d:yaw,pitch});
  const f=[Math.cos(aim.d)*Math.cos(aim.pitch),Math.sin(aim.pitch),Math.sin(aim.d)*Math.cos(aim.pitch)];
  const m=context.mat4Mul(context.mat4Perspective(65*Math.PI/180,1280/720,20,120000),context.mat4LookYaw([0,0,0],yaw,pitch));
  const w=m[3]*f[0]+m[7]*f[1]+m[11]*f[2];
  close(((m[0]*f[0]+m[4]*f[1]+m[8]*f[2])/w*0.5+0.5)*1280,x);
  close((0.5-(m[1]*f[0]+m[5]*f[1]+m[9]*f[2])/w*0.5)*720,y);
 }
});
test('ship nose points along its simulated heading',()=>{
 const yaw=1.1,pitch=0.8,m=context.mat4Model(10,20,30,yaw,140,pitch);
 close(m[0],Math.cos(yaw)*Math.cos(pitch)*140);
 close(m[1],Math.sin(pitch)*140);
 close(m[2],Math.sin(yaw)*Math.cos(pitch)*140);
 assert.deepEqual(Array.from(m.slice(12)),[10,20,30,1]);
});

vm.runInContext(fs.readFileSync(path.join(root,'web/radar.js'),'utf8'),context);
const observer = {i:1,tm:'F',x:10000,y:20000,z:3000,d:0,pitch:0,lk:-1};
test('radar is heading-up for every yaw and separates altitude at identical X/Y',()=>{
 for (const yaw of [0,Math.PI/2,Math.PI,3*Math.PI/2]) {
  const ahead=context.radarProject(Math.cos(yaw)*1000,Math.sin(yaw)*1000,0,yaw);
  close(ahead.x,0); assert.ok(ahead.y<0);
  const right=context.radarProject(-Math.sin(yaw)*1000,Math.cos(yaw)*1000,0,yaw);
  assert.ok(right.x>0);close(right.y,0);
  const upper=context.radarProject(500,1000,5000,yaw);
  const lower=context.radarProject(500,1000,-5000,yaw);
  close(upper.x,lower.x);assert.ok(upper.y<lower.y);
 }
});
test('radar range and visibility use all dimensions and do not expose cloaked enemies',()=>{
 const ship=(i,dx,dy,dz,extra={})=>({i,tm:'R',x:observer.x+dx,y:observer.y+dy,z:observer.z+dz,st:'alive',...extra});
 const players=[ship(1,0,0,0,{tm:'F'}),ship(2,0,0,20000),ship(3,0,0,20001),
  ship(4,14000,14000,10000),ship(5,100,0,0,{cl:true}),ship(6,100,0,0,{cl:true,tm:'F'}),ship(7,100,0,0,{st:'dead'})];
 const contacts=context.radarContacts(observer,players,[]);
 assert.deepEqual(Array.from(contacts,c=>c.object.i).sort(),[2,6]);
});
test('radar contacts remain stable through pitch changes and world translation',()=>{
 const target={n:2,o:'R',x:15000,y:24000,z:11000};
 const contact=context.radarContacts(observer,[],[target])[0];
 for (const pitch of [-Math.PI/2,0.9,Math.PI/2]) {
  const moved={...observer,pitch,x:observer.x+4000,y:observer.y-8000,z:observer.z+12000};
  const planet={...target,x:target.x+4000,y:target.y-8000,z:target.z+12000};
  const c=context.radarContacts(moved,[],[planet])[0];
  close(c.point.x,contact.point.x);close(c.point.y,contact.point.y);close(c.dz,contact.dz);
 }
});
test('radar projected sphere fits the reference volume at all headings',()=>{
 for(let i=0;i<100;i++) {
  const yaw=i*0.17,pitch=i*0.31,az=i*0.27;
  const p=context.radarProject(20000*Math.cos(pitch)*Math.cos(az),20000*Math.cos(pitch)*Math.sin(az),20000*Math.sin(pitch),yaw);
  assert.ok(Math.hypot(p.x,p.y)<=20000+1e-8);
 }
});
test('radar labels fit narrow panels and avoid contacts and other labels',()=>{
 for(const width of [320,768,1280]) {
  const {size,x}=context.radarLayout(width);
  assert.ok(x>=0 && x+size<=width);
  const occupied=[{x:size/2-10,y:size/2-10,w:20,h:20}];
  const box=context.radarLabelBox(size/2,size/2,42,size,occupied);
  assert.ok(box);assert.ok(box.x>=6 && box.x+box.w<=size-6);
  assert.ok(box.y>=32 && box.y+box.h<=size-28);
  assert.equal(context.radarLabelBox(size/2,size/2,42,size,[{x:0,y:0,w:size,h:size}]),null);
 }
 assert.equal(context.radarAltitude(-1),'0.0k');
 assert.equal(context.radarAltitude(8400),'+8.4k');
 assert.equal(context.radarAltitude(-8400),'-8.4k');
});
test('radar paints empty and crowded scenes at vertical pitch without invalid coordinates',()=>{
 const operations=[];
 const ctx=new Proxy({measureText:t=>({width:t.length*6})},{get:(o,k)=>k in o?o[k]:(...args)=>{
  for(const a of args) if(typeof a==='number')assert.ok(Number.isFinite(a),`${k}: non-finite coordinate`);
  operations.push([k,...args]);
 }});
 const planets=[{n:3,name:'Alpha Centauri',o:'F',x:15000,y:22000,z:4000}];
 const players=Array.from({length:50},(_,i)=>({i:i+2,tm:i%2?'F':'R',st:'alive',x:observer.x+Math.cos(i)*3000,y:observer.y+Math.sin(i)*3000,z:observer.z+(i-25)*200}));
 for(const width of [320,1280]) for(const pitch of [-Math.PI/2,Math.PI/2]) {
  context.drawSpatialRadar(ctx,{...observer,pitch},[],[],{F:'#ffd54f',R:'#ef5350',I:'#999'},width);
  context.drawSpatialRadar(ctx,{...observer,pitch,lk:3},players,planets,{F:'#ffd54f',R:'#ef5350',I:'#999'},width);
 }
 assert.ok(operations.some(([op])=>op==='fillText'));
 assert.ok(operations.some(([op,arg])=>op==='setLineDash' && arg.length===2));
 assert.equal(operations.filter(([op])=>op==='save').length,operations.filter(([op])=>op==='restore').length);
});
