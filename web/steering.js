// Relative cockpit steering. The server integrates this request at its tick rate.
"use strict";
function steeringInput(x, y, width, height) {
  const radius = Math.max(1, Math.min(width, height) / 2);
  const dx = (x - width / 2) / radius, dy = (height / 2 - y) / radius;
  const distance = Math.hypot(dx, dy), deadZone = 0.035;
  if (distance <= deadZone) return {d:0, pitch:0};
  const strength = Math.pow((Math.min(1, distance) - deadZone) / (1 - deadZone), 1.7);
  return {d:dx / distance * strength, pitch:dy / distance * strength};
}

class HoldSteering {
  constructor(emit, isAllowed, viewport) {
    this.emit=emit; this.isAllowed=isAllowed; this.viewport=viewport;
    this.active=false; this.pointer=null; this.lastSent=-Infinity; this.x=0;this.y=0;
  }
  start(pointer,x,y,now) {
    if (!this.isAllowed()) return false;
    this.active=true;this.pointer=pointer;this.x=x;this.y=y;this.lastSent=-Infinity;
    this.tick(now);return true;
  }
  move(pointer,x,y,buttons) {
    if(!this.active || pointer!==this.pointer)return;
    if(!(buttons&2)){this.stop();return;}
    this.x=x;this.y=y;
  }
  tick(now) {
    if(!this.active)return;
    if(!this.isAllowed()){this.stop();return;}
    if(now-this.lastSent<100)return;
    const {width,height}=this.viewport();
    this.emit({t:'steer',v:1,...steeringInput(this.x,this.y,width,height)});
    this.lastSent=now;
  }
  stop() {
    if(!this.active)return;
    this.active=false;this.pointer=null;
    this.emit({t:'steer',v:0});
  }
}
