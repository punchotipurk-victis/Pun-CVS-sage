/* ===== Refined heart (echo-sim phantom v0.4 export, pun-cvs heart mesh v1) =====
   Injected by echo-sim/tools/integrate_heart_mesh.py into the Heart Conduction lab and the MI lab, right after their H3 module.
   The intact heart (no cut, no lesion) uses the refined mesh + coronary tree; cut / lesion views keep the legacy H3 SDF heart.
   The mesh JSON lives ONCE in the site page (window.PUN_HEART_MESH, lazy-parsed); a lab opened on its own falls back to H3. */
const NEO=(()=>{
  let J=null;
  try{J=window.PUN_HEART_MESH||null}catch(e){}
  if(!J)try{if(window.parent&&window.parent!==window)J=window.parent.PUN_HEART_MESH||null}catch(e){}
  if(!J||!J.mesh||typeof H3==="undefined")return null;
  try{
  const dec=(s,Tp)=>{const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return new Tp(u.buffer)};
  const M=J.frames.heartToH3;                                   /* column-major heart frame (cm) → H3 units */
  const tr0=(x,y,z)=>[M[0]*x+M[4]*y+M[8]*z+M[12],M[1]*x+M[5]*y+M[9]*z+M[13],M[2]*x+M[6]*y+M[10]*z+M[14]];
  /* Optional smooth warp onto the legacy H3 atria (Heart Conduction lab: its conduction network, labels and cut view are
     drawn in H3 coordinates). Gaussian RBF through landmark pairs [refined (H3 units) → legacy]; zero at the ventricles. */
  const CFG=typeof NEO_CFG!=="undefined"?NEO_CFG:{};
  let warp=null;
  if(CFG.warpToLegacy){const P=[ /* [heart-frame landmark (cm), legacy H3 point | null = keep] */
      [[3.35,.75,-2.3],[-.74,.72,-.03]] /* RA centre */,[[2.4,-1.36,-4.8],[-.74,1.3,-.06]] /* SVC top */,[[3.09,3.24,-1.07],[-.74,.2,-.18]] /* IVC */,
      [[-1.1,-.3,-2.25],[.28,.9,-.56]] /* LA centre */,[[1.6,-1.3,-.28],[-.08,.5,0]] /* AV centre */,
      [[0,0,0],null] /* MV centre */,[[0,0,9.4],null] /* LV apex */,[[2.6,-.6,6.9],null] /* RV apex */,[[-3.3,0,4],null] /* LV lateral */]
      .map(([h,l])=>{const a=tr0(...h);return[a,l||a]});
    const s2=2*(CFG.sigma||.42)**2,m=P.length,K=[...Array(m)].map((_,i)=>P.map(q=>Math.exp(-((P[i][0][0]-q[0][0])**2+(P[i][0][1]-q[0][1])**2+(P[i][0][2]-q[0][2])**2)/s2)));
    const W=[0,1,2].map(ax=>{const A=K.map((r,i)=>[...r,P[i][1][ax]-P[i][0][ax]]);   /* Gauss–Jordan */
      for(let c=0;c<m;c++){let b=c;for(let r=c+1;r<m;r++)if(Math.abs(A[r][c])>Math.abs(A[b][c]))b=r;[A[c],A[b]]=[A[b],A[c]];
        for(let r=0;r<m;r++)if(r!==c){const f=A[r][c]/A[c][c];for(let k=c;k<=m;k++)A[r][k]-=f*A[c][k]}}return A.map((r,i)=>r[m]/r[i])});
    warp=q=>{let dx=0,dy=0,dz=0;for(let i=0;i<m;i++){const g=Math.exp(-((q[0]-P[i][0][0])**2+(q[1]-P[i][0][1])**2+(q[2]-P[i][0][2])**2)/s2);dx+=g*W[0][i];dy+=g*W[1][i];dz+=g*W[2][i]}
      return[q[0]+dx,q[1]+dy,q[2]+dz]}}
  const tr=warp?(x,y,z)=>warp(tr0(x,y,z)):tr0;
  const SC=Math.hypot(M[0],M[1],M[2]);
  const n=J.meta.vertices,C=J.mesh.positionCentre,R=J.mesh.positionRange,Pq=dec(J.mesh.positions,Int16Array);
  const pos=new Float32Array(n*3);
  for(let i=0;i<n;i++){const q=tr(Pq[i*3]/32767*R[0]+C[0],Pq[i*3+1]/32767*R[1]+C[1],Pq[i*3+2]/32767*R[2]+C[2]);pos[i*3]=q[0];pos[i*3+1]=q[1];pos[i*3+2]=q[2]}
  const idx=J.mesh.indexType==="uint16"?dec(J.mesh.index,Uint16Array):dec(J.mesh.index,Uint32Array);
  const A={};for(const k in J.vertex)A[k]=dec(J.vertex[k],Uint8Array);
  const LN=J.labelNames;
  /* AHA 17 → the labs' wall regions (docs/HEART-MESH-EXPORT.md) */
  const AHA2REG=[0,"ANT","ANTSEP","INF","INF","POST","HILAT","ANT","ANTSEP","INF","INF","POST","LAT","ANT","ANTSEP","INF","LAT","APEX"];
  const REG_I={ANTSEP:1,ANT:2,APEX:3,HILAT:4,LAT:5,INF:6,POST:7,RV:8};
  const c=(r,g,b)=>[r/255,g/255,b/255],MYO=c(150,44,40),FAT=c(232,196,130);
  const COL={aortic_root:c(203,62,58),aortic_arch:c(203,62,58),arch_branches:c(203,62,58),PA_main:c(72,106,178),RPA:c(72,106,178),LPA:c(72,106,178),
    RA_wall:c(118,108,178),crista_terminalis:c(118,108,178),coronary_sinus:c(70,92,160),LA_wall:c(190,92,104),LAA:c(190,92,104),IAS:c(190,92,104),pulmonary_veins:c(204,96,96)};
  const reg=new Uint8Array(n),mot=new Float32Array(n),cls=new Uint8Array(n),col=new Float32Array(n*3);
  for(let i=0;i<n;i++){const name=LN[A.label[i]],w=A.wall[i],a=A.aha[i];
    reg[i]=a?REG_I[AHA2REG[a]]:(w===2?8:0);mot[i]=reg[i]?1:.18;cls[i]=reg[i]?2:(w===3?1:0);
    let k;const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],nz=.96+.07*Math.sin(x*24+y*16)*Math.sin(z*19-y*11);
    if(name==="epicardial_fat"||w===5)k=MYO.map(v=>v*nz);
    else if(COL[name])k=COL[name];else k=MYO.map(v=>v*nz);
    col[i*3]=k[0];col[i*3+1]=k[1];col[i*3+2]=k[2]}
  let meshObj=null;
  function mesh(T,mat){if(meshObj)return meshObj;const g=new T.BufferGeometry();
    g.setAttribute("position",new T.BufferAttribute(pos,3));g.setIndex(new T.BufferAttribute(idx,1));g.setAttribute("color",new T.BufferAttribute(col,3));
    g.setAttribute("aMot",new T.BufferAttribute(mot.slice(),1));g.setAttribute("aInf",new T.BufferAttribute(new Float32Array(n),1));g.computeVertexNormals();g.computeBoundingSphere();
    const adj=new Array(n);for(let i=0;i<idx.length;i+=3){const a=idx[i],b=idx[i+1],d=idx[i+2];(adj[a]=adj[a]||[]).push(b,d);(adj[b]=adj[b]||[]).push(a,d);(adj[d]=adj[d]||[]).push(a,b)}
    meshObj=new T.Mesh(g,mat);meshObj.userData={reg,adj,mot:mot.slice(),cls,neo:true};return meshObj}
  /* Vessels: the lab's legacy keys, cut from the model's right-dominant tree */
  const art={};for(const a of J.vessels.arteries)art[a.id]=a;
  function cutPts(id,a,b,np){const P=art[id].points.map(p=>tr(p[0],p[1],p[2])),L=[0];
    for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1],P[i][2]-P[i-1][2]));
    const tot=L[L.length-1],out=[];let j=0;
    for(let s=0;s<np;s++){const d=(a+(b-a)*s/(np-1))*tot;while(j<P.length-2&&L[j+1]<d)j++;const u=Math.max(0,Math.min(1,(d-L[j])/((L[j+1]-L[j])||1)));
      out.push([P[j][0]+(P[j+1][0]-P[j][0])*u,P[j][1]+(P[j+1][1]-P[j][1])*u,P[j][2]+(P[j+1][2]-P[j][2])*u])}return out}
  const rad=(id,a,b)=>{const v=art[id],m=(a+b)/2;return Math.max(.022,(v.displayR0+(v.displayR1-v.displayR0)*m)*SC)};
  const SPLIT={LM:["LM",0,1],LADp:["LAD",0,.28],LADm:["LAD",.28,.62],LADd:["LAD",.62,1],D1:["D1",0,1],LCxp:["LCx",0,.45],LCxd:["LCx",.45,1],
    OM:["OM1",0,1],PL:["PLB",0,1],RCAp:["RCA",0,.33],RCAm:["RCA",.33,.66],RCAd:["RCA",.66,1],AM:["AM",0,1],PDA:["PDA",0,1]};
  const V={};for(const k in SPLIT){const [id,a,b]=SPLIT[k];if(art[id])V[k]={pts:cutPts(id,a,b,16),r:rad(id,a,b)}}
  /* Extra branches shown on the intact heart (not tappable), greyed with their parent segment */
  const DECOR={D2:"LADm",OM2:"LCxd",CB:"RCAp",SAN:"RCAp",RVB1:"RCAp",RVB2:"RCAm"};
  function tube(T,pts,r0,r1,mat){const curve=new T.CatmullRomCurve3(pts.map(p=>new T.Vector3(...p)),false,"centripetal"),segs=Math.max(24,pts.length*4),rs=9;
    const g=new T.TubeGeometry(curve,segs,1,rs,false),P=g.attributes.position,cc=new T.Vector3();
    for(let i=0;i<=segs;i++){curve.getPointAt(i/segs,cc);const r=r0+(r1-r0)*i/segs;for(let j=0;j<=rs;j++){const q=i*(rs+1)+j;P.setXYZ(q,cc.x+(P.getX(q)-cc.x)*r,cc.y+(P.getY(q)-cc.y)*r,cc.z+(P.getZ(q)-cc.z)*r)}}
    g.computeVertexNormals();const m=g.attributes.position.count;g.setAttribute("aMot",new T.BufferAttribute(new Float32Array(m).fill(1),1));g.setAttribute("aInf",new T.BufferAttribute(new Float32Array(m),1));
    const o=new T.Mesh(g,mat);o.userData.curve=curve;return o}
  const api={active:false,V,mesh,plain:o=>!o||!Object.keys(o).some(k=>o[k]),meta:J.meta};
  api.attach=function(T,root,vessels,vesselMat,patch){
    const legacy={},legacyPts={},neo={};
    for(const k in vessels){legacy[k]=vessels[k];legacyPts[k]=H3.VESSELS[k].pts.map(p=>p.slice())}
    for(const k in V){const src=SPLIT[k],a=art[src[0]],r0=Math.max(.022,(a.displayR0+(a.displayR1-a.displayR0)*src[1])*SC),r1=Math.max(.022,(a.displayR0+(a.displayR1-a.displayR0)*src[2])*SC);
      const m=tube(T,V[k].pts,r0,r1,vesselMat(0xe2554a));m.userData.vessel=k;m.visible=false;root.add(m);neo[k]=m}
    const decor=new T.Group();decor.visible=false;root.add(decor);const decorM={};
    for(const id in DECOR)if(art[id]){const a=art[id];const m=tube(T,cutPts(id,0,1,12),a.displayR0*SC*.9,Math.max(.018,a.displayR1*SC*.9),vesselMat(0xe2554a));m.raycast=()=>{};decor.add(m);decorM[id]=m}
    /* caval stubs: the export stops at the RA; the labs label the SVC/IVC and put the SA node at the SVC–RA junction */
    const cav=(a,b,ext,r)=>{const A=tr(...a),B=tr(...b),d=[B[0]-A[0],B[1]-A[1],B[2]-A[2]],L=Math.hypot(...d),u=d.map(x=>x/L);
      const pts=[A,B,[B[0]+u[0]*ext,B[1]+u[1]*ext,B[2]+u[2]*ext]],m=tube(T,pts,r*SC,r*SC,patch(new T.MeshStandardMaterial({color:0x5866a8,roughness:.5})));m.raycast=()=>{};decor.add(m)};
    cav([3.35,.75,-2.3],[2.4,-1.36,-4.8],.32,.9);cav([3.35,1.2,-2.0],[3.09,3.24,-1.07],.12,1.0);
    for(const v of J.vessels.veins){const m=tube(T,v.points.map(p=>tr(p[0],p[1],p[2])),(v.displayR0||.2)*SC,(v.displayR1||.15)*SC,vesselMat(0x465ca0));m.raycast=()=>{};decor.add(m)}
    const setPts=(k,src)=>{const a=H3.VESSELS[k].pts;a.length=0;for(const p of src)a.push(p.slice())};   /* in place: callers may hold the array */
    function use(on){api.active=on;decor.visible=on;
      for(const k in legacy){const nk=on&&neo[k];vessels[k]=nk?neo[k]:legacy[k];legacy[k].visible=!nk;if(neo[k])neo[k].visible=!!nk;setPts(k,nk?V[k].pts:legacyPts[k])}}
    function culprit(down){for(const k in neo)neo[k].material.color.set(down.includes(k)?0x5f5962:0xe2554a);for(const k in legacy)legacy[k].material.color.set(down.includes(k)?0x5f5962:0xe2554a);
      for(const id in decorM)decorM[id].material.color.set(down.includes(DECOR[id])?0x5f5962:0xe2554a)}
    /* vessel labels are placed once on refined points; in a legacy (cut / lesion) view move them to the matching legacy point */
    const labMap=new Map();for(const k in V)V[k].pts.forEach((q,i)=>{const L=legacyPts[k];if(L&&L.length)labMap.set(q.map(x=>x.toFixed(4)).join(),L[Math.round(i/(V[k].pts.length-1)*(L.length-1))])});
    function lab(v){if(api.active)return;const q=labMap.get([v.x,v.y,v.z].map(x=>x.toFixed(4)).join());if(q)v.set(q[0],q[1],q[2])}
    use(true);return{use,culprit,lab}};
  /* Name what a tap on the non-ventricular surface hit (Heart Conduction lab); undefined → the lab's own position rules */
  api.classify=function(p){let b=-1,bd=1e9;for(let i=0;i<n;i++){const dx=pos[i*3]-p[0],dy=pos[i*3+1]-p[1],dz=pos[i*3+2]-p[2],d=dx*dx+dy*dy+dz*dz;if(d<bd){bd=d;b=i}}
    if(b<0||bd>.01)return undefined;const L=LN[A.label[b]];
    if(L==="LAA")return{valveKey:"laa"};
    if(/^aort|arch_branches/.test(L))return{name:"Aorta",note:"Ascending aorta, arch and its branches. The aortic root sits between the mitral and tricuspid valves; the His bundle runs just under the non-coronary cusp."};
    if(/^PA_main|^RPA|^LPA/.test(L))return{name:"Pulmonary trunk",note:"Arises from the conus arteriosus of the RV. The muscular RVOT just below the pulmonary valve is a common source of idiopathic VT."};
    if(L==="LA_wall"||L==="pulmonary_veins"||L==="IAS")return{struct:"la"};
    return undefined};
  return api;
  }catch(e){console.warn("Refined heart unavailable, using the built-in model:",e);return null}
})();
try{window.NEO_HEART=NEO}catch(e){}
