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
