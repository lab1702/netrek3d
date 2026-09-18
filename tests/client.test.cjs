const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const context = vm.createContext({innerWidth:1280,innerHeight:720});
vm.runInContext(fs.readFileSync(path.join(root,'web/gl.js'),'utf8'),context);
const game = fs.readFileSync(path.join(root,'web/game.js'),'utf8');
vm.runInContext(game.slice(game.indexOf('function bearingFromScreen'),game.indexOf('const helm =')),context);
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('center reticle and view matrix agree at every pitch, including poles',()=>{
 for (const pitch of [-Math.PI,-2.4,-Math.PI/2,-0.8,0,0.8,Math.PI/2,2.4,Math.PI]) {
  const yaw=1.2, eye=[1000,2500,4000];
  const aim=context.bearingFromScreen(640,360,{d:yaw,pitch});
  close(Math.sin(aim.pitch),Math.sin(pitch));
  const f=[Math.cos(aim.d)*Math.cos(aim.pitch),Math.sin(aim.pitch),Math.sin(aim.d)*Math.cos(aim.pitch)];
  const m=context.mat4LookYaw(eye,yaw,pitch);
  const w=f.map((v,i)=>eye[i]+v*1000);
  close(m[0]*w[0]+m[4]*w[1]+m[8]*w[2]+m[12],0);
  close(m[1]*w[0]+m[5]*w[1]+m[9]*w[2]+m[13],0);
  close(m[2]*w[0]+m[6]*w[1]+m[10]*w[2]+m[14],-1000);
 }
});
test('off-center reticle ray projects back to the requested pixel',()=>{
 for (const pitch of [-3,-2,-1.5,-0.5,0.5,1.5,2,3]) for (const [x,y] of [[100,100],[1100,600]]) {
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

vm.runInContext(fs.readFileSync(path.join(root,'web/galaxy.js'),'utf8'),context);
test('galaxy top and side presets preserve true coordinates and altitude',()=>{
 const rect={x:0,y:0,w:600,h:600};
 const view={center:{x:50000,y:50000,z:0},az:0,el:Math.PI/2,zoom:1};
 const center=context.galaxyProjection(view.center,view,rect);
 close(center.x,300);close(center.y,300);
 assert.ok(context.galaxyProjection({x:60000,y:50000,z:0},view,rect).x>300);
 assert.ok(context.galaxyProjection({x:50000,y:60000,z:0},view,rect).y>300);
 view.el=0;
 const above=context.galaxyProjection({x:50000,y:50000,z:10000},view,rect);
 const below=context.galaxyProjection({x:50000,y:50000,z:-10000},view,rect);
 assert.ok(above.y<300 && below.y>300);close(above.x,below.x);
 assert.equal(context.galaxyProjection({x:50000,y:300000,z:0},view,rect),null);
});
test('galaxy picking selects the frontmost visible contact and ignores empty space',()=>{
 const far={x:100,y:100,radius:5,depth:200,id:1},near={x:100,y:100,radius:5,depth:100,id:2};
 assert.equal(context.galaxyHitTest([far,near],100,100).id,2);
 assert.equal(context.galaxyHitTest([far,near],150,150),null);
 const visible=context.galaxyVisibleShips(observer,[{i:2,tm:'R',cl:true,st:'alive'},{i:3,tm:'F',cl:true,st:'alive'},{i:4,tm:'R',st:'dead'}]);
 assert.deepEqual(Array.from(visible,p=>p.i),[3]);
});

test('map ship meshes keep their heading, pitch and screen size through camera rotation and zoom',()=>{
 const rect={x:16,y:105,w:970,h:575};
 const vertex=(m,v)=>[0,1,2,3].map(r=>m[r]*v[0]+m[r+4]*v[1]+m[r+8]*v[2]+m[r+12]);
 const {size,scale,worldScale}=vm.runInContext('({size:SHIP_ICON_SIZE,scale:SHIP_ICON_SCALE,worldScale:SHIP_ICON_WORLD_SCALE})',context);
 for(const az of [-0.55,1.2]) for(const el of [0,0.55,Math.PI/2]) for(const zoom of [0.45,1,4]) {
  const view={center:{x:50000,y:50000,z:0},az,el,zoom};
  const camera=context.galaxyShipCamera(view);
  const look=context.mat4LookFrame(camera.eye.map(v=>v*worldScale),camera.frame);
  for(const d of [0,Math.PI/2,Math.PI]) for(const pitch of [-Math.PI/2,0,0.9]) {
   const ship={x:51000,y:52000,z:4000,d,pitch};
   const point=context.galaxyProjection(ship,view,rect);
   const world=context.mat4Model(ship.x,ship.z,ship.y,d,scale/point.scale,pitch);
   const model=context.mat4Model(ship.x*worldScale,ship.z*worldScale,ship.y*worldScale,d,scale/point.scale*worldScale,pitch);
   const pv=context.mat4Mul(context.shipIconProjection(point,rect),look);
   const mvp=context.mat4Mul(pv,model);
   const origin=vertex(mvp,[0,0,0]);
   close(origin[0]/origin[3],0);close(origin[1]/origin[3],0);
   for(const v of [[1.6,0,0],[-1,0,-0.9],[-1,0,0.9],[-0.6,0.45,0]]) {
    const w=vertex(world,v),expected=context.galaxyProjection({x:w[0],y:w[2],z:w[1]},view,rect);
    const clip=vertex(mvp,v);
    close(point.x+clip[0]/clip[3]*size/2,expected.x);
    close(point.y-clip[1]/clip[3]*size/2,expected.y);
    assert.ok(Math.hypot(expected.x-point.x,expected.y-point.y)<10,'small ship must fit its marker');
   }
   // A 90-degree change of heading rotates the nose from east to south in top view.
   if(el===Math.PI/2 && pitch===0) {
    const nose=vertex(mvp,[1.6,0,0]);
    close(nose[0]/nose[3]*size/2,8*Math.cos(d-az));
    close(-nose[1]/nose[3]*size/2,8*Math.sin(d-az));
   }
  }
 }
});
function galaxyFixture() {
 const elements={};
 const element=()=>({value:'',dataset:{},handlers:{},attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(k,f){this.handlers[k]=f;},focus(){},replaceChildren(){},add(){}});
 const canvas=element();canvas.style={};canvas.setPointerCapture=()=>{};canvas.hasPointerCapture=()=>true;canvas.releasePointerCapture=()=>{};
 const ui={...element(),querySelector:s=>elements[s]||(elements[s]=element()),querySelectorAll:()=>[]};
 const calls=[];
 context.document={body:{classList:{toggle(){}}}};context.Option=function(){};
 const Galaxy=vm.runInContext('GalaxyMap',context);
 const map=new Galaxy(canvas,ui,id=>calls.push(id),()=>{});
 return {map,canvas,ui,elements,calls};
}

test('map ship rendering preserves cloaking, depth order and selection',()=>{
 const {map,elements}=galaxyFixture();
 context.window={devicePixelRatio:2};
 const ship=(i,extra={})=>({i,nm:`ship ${i}`,s:'CA',tm:'F',st:'alive',x:50000,y:50000,z:0,d:0,pitch:0,...extra});
 const you=ship(1),players=[you,ship(2,{cl:true}),ship(3,{tm:'R',cl:true}),ship(4,{st:'dead'})];
 const draws=[];
 let icons=[];
 map.shipRenderer={
  render(points,camera,rect,lights,dpr){icons=points;assert.equal(dpr,2);},
  draw(ctx,point){draws.push({kind:'ship',id:point.id,alpha:ctx.globalAlpha});},
 };
 const ctx=new Proxy({
  measureText:t=>({width:t.length*6}),
  fill(){draws.push({kind:'planet'});},
 },{get:(o,k)=>k in o?o[k]:()=>{}});
 map.view={center:{x:50000,y:50000,z:0},az:0,el:Math.PI/2,zoom:1};
 map.selection={kind:'ship',id:2};
 map.draw(ctx,you,players,[{n:7,name:'Altair',o:'F',a:30,f:3,x:50000,y:50000,z:10000}],{F:'#ff0',I:'#999'},1280,720);
 assert.deepEqual(Array.from(icons,p=>p.id),[1,2]);
 assert.deepEqual(draws,[{kind:'ship',id:1,alpha:1},{kind:'ship',id:2,alpha:0.4},{kind:'planet'}]);
 assert.equal(elements['#galaxyName'].textContent,'ship 2');
 assert.equal(elements['#galaxyLock'].disabled,true);
 const point=icons[0];
 assert.equal(context.galaxyHitTest([point],point.x+8,point.y).id,1,'nose remains clickable');
});
test('map rotation cannot issue flight commands; selection requires explicit lock',()=>{
 const {map,canvas,calls}=galaxyFixture();
 map.setOpen(true,[{n:7,name:'Altair'}]);map.planets=[{n:7,name:'Altair'}];
 map.points=[{x:100,y:100,radius:5,depth:100,kind:'planet',id:7}];
 const event=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y});
 canvas.handlers.pointerdown(event(100,100));canvas.handlers.pointermove(event(150,120));canvas.handlers.pointerup(event(150,120));
 assert.equal(map.selection,null);assert.deepEqual(calls,[]);
 canvas.handlers.pointerdown(event(100,100));canvas.handlers.pointerup(event(100,100));
 assert.equal(map.selection.id,7);assert.deepEqual(calls,[]);
 map.lockSelected();assert.deepEqual(calls,[7]);
 map.selection={kind:'ship',id:7};map.lockSelected();assert.deepEqual(calls,[7]);
 map.zoom(1000);assert.equal(map.view.zoom,4);map.zoom(0.00001);assert.equal(map.view.zoom,0.45);
 map.rotate(0,100);assert.equal(map.view.el,Math.PI/2);
});

test('galaxy auto-rotation follows elapsed time and cannot catch up after a long pause',()=>{
 const run=hz=>{
  const {map,elements}=galaxyFixture();
  map.setOpen(true,[]);elements['#galaxyAutoRotate'].onclick();
  const start=map.view.az,el=map.view.el;
  const ctx=new Proxy({measureText:t=>({width:t.length*6})},{get:(o,k)=>k in o?o[k]:()=>{}});
  const frame=now=>map.draw(ctx,observer,[],[],{F:'#ff0',I:'#999'},1280,720,[],now);
  for(let i=0;i<=hz;i++)frame(i*1000/hz);
  close(map.view.el,el);
  close(map.view.az-start,Math.PI/30); // six degrees in one second
  const before=map.view.az;
  frame(60000);assert.ok(map.view.az-before<0.03,'background pause must not jump the view');
  return before-start;
 };
 close(run(30),run(120));
});

test('galaxy auto-rotation yields to mouse input and stays off after reopening',()=>{
 const {map,canvas,ui,elements}=galaxyFixture();
 const button=elements['#galaxyAutoRotate'];
 map.setOpen(true,[]);
 const enable=()=>{
  // A real click reaches the container's pointer handler before onclick.
  ui.handlers.pointerdown({target:button});button.onclick();
  assert.equal(button.attributes['aria-pressed'],'true');
 };
 for(const stop of [
  ()=>canvas.handlers.pointerdown({button:2}),
  ()=>canvas.handlers.pointerdown({button:0,pointerId:1,clientX:100,clientY:100}),
  ()=>canvas.handlers.wheel({deltaY:10,preventDefault(){}}),
  ()=>ui.handlers.pointerdown({target:elements['#galaxyCenter']}),
  ()=>ui.handlers.wheel({target:button}),
  ()=>map.key({key:'ArrowLeft',target:{tagName:'CANVAS'},preventDefault(){}}),
  ()=>{ui.handlers.pointerdown({target:button});button.onclick();},
  ()=>{map.setOpen(false,[]);map.setOpen(true,[]);},
 ]) {
  enable();stop();
  assert.equal(map.autoRotate,false);
  assert.equal(button.attributes['aria-pressed'],'false');
 }
});

test('galaxy renderer keeps planet labels, selection details, and finite geometry',()=>{
 const nodes={},element=()=>({dataset:{},handlers:{},setAttribute(){},addEventListener(k,f){this.handlers[k]=f;},focus(){}});
 const canvas=element();canvas.style={};
 const ui={...element(),querySelector:s=>nodes[s]||(nodes[s]=element()),querySelectorAll:()=>[]};
 let closed=0;const Galaxy=vm.runInContext('GalaxyMap',context);
 const map=new Galaxy(canvas,ui,()=>{},()=>closed++);
 const text=[];
 const ctx=new Proxy({measureText:t=>({width:t.length*7}),fillText:t=>text.push(t)},{get:(o,k)=>k in o?o[k]:(...args)=>{
  for(const a of args)if(typeof a==='number')assert.ok(Number.isFinite(a));
 }});
 const pl={n:7,name:'Altair',o:'F',a:30,f:3,x:50000,y:50000,z:12000};
 map.selection={kind:'planet',id:7};
 map.draw(ctx,observer,[],[pl],{F:'#ffd54f',I:'#999'},1280,720);
 assert.ok(text.includes('Altair'),'planet labels must not collide with their own glyphs');
 assert.equal(nodes['#galaxyName'].textContent,'Altair');
 assert.ok(nodes['#galaxyDetails'].textContent.includes('ΔZ 9,000'));
 assert.equal(nodes['#galaxyLock'].disabled,false);
 map.key({key:'m',target:{tagName:'SELECT'},preventDefault(){}});assert.equal(closed,0);
 map.key({key:'Escape',target:{tagName:'BUTTON'},preventDefault(){}});assert.equal(closed,1);
 for(const [w,h]of[[320,640],[760,600],[1280,720]]) {
  const r=context.galaxyViewport(w,h);assert.ok(r.w>0&&r.h>0&&r.x+r.w<=w&&r.y+r.h<=h);
 }
});

vm.runInContext(fs.readFileSync(path.join(root,'web/steering.js'),'utf8'),context);
test('held steering has a neutral center, progressive strength, and bounded diagonals',()=>{
 const input=(x,y)=>context.steeringInput(x,y,1280,720);
 close(input(640,360).d,0);close(input(645,365).pitch,0);
 assert.ok(input(680,360).d>0);
 assert.ok(input(680,360).d<input(800,360).d);
 assert.ok(input(800,360).d<input(1000,360).d);
 assert.ok(input(640,200).pitch>0);assert.ok(input(640,520).pitch<0);
 close(input(480,360).d,-input(800,360).d);
 const corner=input(1280,0);close(Math.hypot(corner.d,corner.pitch),1);
 // Resizing keeps the same physical steering strength at equal radial offsets.
 close(context.steeringInput(240,320,320,640).d,context.steeringInput(820,360,1280,720).d);
});
test('held steering repeats while stationary, is frame-rate independent, and stops on release',()=>{
 const Steering=vm.runInContext('HoldSteering',context);
 const collect=hz=>{
  const sent=[];const helm=new Steering(m=>sent.push(m),()=>true,()=>({width:1280,height:720}));
  helm.start(7,900,360,0);
  for(let i=1;i<=hz;i++)helm.tick(i*1000/hz);
  helm.stop();helm.tick(2000);
  return sent;
 };
 const fast=collect(120),slow=collect(30);
 assert.ok(Math.abs(fast.length-slow.length)<=1);
 assert.ok(fast.length>=10 && fast.length<=12);
 assert.equal(fast.at(-1).v,0);
 assert.ok(fast.slice(0,-1).every(m=>m.t==='steer'&&m.v===1&&m.d>0));
});
test('lost right button and loss of control eligibility stop steering once',()=>{
 const Steering=vm.runInContext('HoldSteering',context),sent=[];
 let allowed=true;const helm=new Steering(m=>sent.push(m),()=>allowed,()=>({width:1000,height:800}));
 helm.start(4,800,400,0);helm.move(9,100,400,0);assert.equal(helm.active,true);
 helm.move(4,700,400,3);assert.equal(helm.active,true); // firing left while holding right
 helm.move(4,700,400,1);assert.equal(helm.active,false);assert.equal(sent.at(-1).v,0);
 const n=sent.length;helm.stop();helm.tick(1000);assert.equal(sent.length,n);
 helm.start(4,800,400,1100);allowed=false;helm.tick(1200);
 assert.equal(helm.active,false);assert.equal(sent.at(-1).v,0);
 assert.equal(helm.start(4,800,400,1300),false);
});

test('cockpit pointer capture repeats held input and releases on button-up, blur, and hidden tab',()=>{
 const events={},pointerEvents={},docEvents={},sent=[];
 let captured=null;
 const canvas={addEventListener:(k,f)=>{pointerEvents[k]=f;},setPointerCapture:id=>{captured=id;},
  hasPointerCapture:id=>captured===id,releasePointerCapture:()=>{captured=null;pointerEvents.lostpointercapture();}};
 const env=vm.createContext({send:m=>sent.push(m),joined:true,mapOn:false,curSnap:{you:{st:'alive'}},
  document:{hidden:false,activeElement:null,addEventListener:(k,f)=>{docEvents[k]=f;}},chatInput:{},
  innerWidth:1280,innerHeight:720,glCanvas:canvas,mouse:{},performance:{now:()=>0},
  addEventListener:(k,f)=>{events[k]=f;}});
 vm.runInContext(fs.readFileSync(path.join(root,'web/steering.js'),'utf8'),env);
 vm.runInContext(game.slice(game.indexOf('const helm ='),game.indexOf('addEventListener("mousemove"')),env);
 const down=()=>pointerEvents.pointerdown({button:2,pointerId:3,clientX:900,clientY:200});
 down();assert.equal(captured,3);assert.equal(sent.at(-1).v,1);
 vm.runInContext('helm.tick(100); helm.tick(200)',env);assert.equal(sent.length,3);
 events.pointerup({button:0});assert.equal(sent.at(-1).v,1);
 events.pointerup({button:2});assert.equal(captured,null);assert.equal(sent.at(-1).v,0);
 down();events.blur();assert.equal(sent.at(-1).v,0);assert.equal(captured,null);
 down();env.document.hidden=true;docEvents.visibilitychange();assert.equal(sent.at(-1).v,0);
 const n=sent.length;down();assert.equal(sent.length,n);
});

// Exercise the actual snapshot interpolation paths at the full-loop wrap.
test('cockpit and other ships interpolate pitch through the short wrap',()=>{
 const c=vm.createContext({performance:{now:()=>50},snapAt:0,
  prevSnap:{you:{st:'alive',x:0,y:0,z:0,d:0,pitch:Math.PI-0.04}},
  curSnap:{you:{st:'alive',x:0,y:0,z:0,d:0,pitch:-Math.PI+0.04}}});
 vm.runInContext(game.slice(game.indexOf('function lerp('),game.indexOf('function interpList(')),c);
 const end=game.indexOf('\n}',game.indexOf('function interpList('))+2;
 vm.runInContext(game.slice(game.indexOf('function interpList('),end),c);
 close(c.interpYou().pitch,Math.PI);
 const ships=c.interpList([{i:1,...c.curSnap.you}],[{i:1,...c.prevSnap.you}],0.5);
 close(ships[0].pitch,Math.PI);
});

test('orbit camera keeps the planet limb at 95% viewport height in any plane',()=>{
 for(const normal of [[0,0,1],[0,1,0],[0,0.6,0.8]]) {
  for(let i=0;i<128;i++) {
   const a=i*Math.PI/32;
   const radial=[Math.cos(a),normal[2]*Math.sin(a),-normal[1]*Math.sin(a)];
   const tangent=[-Math.sin(a),normal[2]*Math.cos(a),-normal[1]*Math.cos(a)];
   const planet={n:0,x:4000,y:6000,z:-3000};
   const you={orb:0,x:planet.x+800*radial[0],y:planet.y+800*radial[1],z:planet.z+800*radial[2],
    d:Math.atan2(tangent[1],tangent[0]),pitch:Math.atan2(tangent[2],Math.hypot(tangent[0],tangent[1]))};
   const frame=context.cockpitFrame(you,planet);
   const center=[-radial[0],-radial[2],-radial[1]];
   const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
   close(dot(center,frame.r),0);
   const limbAngle=Math.atan2(dot(center,frame.u),dot(center,frame.f))+Math.asin(600/800);
   close(0.5-Math.tan(limbAngle)/(2*Math.tan(65*Math.PI/360)),0.95);
   close(dot(frame.f,frame.u),0);close(Math.hypot(...frame.r),1);
   context.planets=[planet];
   const aim=context.bearingFromScreen(640,360,you);
   const ray=[Math.cos(aim.d)*Math.cos(aim.pitch),Math.sin(aim.pitch),Math.sin(aim.d)*Math.cos(aim.pitch)];
   close(dot(ray,frame.f),1);
  }
 }
 delete context.planets;
});
