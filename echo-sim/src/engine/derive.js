/* View-target derivation (reference implementation). Needs PROBE (probe.js).
   derive(views, phantom, position) → { viewId: {x,y,p,beam,lateral,notchDeg,tiltDeg,rockDeg,inICS} } */
const DERIVE = (() => {
  const P = (typeof PROBE !== "undefined") ? PROBE : require("./probe.js"), {dot,add,mul,sub,cross,norm} = P.v;
  const rad = d => d*Math.PI/180;
  function rotY(v, a, pivot){const c=Math.cos(a),s=Math.sin(a),q=sub(v,pivot);return add(pivot,[c*q[0]+s*q[2],q[1],-s*q[0]+c*q[2]])}
  /* Heart landmark → patient coords, including the supine/LLD heart offset. */
  function heartToPatient(ph, position){
    const h=ph.frames.heart, pos=ph.positions[position||"supine"], O=h.origin_patient;
    const off=pos.heartOffset_patient||[0,0,0], ang=rad(pos.heartRotateYDeg||0);
    return hp => {let p=add(O,add(mul(h.X_patient,hp[0]),add(mul(h.Y_patient,hp[1]),mul(h.Z_patient,hp[2]))));
      if(ang) p=rotY(p, ang, O);   /* pivot = MV_center = heart origin; + swings apex toward +x */
      return add(p, off)};
  }
  function heartDir(ph, position){const h=ph.frames.heart,a=rad(ph.positions[position||"supine"].heartRotateYDeg||0);
    return d=>{const v=add(mul(h.X_patient,d[0]),add(mul(h.Y_patient,d[1]),mul(h.Z_patient,d[2])));return a?rotY(v,a,[0,0,0]):v}}
  /* Rib model from phantom-normal.json: rib n centre y = -0.875 - 2.25n - 0.25*max(0,|x|-3), width 1.3 */
  const CM=[[0,-20.5],[1.5,-20.5],[6,-22],[10,-25],[13,-26],[16,-26]];   // costal margin (|x|, y)
  function costalY(ax){for(let i=1;i<CM.length;i++)if(ax<=CM[i][0]){const[a,b]=[CM[i-1],CM[i]],t=(ax-a[0])/(b[0]-a[0]);return a[1]+t*(b[1]-a[1])}return CM[CM.length-1][1]}
  let RIB={half:.5,depth:1.0,thick:.8};
  function ribGap(x,y){if(y<costalY(Math.abs(x)))return 9;                // below the costal margin: no ribs
    const sl=.25*Math.max(0,Math.abs(x)-3);let best=9;for(let n=1;n<=10;n++)best=Math.min(best,Math.abs(y-(-0.875-2.25*n-sl)));return best-RIB.half} // >0 → in an ICS
  /* Fraction of the first 3 cm of a beam that runs through rib (the shadow a sonographer slides away from). */
  function ribPath(p,b){let hit=0,n=0;for(let s=0;s<=3;s+=.1){const q=add(p,mul(b,s)),d=P.skinPoint(q[0],q[1])[2]-q[2];n++;
    if(Math.abs(d-RIB.depth)<RIB.thick/2&&ribGap(q[0],q[1])<=0)hit++}return hit/n}
  function icsCentre(x,y){const sl=.25*Math.max(0,Math.abs(x)-3),n=Math.round((-2.0-sl-y)/2.25);return -2.0-2.25*n-sl}
  function resolve(ph, toP, name){
    const m=/^midpoint\(([^,]+),\s*([^)]+)\)$/.exec(name);
    if(m) return mul(add(resolve(ph,toP,m[1].trim()),resolve(ph,toP,m[2].trim())),.5);
    const L=ph.landmarks_heart; if(L[name]) return toP(L[name]);
    const ip=/^IVC\.points\[(\d)\]$/.exec(name); if(ip) return ph.extracardiac_patient.IVC.points[+ip[1]];
    throw new Error("unknown landmark "+name);
  }
  function finish(x,y,beam,side){const p=P.skinPoint(x,y);let lat=norm(cross(cross(beam,side),beam));/* side projected ⟂ beam */
    const a=P.anglesFrom(x,y,beam,lat);return{x,y,p,beam,lateral:lat,...a,inICS:ribGap(x,y)>0,ribPath:ribPath(p,beam)}}
  /* Points where the target plane crosses the skin inside the window. Choose the one a sonographer would:
     in an intercostal space, beam as close to straight-in as possible, then nearest the seed. */
  function onPlaneBest(n,A,aim,win,seed,perpAx){
    let best=null;for(let x=win.xRange[0];x<=win.xRange[1];x+=.05)for(let y=win.yRange[1];y<=win.yRange[0];y+=.05){
      const p=P.skinPoint(x,y),f=Math.abs(dot(n,sub(p,A)));if(f>.06)continue;
      let b=sub(aim,p);b=norm(sub(b,mul(n,dot(b,n))));
      if(perpAx){ /* beam ⟂ axis inside the plane (e.g. PLAX: LV–aorta horizontal); the aim only has to be inside the fan */
        let bp=norm(cross(n,perpAx)); if(dot(bp,b)<0) bp=mul(bp,-1);
        if(Math.acos(Math.max(-1,Math.min(1,dot(bp,b))))*180/Math.PI>30) continue; b=bp; }
      const ang=Math.acos(Math.max(-1,Math.min(1,-dot(b,P.outwardNormal(p)))))*180/Math.PI;
      const cost=ang+2*Math.hypot(x-seed[0],y-seed[1])+(ribGap(x,y)<=0?40:0)+200*ribPath(p,b);
      if(!best||cost<best.cost)best={x,y,cost,b}}
    return best}
  function derive(VJ, ph, position){
    P.setTorso(ph.extracardiac_patient.torso);
    const R=ph.extracardiac_patient.ribs;RIB={half:R.craniocaudalWidth/2,depth:1.0,thick:R.thickness};
    const toP=heartToPatient(ph,position), dir=heartDir(ph,position), out={};
    for(const v of VJ.views){
      const d=v.derivation, W=VJ.windows[v.window];
      const seed=(v.seedPose.skinPoint_patient)||W.seed||W.seed_supine;
      const side=()=>resolve(ph,toP,d.notchSideLandmark);
      if(d.method==="plane3"){
        const [A,B,C]=d.through.map(n=>resolve(ph,toP,n)), n=norm(cross(sub(B,A),sub(C,A))), aim=resolve(ph,toP,d.aimAt);
        const s=onPlaneBest(n,A,aim,W,seed,d.beamPerpTo?norm(dir(ph.axes_heart[d.beamPerpTo])):null); if(!s){out[v.id]={error:"plane misses window"};continue}
        const p=P.skinPoint(s.x,s.y);const b=s.b;
        out[v.id]=finish(s.x,s.y,b,sub(side(),p));
      } else if(d.method==="fanFromWindow"){
        const sd=W[d.probeAt]||seed, x=sd[0], y=icsCentre(sd[0],sd[1]), p=P.skinPoint(x,y);
        const C=resolve(ph,toP,d.levelCenter), b=norm(sub(C,p));
        const ax=norm(dir(ph.axes_heart[d.axisRef]));let u=norm(cross(ax,b));if(dot(sub(side(),p),u)<0)u=mul(u,-1);
        out[v.id]=finish(x,y,b,u);
      } else if(d.method==="tiltFrom"){
        const base=out[d.base]; if(!base||base.error){out[v.id]={error:"base missing"};continue}
        /* Rotate the base image plane about its lateral axis u (pivot at the probe) by the SMALLEST angle φ
           that puts the landmark in-plane: n(φ)=n0·cosφ + (u×n0)·sinφ, q·n(φ)=0 → tanφ = −(q·n0)/(q·(u×n0)). */
        const u=base.lateral, n0=norm(cross(u,base.beam)), m=cross(u,n0), q=sub(resolve(ph,toP,d.throughLandmark),base.p);
        const phi=Math.atan(-dot(q,n0)/dot(q,m));                         // atan, not atan2: |φ| < 90°
        const b=norm(add(mul(base.beam,Math.cos(phi)),mul(cross(u,base.beam),Math.sin(phi))));
        out[v.id]={...finish(base.x,base.y,b,u),tiltFromBaseDeg:phi*180/Math.PI};
      } else if(d.method==="planeThroughSkin"){
        const S=P.skinPoint(seed[0],seed[1]), pts=d.through.map(n=>resolve(ph,toP,n)), aim=resolve(ph,toP,d.aimAt);
        let n;
        if(pts.length>=2) n=norm(cross(sub(pts[0],S),sub(pts[1],S)));
        else {/* 1 landmark + lateralHint: plane through skin seed and landmark that contains the lateral
                 direction closest to the hint — i.e. how it is scanned (e.g. notch to patient's left, probe flat). */
              const dd=norm(sub(pts[0],S)),h=d.lateralHint;let lat=norm(sub(h,mul(dd,dot(h,dd))));n=norm(cross(lat,dd))}
        let b=sub(aim,S);b=norm(sub(b,mul(n,dot(b,n))));let u=norm(cross(n,b));if(dot(sub(side(),S),u)<0)u=mul(u,-1);
        out[v.id]=finish(seed[0],seed[1],b,u);
      }
    }
    return out;
  }
  return{derive,heartToPatient,ribGap,ribPath,icsCentre};
})();
if(typeof module!=="undefined")module.exports=DERIVE;
