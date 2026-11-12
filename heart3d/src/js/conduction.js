/* ===== CONDUCTION SYSTEM: anatomical graph + activation maps =====
   Units: 1 model unit ≈ 75 mm. Velocities in mm/ms (= m/s). Times in ms.
   Two clocks: atrial-side structures run on the atrial clock (t=0 when the SA node fires);
   ventricular-side structures run on the ventricular clock (t=0 when the His bundle fires,
   or when an ectopic/pre-excited focus starts). */
const CS=(()=>{
const {add,sub,mul,norm,dot,cross}=H3;
const U=75,len=a=>Math.hypot(a[0],a[1],a[2]),dist=(a,b)=>len(sub(a,b)),lerp=(a,b,u)=>add(a,mul(sub(b,a),u)),clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const Fo=p=>H3.field(p,{open:true});
function toWall(c,d,back){d=norm(d);let r=.01;for(let i=0;i<500;i++){const p=add(c,mul(d,r));if(Fo(p)<0)return add(c,mul(d,Math.max(0,r-back)));r+=.004}return add(c,mul(d,r))}
function snapTo(f,p){let q=p.slice();for(let it=0;it<14;it++){const e=.01,d=f(q),g=norm([f(add(q,[e,0,0]))-f(add(q,[-e,0,0])),f(add(q,[0,e,0]))-f(add(q,[0,-e,0])),f(add(q,[0,0,e]))-f(add(q,[0,0,-e]))]);q=sub(q,mul(g,d))}return q}
const snapA=(p,inset)=>snapTo(q=>H3.outerF(q)+inset,p);
const cAx=H3.cAx,SEPT=H3.SEPT;
const dirPM=(h,th)=>norm(sub(H3.pPM(h,th,1),cAx(h)));
const lvEndo=(h,th,b)=>toWall(cAx(h),dirPM(h,th),b==null?.022:b);
const rvAx=s=>lerp(H3.RV_B,H3.RV_A,s),RVD=norm(sub(H3.RV_A,H3.RV_B));
function rvDir(s,ang){const c=rvAx(s),lvp=cAx(clamp(dot(sub(c,H3.LV_B),H3.AX)/H3.AXL,0,1));let d=sub(c,lvp);d=norm(sub(d,mul(RVD,dot(d,RVD))));const b=cross(RVD,d),a=ang*Math.PI/180;return norm(add(mul(d,Math.cos(a)),mul(b,Math.sin(a))))}
const rvEndo=(s,ang,b)=>toWall(rvAx(s),rvDir(s,ang),b==null?.022:b);
const inner=h=>.45+(.1-.45)*clamp(h,0,1);

/* ---- nodes ---- */
const N={},E=[];
const node=(id,pos,o)=>(N[id]=Object.assign({id,pos,side:"A"},o||{}));
/* atrial side */
node("SA_H",snapA([-.8,1.17,.1],.025));node("SA",snapA([-.9,1.05,.1],.025),{big:"sa"});node("SA_T",snapA([-1.0,.9,.07],.025));
node("ANT1",snapA([-.56,1.08,.22],.035));node("IAG",[-.3,1.03,-.2]);
node("BB1",snapA([-.06,1.13,-.32],.03));node("BB2",snapA([.3,1.16,-.4],.03));node("LAA",snapA([.66,1.02,-.14],.035));
node("MID1",snapA([-.7,1.0,-.24],.035));node("IAS",[-.34,.72,-.2]);
node("CT1",snapA([-1.14,.72,.0],.035));node("CT2",snapA([-1.0,.43,-.16],.035));node("ISTH",[-.66,.35,-.16]);
node("INE",[-.47,.38,-.07]);node("AVN",[-.35,.44,.02],{big:"avn"});
node("LAI",snapA([.08,.62,-.62],.035));node("LAP",snapA([.45,.82,-.86],.035));
node("AP_A",snapA([.76,.6,-.34],.03));
/* ventricular side */
const BIF=add(cAx(.06),mul(SEPT,inner(.06)+.1));
node("HIS",lerp([-.35,.44,.02],BIF,.3),{side:"V"});node("BIF",BIF,{side:"V"});
node("LB1",H3.sL(.15),{side:"V"});node("LSF1",H3.sL(.36),{side:"V"});node("LSF2",H3.sL(.58),{side:"V"});node("LVAP",lvEndo(.9,-40),{side:"V"});
node("LAF1",lvEndo(.2,-25),{side:"V"});node("LAF2",lvEndo(.32,25),{side:"V"});node("LAF3",lvEndo(.46,70),{side:"V"});node("LAFPM",lvEndo(.6,100),{side:"V"});
node("LPF1",lvEndo(.26,-95),{side:"V"});node("LPF2",lvEndo(.4,-128),{side:"V"});node("LPFPM",lvEndo(.58,-150),{side:"V"});
node("RB1",H3.sR(.2),{side:"V"});node("RB2",H3.sR(.4),{side:"V"});node("RB3",H3.sR(.58),{side:"V"});node("RBAP",H3.sR(.82),{side:"V"});
node("MODFW",rvEndo(.55,15),{side:"V"});
node("AP_V",snapA([.8,.32,-.18],.04),{side:"V"});
node("RVOT",snapA([-.14,.42,.44],.06),{side:"V"});

/* ---- edges ----  kind sets velocity; struct sets what a tap selects */
const V={tract:1.6,bach:2.0,cs:1.0,ine:.12,his:1.5,bb:2.0,fasc:2.0,mod:2.0,purk:2.6};
function edge(a,b,mid,kind,struct,o){const pts=[N[a].pos].concat(mid||[],[N[b].pos]);let L=0;for(let i=1;i<pts.length;i++)L+=dist(pts[i-1],pts[i]);
  const e=Object.assign({a,b,pts,kind,struct,L,id:a+"-"+b,side:(N[a].side==="V"||N[b].side==="V")&&kind!=="avn"?"V":"A"},o||{});
  e.T=e.fixed!=null?e.fixed:L*U/V[kind];E.push(e);return e}
edge("SA","SA_H",null,"sa","sa",{fixed:8});edge("SA","SA_T",null,"sa","sa",{fixed:10});
/* anterior internodal → Bachmann's bundle + septal (fast-pathway) descent */
edge("SA_H","ANT1",null,"tract","tracts");edge("ANT1","IAG",[snapA([-.42,1.12,.0],.04)],"tract","tracts");
edge("IAG","BB1",null,"bach","bach");edge("BB1","BB2",null,"bach","bach");edge("BB2","LAA",[snapA([.52,1.12,-.3],.03)],"bach","bach");
edge("IAG","IAS",null,"tract","tracts");
/* middle (Wenckebach) route */
edge("SA_H","MID1",null,"tract","tracts");edge("MID1","IAS",[[-.5,.86,-.24]],"tract","tracts");
edge("IAS","AVN",[[-.36,.56,-.1]],"tract","tracts",{fast:true});
/* posterior route along crista terminalis → cavotricuspid isthmus → slow pathway */
edge("SA_T","CT1",null,"tract","tracts");edge("CT1","CT2",null,"tract","tracts");edge("CT2","ISTH",[snapA([-.86,.33,-.24],.04)],"tract","tracts");
edge("ISTH","INE",null,"tract","tracts");edge("INE","AVN",null,"ine","avn");
/* inferior interatrial connection (coronary-sinus musculature) to the LA */
edge("INE","LAI",[[-.2,.5,-.4]],"cs","tracts");edge("LAI","LAP",null,"tract","la");edge("BB2","LAP",[snapA([.36,1.0,-.7],.035)],"tract","la");
edge("LAP","AP_A",[snapA([.7,.72,-.6],.035)],"tract","la");edge("LAA","AP_A",null,"tract","la");
/* AV node → penetrating His: beat-specific delay (set at run time) */
const AVE=edge("AVN","HIS",null,"avn","avn",{fixed:0});AVE.side="A";
/* His → bundle branches */
edge("HIS","BIF",null,"his","his");
edge("BIF","LB1",null,"bb","lbb");
edge("LB1","LSF1",null,"fasc","lbb");edge("LSF1","LSF2",null,"fasc","lbb");edge("LSF2","LVAP",[H3.sL(.78)],"fasc","lbb");
edge("LB1","LAF1",null,"fasc","laf");edge("LAF1","LAF2",null,"fasc","laf");edge("LAF2","LAF3",null,"fasc","laf");edge("LAF3","LAFPM",null,"fasc","laf");
edge("LB1","LPF1",null,"fasc","lpf");edge("LPF1","LPF2",null,"fasc","lpf");edge("LPF2","LPFPM",null,"fasc","lpf");
edge("BIF","RB1",null,"bb","rbb");edge("RB1","RB2",null,"bb","rbb");edge("RB2","RB3",null,"bb","rbb");
edge("RB3","MODFW",[lerp(N.RB3.pos,N.MODFW.pos,.5)],"mod","rbb");edge("RB3","RBAP",[H3.sR(.7)],"purk","purk");
/* accessory pathway (left lateral), fixed fast conduction */
const APE=edge("AP_A","AP_V",[lerp(N.AP_A.pos,N.AP_V.pos,.5)],"ap","ap",{fixed:12});APE.side="AP";

/* Purkinje endpoints: LV subendocardium (sparse at the posterolateral base, which activates last) */
const LVP=["LSF1","LSF2","LVAP","LAF2","LAF3","LAFPM","LPF2","LPFPM"],PURK=[];
let pk=0;
for(const h of [.3,.44,.58,.72,.85,.94])for(let th=-165;th<=165;th+=30){
  if(h<.42&&(th>90||th<-160))continue;
  const p=lvEndo(h,th,.03);let best=null,bd=9;for(const id of LVP){const d=dist(N[id].pos,p);if(d<bd){bd=d;best=id}}
  if(bd<.03)continue;const id="PL"+(pk++);node(id,p,{side:"V",purk:true});PURK.push(id);
  const mid=add(lerp(N[best].pos,p,.5),mul(norm(sub(cAx(h),p)),.02));edge(best,id,[mid],"purk","purk")}
/* RV free-wall and septal Purkinje, from the moderator band and the distal right bundle */
const RVP=["MODFW","RB3","RBAP","RB2"];
for(const s of [.3,.45,.6,.75,.88])for(const ang of [-70,-35,0,35,70]){
  const p=rvEndo(s,ang,.03);let best=null,bd=9;for(const id of RVP){const d=dist(N[id].pos,p);if(d<bd){bd=d;best=id}}
  const id="PR"+(pk++);node(id,p,{side:"V",purk:true});PURK.push(id);edge(best,id,[lerp(N[best].pos,p,.5)],"purk","purk")}
for(const id of ["LSF1","LSF2","LVAP","LAFPM","LPFPM","MODFW","RBAP","RB3"])N[id].purk=true;

/* ---- Dijkstra over a side of the graph ---- */
function dijkstra(sources,blocked,side){const t={};for(const id in N)t[id]=Infinity;const done={};for(const s in sources)t[s]=sources[s];
  const adj={};for(const e of E){if(blocked&&blocked.has(e.struct||"")&&!(blocked.keepEdge&&blocked.keepEdge(e)))continue;if(blocked&&blocked.has(e.id))continue;if(side&&e.side!==side)continue;(adj[e.a]=adj[e.a]||[]).push([e.b,e.T]);(adj[e.b]=adj[e.b]||[]).push([e.a,e.T])}
  for(;;){let u=null,m=Infinity;for(const id in t)if(!done[id]&&t[id]<m){m=t[id];u=id}if(u==null)break;done[u]=1;for(const[v,w]of adj[u]||[])if(t[u]+w<t[v])t[v]=t[u]+w}
  return t}

/* Atrial-clock times for the different atrial modes */
const amodes={};
function atrialTimes(mode){if(amodes[mode])return amodes[mode];let t;
  if(mode==="saOnly"){t={};for(const id in N)t[id]=Infinity;t.SA=0}
  else if(mode==="avnOnly"){const s=atrialTimes("sinus");t={};for(const id in N)t[id]=Infinity;t.AVN=s.AVN}
  else if(mode==="none"){t={};for(const id in N)t[id]=Infinity}
  else{const bl=new Set(mode==="iab"?["bach"]:[]);t=dijkstra({SA:0},bl,"A")}
  return amodes[mode]=t}
const TA=atrialTimes("sinus");
const TA_AVN=TA.AVN;
/* Ventricular modes. his = V-clock time at which the His fires (Infinity = not engaged antegrade). */
const VMODES={
  normal:{blk:[]}, hocm:{blk:[]}, rbbb:{blk:["rbb"]}, lbbb:{blk:["lbb","laf","lpf"],keep:e=>false}, lafb:{blk:["laf"]}, lpfb:{blk:["lpf"]},
  bifasc:{blk:["rbb","laf"]}, wpw:{blk:[],ap:true}, hisOnly:{blk:["lbb","laf","lpf","rbb","purk"],noMuscle:true},
  vesc:{blk:["his"],focus:lvEndo(.62,-150,.06),retro:30}, pvc:{blk:[],focus:lvEndo(.55,150,.06),retro:30}, rvot:{blk:["his"],focus:N.RVOT.pos,retro:45}
};
const WPW_LEAD=45; /* ms of pre-excitation before normal His-Purkinje activation would start */
const vcache={};
function ventGraph(mode){if(vcache[mode])return vcache[mode];const M=VMODES[mode];const bl=new Set(M.blk);let t;
  if(M.focus){/* ectopic focus: muscle first, then retrograde entry into the nearest Purkinje node */
    let best=null,bd=9;for(const id of PURK){const d=dist(N[id].pos,M.focus);if(d<bd){bd=d;best=id}}
    const src={};src[best]=M.retro+bd*U/.75;t=dijkstra(src,bl,"V")}
  else{t=dijkstra({HIS:0},bl,"V")}
  return vcache[mode]=t}
/* Muscle seeds for a ventricular mode: Purkinje terminals (+ focus / AP insertion) */
function ventSeeds(mode,hisOffset){const M=VMODES[mode],t=ventGraph(mode),seeds=[];if(M.noMuscle)return seeds;
  for(const id in N){const n=N[id];if(n.side!=="V"||!n.purk||!isFinite(t[id]))continue;seeds.push([n.pos,t[id]+(hisOffset||0)+4,/^(PR|RB|MOD)/.test(id)?1:0])}
  if(M.focus)seeds.push([M.focus,0,mode==="rvot"?1:0]);
  if(M.ap)seeds.push([N.AP_V.pos,0,0]);
  return seeds}
function atrialSeeds(mode){const t=atrialTimes(mode),seeds=[];
  for(const e of E){if(e.side!=="A"||e.kind==="avn"||e.kind==="ine"||e.kind==="sa")continue;const ta=t[e.a],tb=t[e.b];if(!isFinite(ta)&&!isFinite(tb))continue;
    const n=Math.max(2,Math.ceil(e.L/.04));for(let i=0;i<=n;i++){const u=i/n,p=pathAt(e,u),tt=Math.min(ta+u*e.T,tb+(1-u)*e.T);if(isFinite(tt))seeds.push([p,tt])}}
  if(isFinite(t.SA))seeds.push([N.SA.pos,6]);
  return seeds}
function pathAt(e,u){const P=e.pts;let s=u*e.L;for(let i=1;i<P.length;i++){const l=dist(P[i-1],P[i]);if(s<=l||i===P.length-1)return lerp(P[i-1],P[i],l?Math.min(1,s/l):0);s-=l}return P[P.length-1]}
/* Vertex classes on a mesh: 1 atrial myocardium, 2 ventricular myocardium, 0 not myocardium */
function classify(mesh){const ud=mesh.userData;if(ud.cls)return ud.cls;const pos=mesh.geometry.attributes.position.array,n=pos.length/3,cls=new Uint8Array(n);
  const ell=(p,c,r)=>{const q=[(p[0]-c[0])/r[0],(p[1]-c[1])/r[1],(p[2]-c[2])/r[2]];return(len(q)-1)*Math.min(r[0],r[1],r[2])};
  const cap=(p,a,b,r)=>{const pa=sub(p,a),ba=sub(b,a),h=clamp(dot(pa,ba)/dot(ba,ba),0,1);return len(sub(pa,mul(ba,h)))-r};
  for(let i=0;i<n;i++){const p=[pos[i*3],pos[i*3+1],pos[i*3+2]];if(ud.reg[i]){cls[i]=2;continue}
    const ra=Math.min(ell(p,[-.74,.72,-.03],[.44,.48,.44]),len(sub(p,[-.47,1.02,.24]))-.17),la=Math.min(ell(p,[.28,.9,-.56],[.52,.38,.36]),len(sub(p,[.72,.92,-.1]))-.17);
    const ves=Math.min(cap(p,[-.08,.5,0],[-.14,1.32,.02],.25),cap(p,[-.02,.58,.42],[.26,1.2,.14],.25),cap(p,[-.74,1.05,-.05],[-.74,1.86,-.08],.165),cap(p,[-.74,.42,-.16],[-.74,-.2,-.2],.175),
      cap(p,[.62,.98,-.75],[1.18,1.05,-.88],.09),cap(p,[.62,.8,-.78],[1.18,.72,-.92],.09),cap(p,[-.05,.98,-.76],[-.55,1.08,-.9],.09),cap(p,[-.05,.8,-.8],[-.55,.7,-.94],.09));
    if(Math.min(ra,la)<.03&&ves>.0)cls[i]=1}
  return ud.cls=cls}
/* Activation map: Euclidean spread from seeds at the muscle velocity. Returns Float32Array (1e9 = never). */
/* Crossing between ventricles has to go through septal muscle, not across the blood pool: add a delay and slow it */
function spread(mesh,cls,want,seeds,v){const pos=mesh.geometry.attributes.position.array,n=pos.length/3,out=new Float32Array(n).fill(1e9),k=U/v,reg=mesh.userData.reg;
  const S=seeds.length,sx=new Float32Array(S),sy=new Float32Array(S),sz=new Float32Array(S),st=new Float32Array(S),sr=new Uint8Array(S);
  for(let j=0;j<S;j++){sx[j]=seeds[j][0][0];sy[j]=seeds[j][0][1];sz[j]=seeds[j][0][2];st[j]=seeds[j][1];sr[j]=seeds[j][2]||0}
  for(let i=0;i<n;i++){if(cls[i]!==want)continue;const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2],rv=want===2&&reg[i]===8?1:0;let m=1e9;
    for(let j=0;j<S;j++){const dx=x-sx[j],dy=y-sy[j],dz=z-sz[j],cross=want===2&&sr[j]!==rv,t=st[j]+Math.sqrt(dx*dx+dy*dy+dz*dz)*k*(cross?1.5:1)+(cross?22:0);if(t<m)m=t}out[i]=m}
  return out}
const V_MUSCLE=.6,A_MUSCLE=1.0;
function stats(arr){const a=[];for(const x of arr)if(x<1e8)a.push(x);if(!a.length)return{on:0,dur:0};a.sort((p,q)=>p-q);return{on:a[Math.floor(a.length*.005)],off:a[Math.floor(a.length*.995)],dur:a[Math.floor(a.length*.995)]-a[Math.floor(a.length*.005)]}}
function aMap(mesh,mode){const ud=mesh.userData;ud.amap=ud.amap||{};if(ud.amap[mode])return ud.amap[mode];const cls=classify(mesh);
  const m=spread(mesh,cls,1,atrialSeeds(mode),A_MUSCLE);return ud.amap[mode]={t:m,st:stats(m)}}
function vMap(mesh,mode,hisOffset){const key=mode+"|"+(hisOffset||0),ud=mesh.userData;ud.vmap=ud.vmap||{};if(ud.vmap[key])return ud.vmap[key];const cls=classify(mesh);
  const m=spread(mesh,cls,2,ventSeeds(mode,hisOffset),V_MUSCLE);return ud.vmap[key]={t:m,st:stats(m)}}
/* Reference timings measured on a coarse internal sample, independent of which mesh is shown */
return{N,E,AVE,APE,U,TA,TA_AVN,VMODES,WPW_LEAD,atrialTimes,ventGraph,aMap,vMap,classify,pathAt,lvEndo,rvEndo,snapA,dist,lerp}
})();
