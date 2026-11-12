/* ===== THREE.JS SCENE around H3 ===== */
function HeartScene(host,hooks){
  const T=window.THREE;let renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:"high-performance"})}catch(e){return null}
  if(!renderer.getContext())return null;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  host.appendChild(renderer.domElement);renderer.domElement.style.touchAction="pan-y";renderer.domElement.style.display="block";
  const scene=new T.Scene(),cam=new T.PerspectiveCamera(32,1,.1,50);cam.position.set(0,0,6.2);
  scene.add(new T.HemisphereLight(0xfff4ee,0x4a3a48,.95));
  const d1=new T.DirectionalLight(0xffffff,1.25);d1.position.set(2.5,3.5,5);scene.add(d1);
  const d2=new T.DirectionalLight(0xffe0d8,.35);d2.position.set(-4,-2,3);scene.add(d2);
  const root=new T.Group();root.position.set(.02,-.34,0);scene.add(root);
  const uni={uBeat:{value:0},uPulse:{value:0},uInfCol:{value:new T.Color(0xf2b632)},uB:{value:new T.Vector3(...H3.LV_B)},uA:{value:new T.Vector3(...H3.AX)}};
  const patch=m=>{m.onBeforeCompile=s=>{Object.assign(s.uniforms,uni);
    s.vertexShader=s.vertexShader.replace("#include <common>","#include <common>\nattribute float aMot;attribute float aInf;varying float vInf;uniform float uBeat;uniform vec3 uB;uniform vec3 uA;")
      .replace("#include <begin_vertex>",`#include <begin_vertex>
        vInf=aInf;{vec3 v=transformed-uB;float ax=dot(v,uA);vec3 rad=v-uA*ax;float m=uBeat*aMot;transformed-=rad*m*.075+uA*ax*m*.035;}`);
    s.fragmentShader=s.fragmentShader.replace("#include <common>","#include <common>\nvarying float vInf;uniform float uPulse;uniform vec3 uInfCol;")
      .replace("#include <color_fragment>",`#include <color_fragment>
        diffuseColor.rgb=mix(diffuseColor.rgb,uInfCol*(.82+.18*uPulse),clamp(vInf,0.,1.)*.92);`)};return m};
  const myoMat=patch(new T.MeshStandardMaterial({vertexColors:true,roughness:.58,metalness:.02,side:T.FrontSide}));
  const REG_I={ANTSEP:1,ANT:2,APEX:3,HILAT:4,LAT:5,INF:6,POST:7,RV:8};
  const cache={};let cur=null,curKey="";
  function buildHeart(o){const key=JSON.stringify(o);if(cache[key])return cache[key];if(NEO&&NEO.plain(o))return cache[key]=NEO.mesh(T,myoMat);/*NEO-HOOK*/
    const m=H3.mesh(p=>H3.field(p,o),.036),g=new T.BufferGeometry();
    const n=m.pos.length/3,col=new Float32Array(n*3),reg=new Uint8Array(n),mot=new Float32Array(n);
    for(let i=0;i<n;i++){const p=[m.pos[i*3],m.pos[i*3+1],m.pos[i*3+2]],c=H3.baseColor(p,!!o.cut,o);col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2];
      const isV=p[1]<.6&&Math.min(H3.rc(p,H3.LV_B,H3.LV_A,.7,.31),H3.rc(p,H3.RV_B,H3.RV_A,.6,.25))<.03;
      reg[i]=isV?REG_I[H3.region(p)]:0;mot[i]=isV?1:.18}
    g.setAttribute("position",new T.BufferAttribute(m.pos,3));g.setIndex(new T.BufferAttribute(m.idx,1));g.setAttribute("color",new T.BufferAttribute(col,3));
    g.setAttribute("aMot",new T.BufferAttribute(mot,1));g.setAttribute("aInf",new T.BufferAttribute(new Float32Array(n),1));g.computeVertexNormals();g.computeBoundingSphere();
    const adj=new Array(n);for(let i=0;i<m.idx.length;i+=3){const a=m.idx[i],b=m.idx[i+1],c=m.idx[i+2];(adj[a]=adj[a]||[]).push(b,c);(adj[b]=adj[b]||[]).push(a,c);(adj[c]=adj[c]||[]).push(a,b)}
    const obj=new T.Mesh(g,myoMat);obj.userData={reg,adj,mot:mot.slice()};return cache[key]=obj}
  function showHeart(o){const key=JSON.stringify(o);clipOn.length=0;if(o.cut)clipOn.push(clipPlane);valve.visible=!!o.cut;if(curKey===key&&cur)return cur;if(cur)root.remove(cur);cur=buildHeart(o);if(NV)NV.use(!!cur.userData.neo);/*NEO-HOOK*/root.add(cur);curKey=key;paint();return cur}
  /* Vessels */
  renderer.localClippingEnabled=true;const clipPlane=new T.Plane(new T.Vector3(),0),clipOn=[];const clipBase=new T.Plane(new T.Vector3(-H3.CUTN[0],-H3.CUTN[1],-H3.CUTN[2]),H3.CUTD);const vesselMat=(c)=>patch(new T.MeshStandardMaterial({color:c,roughness:.38,metalness:.05,clipShadows:false,clippingPlanes:clipOn}));
  const vessels={};
  for(const k in H3.VESSELS){const v=H3.VESSELS[k],curve=new T.CatmullRomCurve3(v.pts.map(p=>new T.Vector3(...p)),false,"centripetal"),g=new T.TubeGeometry(curve,Math.max(24,v.pts.length*3),v.r,9,false);
    const n=g.attributes.position.count;g.setAttribute("aMot",new T.BufferAttribute(new Float32Array(n).fill(1),1));g.setAttribute("aInf",new T.BufferAttribute(new Float32Array(n),1));
    const m=new T.Mesh(g,vesselMat(0xe2554a));m.userData={vessel:k,curve};root.add(m);vessels[k]=m}
  const NV=NEO?NEO.attach(T,root,vessels,vesselMat,patch):null;/*NEO-HOOK*/
  const clot=new T.Mesh(new T.SphereGeometry(.062,16,12),new T.MeshStandardMaterial({color:0x1c0a10,roughness:.9}));clot.visible=false;root.add(clot);
  const clotRing=new T.Mesh(new T.TorusGeometry(.1,.012,8,28),new T.MeshBasicMaterial({color:0xffd447,depthTest:false,transparent:true}));clotRing.visible=false;clotRing.renderOrder=10;root.add(clotRing);
  /* Extras */
  const shellMat=new T.MeshStandardMaterial({color:0x8e1b1f,transparent:true,opacity:.33,side:T.DoubleSide,depthWrite:false,roughness:.7});
  let shell=null;
  function setShell(col,op){if(!shell){const m=H3.mesh(p=>{const lv=H3.rc(p,H3.LV_B,H3.LV_A,.66,.27),rv=H3.rc(p,H3.RV_B,H3.RV_A,.54,.2);return Math.min(lv,rv)-.13-(p[1]>.6?(p[1]-.6)*.12:0)},.07),g=new T.BufferGeometry();g.setAttribute("position",new T.BufferAttribute(m.pos,3));g.setIndex(new T.BufferAttribute(m.idx,1));g.computeVertexNormals();shell=new T.Mesh(g,shellMat);root.add(shell)}
    if(col==null){shell.visible=false;return}shell.visible=true;shellMat.color.set(col);shellMat.opacity=op||.3}
  const pGeo=new T.SphereGeometry(.024,8,6),pMat=new T.MeshBasicMaterial({color:0xffffff}),MAXP=80,parts=new T.InstancedMesh(pGeo,pMat,MAXP);parts.count=0;parts.frustumCulled=false;root.add(parts);
  let flow=null;
  const condMat=new T.MeshBasicMaterial({color:0x35e0c4,depthTest:false,transparent:true,opacity:.95}),condGroup=new T.Group();root.add(condGroup);condGroup.visible=false;
  const cc=H3.CONDUCT,tube=(pts,r)=>new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p))),24,r,7),condMat);
  [[cc.sa,[-.5,.72,.05],cc.av],[cc.av,cc.his],cc.rb,cc.lb].forEach(a=>{const m=tube(a,.016);m.renderOrder=5;condGroup.add(m)});
  [cc.sa,cc.av].forEach(p=>{const s=new T.Mesh(new T.SphereGeometry(.05,12,10),condMat);s.position.set(...p);s.renderOrder=6;condGroup.add(s)});
  const blockMark=new T.Mesh(new T.TorusGeometry(.1,.02,8,24),new T.MeshBasicMaterial({color:0xff3b3b,depthTest:false}));blockMark.renderOrder=7;condGroup.add(blockMark);
  const marker=new T.Mesh(new T.TorusGeometry(.17,.016,8,32),new T.MeshBasicMaterial({color:0xff3b3b,depthTest:false,transparent:true}));marker.renderOrder=8;marker.visible=false;root.add(marker);
  /* Chordae and mitral valve, seen only in the cut view */
  const valve=new T.Group();root.add(valve);valve.visible=false;
  const mvA=[.05,.5,-.26],mvB=[.5,.48,-.42];
  const chordMat=new T.MeshStandardMaterial({color:0xfff3dc,roughness:.6,clippingPlanes:[clipPlane]});
  let chordRupt=[];
  function chord(a,b){return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3([new T.Vector3(...a),new T.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2+.02,(a[2]+b[2])/2),new T.Vector3(...b)]),10,.007,5),chordMat)}
  H3.MVTOP.forEach((m,i)=>{const pm=i<2?H3.PM_AL[1]:H3.PM_PM[1],c=chord(pm,m);if(i>=2)chordRupt.push(c);valve.add(c)});
  function setChords(rupt){chordRupt.forEach(c=>c.visible=!rupt)}
  /* Selection state */
  let inf=new Set(),hover=null,mode="auto",yaw=0,pitch=0,ty=0,tp=0,flip=0;
  function paint(){if(!cur)return;const {reg,adj}=cur.userData,attr=cur.geometry.attributes.aInf,mAttr=cur.geometry.attributes.aMot,mot=cur.userData.mot,n=reg.length;
    let a=new Float32Array(n);for(let i=0;i<n;i++){const r=reg[i];a[i]=r&&inf.has(r)?1:(r&&hover===r?.34:0)}
    for(let pass=0;pass<2;pass++){const b=new Float32Array(n);for(let i=0;i<n;i++){const A=adj[i];if(!A){b[i]=a[i];continue}let s=a[i]*2,c=2;for(let j=0;j<A.length;j++){s+=a[A[j]];c++}b[i]=s/c}a=b}
    attr.array.set(a);attr.needsUpdate=true;for(let i=0;i<n;i++)mAttr.array[i]=mot[i]*(1-.92*Math.min(1,a[i]));mAttr.needsUpdate=true;
    for(const k in vessels){const m=vessels[k],g=m.geometry.attributes,p=g.position,aM=g.aMot;for(let i=0;i<p.count;i++){const q=[p.getX(i),p.getY(i),p.getZ(i)];aM.array[i]=q[1]>.55?.2:(inf.has(REG_I[H3.region(q)])?.1:1)}aM.needsUpdate=true}}
  function setInfarct(list){inf=new Set((list||[]).map(r=>REG_I[r]));paint()}
  function setCulprit(seg,opt){const down=seg?H3.DOWN[seg]:[];for(const k in vessels){const m=vessels[k];m.material.color.set(down.includes(k)?0x5f5962:0xe2554a)}if(NV)NV.culprit(down);/*NEO-HOOK*/
    if(seg){const curve=vessels[seg].userData.curve,p=curve.getPoint(opt&&opt.at!=null?opt.at:(seg==="LM"?.72:.42));clot.position.copy(p);clot.visible=true;clotRing.position.copy(p);clotRing.visible=true}else{clot.visible=false;clotRing.visible=false}}
  function dirAngles(d){const n=H3.norm(d);return{y:Math.atan2(-n[0],n[2]),p:Math.atan2(n[1],Math.hypot(n[0],n[2]))}}
  function lookFrom(d){const a=dirAngles(d);ty=a.y;tp=a.p}
  function setFlow(f){flow=f;if(!f)parts.count=0}
  function setConduction(o){condGroup.visible=!!o;blockMark.visible=!!(o&&o.at);if(o&&o.at)blockMark.position.set(...o.at)}
  /* Interaction */
  const ray=new T.Raycaster(),ptr=new T.Vector2();let drag=null,moved=0;const el=renderer.domElement;
  function pick(ev){const r=el.getBoundingClientRect();ptr.set((ev.clientX-r.left)/r.width*2-1,-(ev.clientY-r.top)/r.height*2+1);ray.setFromCamera(ptr,cam);if(hooks.prePick){const pp=hooks.prePick(ray);if(pp)return pp}
    const vs=Object.values(vessels),hv=ray.intersectObjects(vs,false)[0],hm=cur?ray.intersectObject(cur,false)[0]:null;
    if(hv&&(!hm||hv.distance<hm.distance+.05))return{vessel:hv.object.userData.vessel};
    if(hm){const lp=root.worldToLocal(hm.point.clone()),pt=[lp.x,lp.y,lp.z];const rr=cur.userData.reg,idx=hm.face.a,g=rr[idx]||rr[hm.face.b]||rr[hm.face.c];if(g){const name=Object.keys(REG_I).find(k=>REG_I[k]===g);return{region:name,point:pt}}return{other:true,point:pt}}return null}
  el.addEventListener("pointerdown",e=>{drag={x:e.clientX,y:e.clientY};moved=0;try{el.setPointerCapture(e.pointerId)}catch(_){}});
  el.addEventListener("pointermove",e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved+=Math.abs(dx)+Math.abs(dy);ty+=dx*.009;if(e.pointerType==="mouse")tp=Math.max(-1.45,Math.min(1.45,tp+dy*.008));drag.x=e.clientX;drag.y=e.clientY;el.style.cursor="grabbing"}
    else if(e.pointerType==="mouse"){const h=pick(e);const nr=h&&h.region?REG_I[h.region]:null;if(nr!==hover){hover=nr;if(!hooks.noHover)paint()}el.style.cursor=h&&(h.region||h.vessel)?"pointer":"grab";hooks.hover&&hooks.hover(h,e)}});
  const end=e=>{if(drag&&moved<7){const h=pick(e);if(h)hooks.pick&&hooks.pick(h)}drag=null;el.style.cursor="grab"};
  el.addEventListener("pointerup",end);el.addEventListener("pointercancel",()=>{drag=null});el.addEventListener("pointerleave",()=>{if(hover!==null){hover=null;if(!hooks.noHover)paint()}hooks.hover&&hooks.hover(null)});
  /* Labels */
  const labels=[];function addLabel(el,pos){const L={el,pos:new T.Vector3(...pos)};labels.push(L);return L}
  const tmp=new T.Vector3();
  function layout(){for(const L of labels){tmp.copy(L.pos);if(NV)NV.lab(tmp);/*NEO-HOOK*/root.localToWorld(tmp);const facing=tmp.z>-.25;tmp.project(cam);const W=host.clientWidth,H=host.clientHeight;L.el.style.transform=`translate(-50%,-50%) translate(${(tmp.x*.5+.5)*W}px,${(-tmp.y*.5+.5)*H}px)`;L.el.style.opacity=facing?1:.0}}
  let w=0,h=0;function resize(){const W=host.clientWidth,H=host.clientHeight;if(W===w&&H===h||!W||!H)return;w=W;h=H;renderer.setSize(W,H,false);el.style.width=W+"px";el.style.height=H+"px";cam.aspect=W/H;cam.fov=W<H?36+(H/W-1)*30:32;cam.updateProjectionMatrix()}
  const ro=new ResizeObserver(resize);ro.observe(host);resize();
  let running=false,t0=performance.now(),beatOn=!matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dummy=new T.Object3D();
  function frame(now){if(!running)return;requestAnimationFrame(frame);render(now)}
  function render(now){const t=(now-t0)/1000;
    yaw+=(ty-yaw)*.12;pitch+=(tp-pitch)*.12;root.rotation.set(pitch,yaw,0,"XYZ");root.updateMatrixWorld();clipPlane.copy(clipBase).applyMatrix4(root.matrixWorld);
    if(hooks.frame)hooks.frame(now);if(hooks.beat)uni.uBeat.value=beatOn?hooks.beat():0;else if(beatOn){const ph=(t*1.2)%1;uni.uBeat.value=ph<.34?Math.sin(ph/.34*Math.PI):0}else uni.uBeat.value=.0;
    uni.uPulse.value=.5+.5*Math.sin(t*3.2);clotRing.scale.setScalar(1+.25*(.5+.5*Math.sin(t*4)));clotRing.quaternion.copy(root.quaternion).invert();marker.quaternion.copy(root.quaternion).invert();blockMark.quaternion.copy(root.quaternion).invert();
    if(flow){const f=flow,n=Math.min(f.n||36,MAXP);parts.count=n;pMat.color.set(f.col);for(let i=0;i<n;i++){let u=(t*(f.speed||.5)+i/n)%1;let q;if(f.fn)q=f.fn(u,i/n,t);else{const a=f.pts,s=u*(a.length-1),j=Math.min(a.length-2,Math.floor(s)),w2=s-j;q=[a[j][0]+(a[j+1][0]-a[j][0])*w2,a[j][1]+(a[j+1][1]-a[j][1])*w2,a[j][2]+(a[j+1][2]-a[j][2])*w2];const jit=f.jit||.03;q[0]+=Math.sin(i*12.9)*jit;q[1]+=Math.sin(i*78.2)*jit;q[2]+=Math.sin(i*37.7)*jit}
        dummy.position.set(q[0],q[1],q[2]);dummy.scale.setScalar(f.size||1);dummy.updateMatrix();parts.setMatrixAt(i,dummy.matrix)}parts.instanceMatrix.needsUpdate=true}
    renderer.render(scene,cam);layout()}
  return{REG_I,vessels,setMarker(p){marker.visible=!!p;if(p)marker.position.set(...p)},setChords,showHeart,setInfarct,setCulprit,lookFrom,setFlow,setConduction,setShell,addLabel,
    T,scene,cam,renderer,condGroup,uni,currentMesh(){return cur},start(){if(running)return;running=true;requestAnimationFrame(frame)},stop(){running=false},setBeat(b){beatOn=b},resize,renderOnce(){render(performance.now())},root,snapView(d){const a=dirAngles(d);ty=yaw=a.y;tp=pitch=a.p}}
}