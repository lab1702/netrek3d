// Interactive perspective galaxy map. Game coordinates stay X/Y/Z throughout.
"use strict";

function galaxyViewport(width, height) {
  const narrow = width < 760;
  return { x: 16, y: narrow ? 156 : 105,
    w: Math.max(1, width - (narrow ? 32 : 310)),
    h: Math.max(1, height - (narrow ? 375 : 145)) };
}
function galaxyProjection(p, view, rect) {
  const dx = p.x - view.center.x, dy = p.y - view.center.y, dz = p.z - view.center.z;
  const right = Math.cos(view.az) * dx + Math.sin(view.az) * dy;
  const along = -Math.sin(view.az) * dx + Math.cos(view.az) * dy;
  const up = -along * Math.sin(view.el) + dz * Math.cos(view.el);
  const depth = along * Math.cos(view.el) + dz * Math.sin(view.el);
  const distance = 220000 / view.zoom - depth;
  if (distance <= 2000) return null;
  const scale = Math.min(rect.w, rect.h) * 1.25 / distance;
  return { x: rect.x + rect.w / 2 + right * scale,
    y: rect.y + rect.h / 2 - up * scale, depth: distance, scale };
}
function galaxyHitTest(points, x, y) {
  // Choose the frontmost visible glyph when several overlap.
  return points.filter(p => Math.hypot(p.x - x, p.y - y) <= p.radius + 7)
    .sort((a, b) => a.depth - b.depth)[0] || null;
}
function galaxyVisibleShips(you, players) {
  return players.filter(p => p.st === "alive" && (!p.cl || p.tm === you.tm));
}

class GalaxyMap {
  constructor(canvas, ui, onLock, onClose) {
    this.canvas = canvas; this.ui = ui; this.onLock = onLock; this.onClose = onClose;
    this.view = { center: {x:50000,y:50000,z:0}, az:-0.55, el:0.55, zoom:1 };
    this.selection = null; this.hover = null; this.points = []; this.active = false;
    this.grid = true; this.stems = false; this.follow = false; this.drag = null;
    this.autoRotate = false; this.autoRotateTime = null;
    this.autoRotateButton = ui.querySelector('#galaxyAutoRotate');
    this.autoRotateButton.onclick = () => this.setAutoRotate(!this.autoRotate);
    // Let the toggle handle its own click; every other mouse interaction stops it.
    const stopRotation = e => {
      if (e.target !== this.autoRotateButton) this.setAutoRotate(false);
    };
    ui.addEventListener('pointerdown', stopRotation);
    ui.addEventListener('wheel', () => this.setAutoRotate(false), {passive:true});
    this.select = ui.querySelector('#galaxySelect');
    this.title = ui.querySelector('#galaxyName'); this.details = ui.querySelector('#galaxyDetails');
    this.lock = ui.querySelector('#galaxyLock'); this.lastDetails = '';
    ui.querySelectorAll('[data-map-view]').forEach(button => button.addEventListener('click', () => {
      this.setAutoRotate(false);
      const preset = button.dataset.mapView;
      this.view.az = preset === '3d' ? -0.55 : 0;
      this.view.el = preset === 'top' ? Math.PI/2 : preset === 'side' ? 0 : 0.55;
    }));
    ui.querySelector('#galaxyReset').onclick = () => this.reset();
    ui.querySelector('#galaxyCenter').onclick = () => { this.follow = true; };
    ui.querySelector('#galaxyClose').onclick = onClose;
    ui.querySelector('#galaxyZoomIn').onclick = () => this.zoom(1.25);
    ui.querySelector('#galaxyZoomOut').onclick = () => this.zoom(0.8);
    ui.querySelector('#galaxyGrid').onchange = e => { this.grid = e.target.checked; };
    ui.querySelector('#galaxyStems').onchange = e => { this.stems = e.target.checked; };
    this.select.onchange = () => { this.selection = this.select.value === '' ? null : {kind:'planet',id:Number(this.select.value)}; };
    this.lock.onclick = () => this.lockSelected();
    canvas.addEventListener('pointerdown', e => {
      if (!this.active) return;
      this.setAutoRotate(false);
      if (e.button !== 0 || this.drag) return;
      this.drag = {id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', e => {
      if (!this.active) return;
      if (this.drag && this.drag.id === e.pointerId) {
        const d = this.drag;
        if (Math.hypot(e.clientX-d.startX,e.clientY-d.startY)>5) d.moved = true;
        if (d.moved) this.rotate((e.clientX-d.x)*0.008,(e.clientY-d.y)*0.008);
        d.x=e.clientX; d.y=e.clientY;
      } else this.hover = galaxyHitTest(this.points,e.clientX,e.clientY);
      canvas.style.cursor = this.drag?.moved ? 'grabbing' : this.hover ? 'pointer' : 'grab';
    });
    canvas.addEventListener('pointerup', e => {
      if (!this.drag || this.drag.id !== e.pointerId) return;
      if (!this.drag.moved) {
        const hit = galaxyHitTest(this.points,e.clientX,e.clientY);
        this.selection = hit ? {kind:hit.kind,id:hit.id} : null;
        this.select.value = this.selection?.kind === 'planet' ? String(this.selection.id) : '';
      }
      this.drag = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    });
    canvas.addEventListener('pointercancel', () => { this.drag = null; });
    canvas.addEventListener('lostpointercapture', () => { this.drag = null; });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
    canvas.addEventListener('wheel', e => {
      if (!this.active) return;
      e.preventDefault(); this.zoom(Math.exp(-Math.max(-200,Math.min(200,e.deltaY))*0.002));
    }, {passive:false});
  }
  reset() {
    this.setAutoRotate(false);
    this.follow=false; this.view={center:{x:50000,y:50000,z:0},az:-0.55,el:0.55,zoom:1};
  }
  rotate(az, el) {
    this.setAutoRotate(false);
    this.view.az += az;
    this.view.el = Math.max(-Math.PI/2,Math.min(Math.PI/2,this.view.el+el));
  }
  zoom(factor) {
    this.setAutoRotate(false);
    this.view.zoom=Math.max(0.45,Math.min(4,this.view.zoom*factor));
  }
  setAutoRotate(enabled) {
    this.autoRotate=enabled && this.active; this.autoRotateTime=null;
    this.autoRotateButton.setAttribute('aria-pressed',String(this.autoRotate));
  }
  setOpen(open, planets) {
    this.setAutoRotate(false);
    this.active=open; this.canvas.style.display=open?'block':'none'; this.ui.hidden=!open;
    document.body.classList.toggle('map-open',open);
    this.drag=null; this.hover=null;
    if (open) {
      this.select.replaceChildren(new Option('Select a planet…',''));
      for (const p of planets) this.select.add(new Option(p.name,String(p.n)));
      this.select.value=this.selection?.kind==='planet'?String(this.selection.id):'';
      this.ui.querySelector('#galaxyClose').focus({preventScroll:true});
    }
  }
  lockSelected() {
    if (this.active && this.selection?.kind==='planet' && this.planets?.some(p=>p.n===this.selection.id)) this.onLock(this.selection.id);
  }
  key(e) {
    if (e.key==='Escape') { e.preventDefault();this.onClose();return; }
    if (['INPUT','SELECT'].includes(e.target.tagName)) return;
    if (e.key==='m') { e.preventDefault();this.onClose();return; }
    if (e.key==='l') this.lockSelected();
    if (e.key==='+' || e.key==='=') this.zoom(1.15);
    if (e.key==='-') this.zoom(1/1.15);
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      this.rotate(e.key==='ArrowLeft'?-0.1:e.key==='ArrowRight'?0.1:0,e.key==='ArrowUp'?-0.1:e.key==='ArrowDown'?0.1:0);
    }
  }
  draw(ctx, you, players, planets, colors, width, height, booms = [], now) {
    if (this.active && this.autoRotate && Number.isFinite(now)) {
      // Twelve degrees per second, driven by the existing frame loop. Cap gaps
      // so returning from a background tab cannot jump the camera forward.
      if (this.autoRotateTime !== null) {
        this.view.az += Math.max(0,Math.min(100,now-this.autoRotateTime))*Math.PI/15000;
      }
      this.autoRotateTime=now;
    }
    this.planets=planets;
    const rect=galaxyViewport(width,height);
    if(this.follow) this.view.center={x:you.x,y:you.y,z:you.z};
    const project=p=>galaxyProjection(p,this.view,rect);
    const ships=galaxyVisibleShips(you,players);
    const entries=planets.map(p=>({kind:'planet',id:p.n,object:p,team:p.o}));
    for(const p of ships) entries.push({kind:'ship',id:p.i,object:p,team:p.tm});
    const selected=entries.find(p=>p.kind===this.selection?.kind && p.id===this.selection?.id);
    ctx.save();ctx.fillStyle='#080b0e';ctx.fillRect(0,0,width,height);
    ctx.beginPath();ctx.rect(rect.x,rect.y,rect.w,rect.h);ctx.clip();
    const line=(a,b,color,dash=[])=>{
      const pa=project(a),pb=project(b);if(!pa || !pb)return;
      ctx.strokeStyle=color;ctx.setLineDash(dash);ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();ctx.setLineDash([]);
    };
    ctx.lineWidth=1;
    if(this.grid) {
      for(let v=0;v<=100000;v+=25000) {
        line({x:v,y:0,z:0},{x:v,y:100000,z:0},'#22343d');
        line({x:0,y:v,z:0},{x:100000,y:v,z:0},'#22343d');
      }
      for(const x of [0,100000])for(const y of [0,100000]) {
        line({x,y,z:-50000},{x,y,z:50000},'#18252d');
        for(const z of [-50000,50000]) {
          line({x,y:0,z},{x,y:100000,z},'#18252d');
          line({x:0,y,z},{x:100000,y,z},'#18252d');
        }
      }
    }
    if(this.stems)for(const p of planets)line({...p,z:0},p,'#41525a',p.z<0?[3,4]:[]);
    if(selected)line(you,selected.object,'#dce7ed',[5,4]);
    const points=entries.map(c=>{
      const p=project(c.object);return p?{...c,...p,radius:c.kind==='planet'?Math.max(4,Math.min(9,1200*p.scale)):4}:null;
    }).filter(p=>p && p.x>=rect.x+10 && p.x<=rect.x+rect.w-10 && p.y>=rect.y+10 && p.y<=rect.y+rect.h-10)
      .sort((a,b)=>b.depth-a.depth);
    this.points=points;
    for(const p of points) {
      ctx.globalAlpha=p.object.cl?0.4:1;ctx.fillStyle=colors[p.team]||colors.I;
      ctx.strokeStyle=ctx.fillStyle;ctx.lineWidth=1.5;ctx.beginPath();
      if(p.kind==='planet') {ctx.arc(p.x,p.y,p.radius,0,Math.PI*2);ctx.fill();}
      else {ctx.moveTo(p.x,p.y-5);ctx.lineTo(p.x+4,p.y);ctx.lineTo(p.x,p.y+5);ctx.lineTo(p.x-4,p.y);ctx.closePath();ctx.fill();}
      const chosen=p.kind===this.selection?.kind && p.id===this.selection?.id;
      if(chosen || (p.kind==='planet' && p.id===you.lk) || (p.kind==='ship' && p.id===you.i)) {
        ctx.strokeStyle=chosen?'#eceff1':p.kind==='ship'?'#eceff1':'#ffb74d';
        ctx.beginPath();ctx.arc(p.x,p.y,p.radius+5,0,Math.PI*2);ctx.stroke();
      }
    }
    // Ship blasts (scale 0.75–2; torpedoes are 0.35) get a brief map-sized burst.
    // Project the actual blast position each frame so it stays anchored while rotating.
    for(const b of booms) {
      const age=(now-b.at)/700;
      if(b.s<0.75 || age<0 || age>=1)continue;
      const p=project(b);if(!p)continue;
      const radius=4+age*10;
      const color=colors[b.tm]||colors.I;
      ctx.globalAlpha=1-age;ctx.strokeStyle=color;ctx.lineWidth=1.5;
      ctx.beginPath();ctx.arc(p.x,p.y,radius,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();
      for(let i=0;i<8;i++) {
        const angle=i*Math.PI/4,dx=Math.cos(angle),dy=Math.sin(angle);
        ctx.moveTo(p.x+dx*(radius+2),p.y+dy*(radius+2));
        ctx.lineTo(p.x+dx*(radius+5),p.y+dy*(radius+5));
      }
      ctx.stroke();
      ctx.globalAlpha=(1-age)*(1-age);ctx.fillStyle=color;
      ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();
    }
    // Label priority protects the selected target and your ship from crowded fields.
    ctx.globalAlpha=1;ctx.font='12px Consolas, monospace';ctx.textAlign='left';ctx.textBaseline='top';
    const occupied=points.map(p=>({x:p.x-8,y:p.y-8,w:16,h:16}));
    const priority=p=>(p.kind===this.selection?.kind&&p.id===this.selection?.id)?4:
      (p.kind===this.hover?.kind&&p.id===this.hover?.id)?3:(p.kind==='ship'&&p.id===you.i)?2:p.kind==='planet'?1:0;
    for(const p of [...points].sort((a,b)=>priority(b)-priority(a)||a.depth-b.depth)) {
      if(priority(p)===0)continue;
      const label=p.kind==='planet'?p.object.name:p.id===you.i?'YOU':p.object.nm;
      const w=ctx.measureText(label).width;let box=null;
      for(const y of [p.y+14,p.y-28])for(const x of [p.x+14,p.x-w-14]) {
        const b={x,y,w,h:14};
        if(x<rect.x || x+w>rect.x+rect.w || y<rect.y || y+14>rect.y+rect.h)continue;
        if(occupied.some(o=>x<o.x+o.w+3&&x+w+3>o.x&&y<o.y+o.h+3&&y+17>o.y))continue;
        if(!box)box=b;
      }
      if(box){occupied.push(box);ctx.fillStyle=colors[p.team]||colors.I;ctx.fillText(label,box.x,box.y);}
    }
    // Axis labels remain tied to the galaxy, not the orbiting camera.
    ctx.fillStyle='#80949f';
    for(const [text,p] of [['X',{x:105000,y:0,z:0}],['Y',{x:0,y:105000,z:0}],['+Z',{x:0,y:0,z:55000}]]) {
      const s=project(p);if(s)ctx.fillText(text,s.x,s.y);
    }
    ctx.restore();
    this.updateDetails(selected,you);
    this.ui.querySelector('#galaxyScale').textContent=`${this.view.zoom.toFixed(1)}× · ${this.follow?'Following your ship':'Galaxy centered'}`;
  }
  updateDetails(selected,you) {
    let title='Explore the galaxy',details='Select a planet or ship to inspect its position and distance.';
    if(selected) {
      const p=selected.object,dist=Math.hypot(p.x-you.x,p.y-you.y,p.z-you.z);
      title=selected.kind==='planet'?p.name:p.i===you.i?'Your ship':p.nm;
      const resources=selected.kind==='planet'?[p.f&1?'Repair':'',p.f&2?'Fuel':'',p.f&4?'Agri':''].filter(Boolean).join(' · '):p.s;
      details=`${selected.team} · ${selected.kind==='planet'?`${p.a} armies`:resources}\n`+
        (selected.kind==='planet'?`${resources||'No facilities'}\n`:'')+
        `Distance ${Math.round(dist).toLocaleString()}\nΔZ ${Math.round(p.z-you.z).toLocaleString()}\n`+
        `X ${Math.round(p.x).toLocaleString()} · Y ${Math.round(p.y).toLocaleString()} · Z ${Math.round(p.z).toLocaleString()}`;
    } else if(this.selection) {title='Contact unavailable';details='This contact is no longer visible.';}
    const text=title+'\n'+details;
    if(text!==this.lastDetails){this.title.textContent=title;this.details.textContent=details;this.lastDetails=text;}
    this.lock.disabled=!selected || selected.kind!=='planet';
    this.lock.textContent=selected?.kind==='planet'&&selected.id===you.lk?'Planet locked':'Lock planet';
  }
}
