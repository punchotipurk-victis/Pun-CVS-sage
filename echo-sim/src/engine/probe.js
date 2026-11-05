/* Probe pose math (reference implementation, patient frame, cm).
   Torso = elliptic cylinder: z = cz + hd*sqrt(1-(x/hw)^2). Pose is stored in BODY coordinates,
   so rolling the body for LLD never changes the pose. */
const PROBE = (() => {
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2], add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
        mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s], sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
        cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
        norm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]}, rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
  let T={hw:16,hd:11,cz:-11};
  function setTorso(t){T={hw:t.halfWidthX,hd:t.halfDepthZ,cz:t.center_xz[1]}}
  function skinPoint(x,y){const xx=Math.max(-T.hw+.01,Math.min(T.hw-.01,x));return[xx,y,T.cz+T.hd*Math.sqrt(1-(xx/T.hw)**2)]}
  function outwardNormal(p){return norm([p[0]/(T.hw*T.hw),0,(p[2]-T.cz)/(T.hd*T.hd)])}
  /* Tangent basis at a skin point: H = toward head, Lt = toward patient's left. */
  function basis(p){const N=outwardNormal(p),H=norm(sub([0,1,0],mul(N,N[1]))),Lt=norm(cross(H,N));return{N,H,Lt}}
  /* Elevation axis: perpendicular to the image plane, sign chosen toward the head (toward patient's left if notch is cranio-caudal). */
  function elevation(u0,b0,H,Lt){let e=norm(cross(u0,b0));const h=dot(e,H);if(Math.abs(h)<1e-3){if(dot(e,Lt)<0)e=mul(e,-1)}else if(h<0)e=mul(e,-1);return e}
  /* pose {x,y,notchDeg,tiltDeg,rockDeg} → {p, beam, lateral, elev, normal} */
  function frame(pose){
    const p=skinPoint(pose.x,pose.y),{N,H,Lt}=basis(p),a=rad(pose.notchDeg);
    const u0=norm(add(mul(H,Math.cos(a)),mul(Lt,Math.sin(a)))),b0=mul(N,-1),e=elevation(u0,b0,H,Lt);
    const t=rad(pose.tiltDeg||0),r=rad(pose.rockDeg||0);
    const b1=norm(add(mul(b0,Math.cos(t)),mul(e,Math.sin(t))));          // tilt: out of plane, + toward head side
    const b2=norm(add(mul(b1,Math.cos(r)),mul(u0,Math.sin(r))));         // rock: in plane, + toward notch
    const lat=norm(sub(u0,mul(b2,dot(u0,b2))));
    return{p,beam:b2,lateral:lat,elev:norm(cross(lat,b2)),normal:N}}
  /* Inverse: given skin point, desired beam and lateral (notch-side) direction → UI angles */
  function anglesFrom(x,y,beam,lateral){
    const p=skinPoint(x,y),{N,H,Lt}=basis(p);
    /* The notch axis u0 lies in BOTH the image plane and the skin tangent plane (tilt and rock never
       move it out of either), so u0 = image-plane ∩ tangent-plane, signed toward the lateral side. */
    const nImg=norm(cross(lateral,beam));let u=norm(cross(N,nImg));if(dot(u,lateral)<0)u=mul(u,-1);
    const notchDeg=deg(Math.atan2(dot(u,Lt),dot(u,H)));
    const u0=norm(add(mul(H,Math.cos(rad(notchDeg))),mul(Lt,Math.sin(rad(notchDeg))))),b0=mul(N,-1),e=elevation(u0,b0,H,Lt);
    const rockDeg=deg(Math.asin(Math.max(-1,Math.min(1,dot(beam,u0)))));
    const bp=norm(sub(beam,mul(u0,dot(beam,u0))));                       // beam with in-plane part removed
    const tiltDeg=deg(Math.atan2(dot(bp,e),dot(bp,b0)));
    return{notchDeg,tiltDeg,rockDeg}}
  /* Pointer ray (BODY frame: transform the camera ray by the inverse of the patient group's matrix first) → skin (x,y) or null.
     Ray vs elliptic cylinder (x/hw)² + ((z-cz)/hd)² = 1, first hit on the anterior half. */
  function rayToSkin(o, d){
    const a = (d[0]/T.hw)**2 + (d[2]/T.hd)**2, b = 2*(o[0]*d[0]/(T.hw*T.hw) + (o[2]-T.cz)*d[2]/(T.hd*T.hd)),
          c = (o[0]/T.hw)**2 + ((o[2]-T.cz)/T.hd)**2 - 1, disc = b*b - 4*a*c;
    if (a < 1e-9 || disc < 0) return null;
    for (const t of [(-b - Math.sqrt(disc))/(2*a), (-b + Math.sqrt(disc))/(2*a)]) {
      if (t <= 0) continue; const q = [o[0]+d[0]*t, o[1]+d[1]*t, o[2]+d[2]*t];
      if (q[2] >= T.cz) return { x: q[0], y: q[1] };
    }
    return null;
  }
  /* Clock text for the readout: 0° = 12 o'clock, +90° = 3 o'clock */
  function clock(notchDeg){let h=((notchDeg/30)%12+12)%12;const H=Math.floor(h)||12,m=Math.round((h-Math.floor(h))*60/30)*30;return m===60?`${(H%12)+1}:00`:`${H}:${m?"30":"00"}`}
  return{setTorso,skinPoint,outwardNormal,basis,frame,anglesFrom,rayToSkin,clock,v:{dot,add,mul,sub,cross,norm}}
})();
if(typeof module!=="undefined")module.exports=PROBE;
