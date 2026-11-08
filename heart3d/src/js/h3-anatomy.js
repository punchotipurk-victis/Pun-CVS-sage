/* ===== 3D HEART: signed-distance anatomy meshed with surface nets, rendered with three.js =====
   Axes: +x patient's left, +y cranial, +z anterior. Viewing from +z = looking at the chest. */
const H3=(()=>{
const V=(x,y,z)=>[x,y,z],sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],len=a=>Math.hypot(a[0],a[1],a[2]),norm=a=>mul(a,1/(len(a)||1));
function rc(p,a,b,r1,r2){ /* round cone, after iq */
  const ba=sub(b,a),l2=dot(ba,ba),rr=r1-r2,a2=l2-rr*rr,il2=1/l2,pa=sub(p,a),y=dot(pa,ba),z=y-l2,xv=sub(mul(pa,l2),mul(ba,y)),x2=dot(xv,xv),y2=y*y*l2,z2=z*z*l2,k=Math.sign(rr)*rr*rr*x2;
  if(Math.sign(z)*a2*z2>k)return Math.sqrt(x2+z2)*il2-r2;
  if(Math.sign(y)*a2*y2<k)return Math.sqrt(x2+y2)*il2-r1;
  return(Math.sqrt(x2*a2*il2)+y*rr)*il2-r1}
function cap(p,a,b,r){const pa=sub(p,a),ba=sub(b,a),h=Math.max(0,Math.min(1,dot(pa,ba)/dot(ba,ba)));return len(sub(pa,mul(ba,h)))-r}
function sph(p,c,r){return len(sub(p,c))-r}
function ell(p,c,rs){const q=[(p[0]-c[0])/rs[0],(p[1]-c[1])/rs[1],(p[2]-c[2])/rs[2]],k=len(q),m=Math.min(rs[0],rs[1],rs[2]);return(k-1)*m}
const smin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25};
const sst=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
const LAA=[V(.55,.9,-.25),V(.82,.84,-.08),V(.98,.74,.08),V(.98,.62,.22),V(.9,.56,.32)];
const laaF=(p,k)=>smin(smin(smin(sph(p,LAA[0],.16-k),sph(p,LAA[1],.15-k),.08),smin(sph(p,LAA[2],.12-k),sph(p,LAA[3],.09-k),.06),.07),sph(p,LAA[4],.06-k),.05);
const LV_B=V(.2,.36,-.2),LV_A=V(.66,-.72,.26),RV_B=V(-.4,.2,.22),RV_A=V(.16,-.46,.5);
const AX=norm(sub(LV_A,LV_B)),AXL=len(sub(LV_A,LV_B));
const E1=norm(sub(V(0,0,1),mul(AX,AX[2]))),E2=cross(E1,AX);
/* 4-chamber cut plane: contains the LV long axis and passes through the RV. */
const CUTN=norm([.46,.42,.78]),CUTD=dot(CUTN,V(.42,-.25,.08))+.015;
const AOAX=norm(V(-.06,.9,.02)),AON=norm(sub(CUTN,mul(AOAX,dot(CUTN,AOAX)))),AOD=dot(AON,V(-.08,.5,0)),LAAD=dot(CUTN,LAA[1])-.01;
const pPM=(h,th,o)=>{const t=th*Math.PI/180,c=add(LV_B,mul(AX,h*AXL));return add(c,add(mul(E1,Math.cos(t)*o),mul(E2,Math.sin(t)*o)))};
const cAx=h=>add(LV_B,mul(AX,h*AXL));
let SEPT=norm(cross(CUTN,AX));if(dot(SEPT,sub(RV_B,LV_B))<0)SEPT=mul(SEPT,-1);
const inner=h=>.45+(.1-.45)*Math.max(0,Math.min(1,h));
const PM_AL=[add(add(cAx(.74),mul(SEPT,-.2)),mul(CUTN,-.06)),add(add(cAx(.4),mul(SEPT,-.12)),mul(CUTN,-.1))],PM_PM=[add(add(cAx(.76),mul(SEPT,.03)),mul(CUTN,-.17)),add(add(cAx(.42),mul(SEPT,.05)),mul(CUTN,-.2))];
const VSD_L=add(cAx(.6),mul(SEPT,inner(.6)-.08)),VSD_R=add(cAx(.6),mul(SEPT,inner(.6)+.32));
const RUP_IN=pPM(.55,40,.26),RUP_OUT=pPM(.55,40,.82);
const ANEU=cAx(.92);
const THR=add(add(ANEU,mul(SEPT,.2)),mul(AX,.1));
const MVTOP=[-.3,-.16,-.02,.12].map(o=>add(add(cAx(.06),mul(SEPT,o)),mul(CUTN,-.1)));
const sL=h=>add(cAx(h),mul(SEPT,inner(h)+.018)),sR=h=>add(cAx(h),mul(SEPT,inner(h)+.2));
const PU=norm([CUTN[2],0,-CUTN[0]]),PV=cross(CUTN,PU),PO=add(V(0,.4,0),mul(CUTN,CUTD-dot(V(0,.4,0),CUTN)));
const PP=(i,j,b)=>add(add(PO,add(mul(PU,i*.045),mul(PV,j*.045))),mul(CUTN,-b));
let RPM=[PP(-18.5,-15,.08),PP(-15,-7.5,.06),PP(-12,-19,.22),PP(-12.5,-11.5,.18),PP(-8,0,.06),PP(-10.8,1.8,.06)],MODB=[PP(-8,-10,.06),PP(-17.6,-13.8,.08)];
function field(p,o){
  const dil=o.rvDil?.07:0;
  const lv=rc(p,LV_B,LV_A,.66,.27),rv=rc(p,RV_B,RV_A,.54+dil,.2+dil*.5);
  let vent=smin(lv,rv,.2);
  if(o.aneurysm)vent=smin(vent,sph(p,ANEU,.46),.3);
  const ra=smin(ell(p,V(-.74,.72,-.03),[.42,.46,.42]),sph(p,V(-.47,1.02,.24),.15),.1);
  const la=smin(ell(p,V(.28,.9,-.56),[.5,.36,.34]),laaF(p,0),.1);
  const pv=Math.min(cap(p,V(.5,.98,-.72),V(1.18,1.05,-.88),.085),cap(p,V(.5,.8,-.76),V(1.18,.72,-.92),.085),cap(p,V(.05,.98,-.74),V(-.55,1.08,-.9),.085),cap(p,V(.05,.8,-.78),V(-.55,.7,-.94),.085));
  const ao=Math.min(cap(p,V(-.08,.5,.0),V(-.14,1.32,.02),.235),cap(p,V(-.14,1.32,.02),V(.2,1.68,-.14),.215),cap(p,V(.2,1.68,-.14),V(.52,1.5,-.46),.205),cap(p,V(.52,1.5,-.46),V(.56,.72,-.92),.19),cap(p,V(-.02,1.6,-.04),V(-.08,2.02,0),.08),cap(p,V(.18,1.72,-.12),V(.2,2.04,-.14),.07),cap(p,V(.34,1.66,-.26),V(.42,2.02,-.3),.07));
  const pa=Math.min(cap(p,V(-.02,.58,.42),V(.26,1.2,.14),.235),cap(p,V(.26,1.2,.14),V(.92,1.3,-.2),.135),cap(p,V(.26,1.2,.14),V(-.52,1.22,-.2),.13));
  const cv=Math.min(cap(p,V(-.74,.95,-.05),V(-.74,1.86,-.08),.155),cap(p,V(-.74,.5,-.16),V(-.74,-.2,-.2),.165));
  let lvC=o.hocm?rc(p,LV_B,LV_A,.41,.08):rc(p,LV_B,LV_A,.45,.1);
  let rvC=rc(p,RV_B,RV_A,.445+dil,.12+dil*.5);
  rvC=Math.max(rvC,-(lv+.005));
  const raC=ell(p,V(-.74,.72,-.03),[.34,.38,.34]),laC=ell(p,V(.28,.9,-.56),[.42,.27,.25]);
  const aoC=cap(p,V(-.08,.5,.0),V(-.14,1.32,.02),.165),paC=cap(p,V(-.02,.58,.42),V(.26,1.2,.14),.165),svc=cap(p,V(-.74,.95,-.05),V(-.74,1.86,-.08),.085),ivc=cap(p,V(-.74,.5,-.16),V(-.74,-.2,-.2),.095);
  let wall=smin(vent,Math.min(ra,la),.05);wall=smin(wall,Math.min(ao,pa,cv,pv),.03);
  if(!o.cut&&!o.rupture&&!o.open)return wall;
  /* endocardial relief: trabeculae carneae (ventricles), pectinate muscles (RA wall, LAA) */
  {const v=sub(p,LV_B),ax=dot(v,AX),h=ax/AXL,u=sub(v,mul(AX,ax)),th=Math.atan2(dot(u,E2),dot(u,E1));
   lvC+=.024*sst(.28,.6,h)*(.5+.5*Math.sin(th*11+h*7));
   if(o.hocm)lvC=Math.max(lvC,-sph(p,add(sL(.24),mul(SEPT,-.04)),.19));
   rvC+=.024*sst(.2,-.25,p[1])*(.5+.5*Math.sin(17*(p[0]*.8-p[2]*.6)+5*p[1]));}
  let raC2=raC+.022*sst(-.82,-1.0,p[0])*(.5+.5*Math.sin(p[1]*34))+.022*sst(-.6,-.45,-p[2]-.2)*0;
  const laaC=laaF(p,.05)+.012*(.5+.5*Math.sin(p[0]*40+p[1]*20));
  let cavity=Math.min(lvC,rvC,raC2,laC,aoC,paC,svc,ivc,smin(laaC,laC,.06));
  if(o.aneurysm)cavity=Math.min(cavity,smin(lvC,sph(p,ANEU,.385),.3));
  /* flow channels between chambers, so a cut heart reads as connected */
  cavity=Math.min(cavity,cap(p,V(.24,.62,-.42),V(.26,.44,-.3),.13),cap(p,V(-.64,.5,-.02),V(-.42,.36,.16),.14));
  /* papillary muscles stand inside the LV cavity */
  let pm=rc(p,PM_AL[0],PM_AL[1],.1,.055);
  if(!o.papRupt)pm=Math.min(pm,rc(p,PM_PM[0],PM_PM[1],.1,.055));
  else pm=Math.min(pm,cap(p,PM_PM[0],add(mul(PM_PM[0],.55),mul(PM_PM[1],.45)),.07),sph(p,add(PM_PM[1],V(-.02,.12,.03)),.06));
  pm=Math.min(pm,rc(p,RPM[0],RPM[1],.075,.04),rc(p,RPM[2],RPM[3],.06,.035),rc(p,RPM[4],RPM[5],.045,.03),cap(p,MODB[0],MODB[1],.04));
  cavity=Math.max(cavity,-pm);
  if(o.thrombus)cavity=Math.max(cavity,-sph(p,THR,.17));
  let d=Math.max(wall,-cavity);
  if(o.vsd)d=Math.max(d,-cap(p,VSD_L,VSD_R,.125));
  if(o.rupture)d=Math.max(d,-cap(p,RUP_IN,RUP_OUT,.055));
  if(o.cut){let cutT=dot(p,CUTN)-CUTD;
    const da=cap(p,V(-.08,.4,0),V(-.14,1.45,.02),0),wA=sst(.44,.27,da)*sst(.48,.64,p[1]);if(wA>0)cutT+=(dot(p,AON)-AOD-cutT)*wA;
    const dl=Math.min(sph(p,LAA[1],.2),sph(p,LAA[2],.17),sph(p,LAA[3],.13),sph(p,LAA[0],.12)),wL=sst(.05,-.03,dl);if(wL>0)cutT+=(dot(p,CUTN)-LAAD-cutT)*wL;
    d=Math.max(d,cutT)}
  return d}
/* Surface nets: a smooth mesh with no lookup tables. */
function mesh(f,res){
  const b0=[-1.4,-1.35,-1.2],b1=[1.35,2.2,1.05],s=res,nx=Math.ceil((b1[0]-b0[0])/s)+1,ny=Math.ceil((b1[1]-b0[1])/s)+1,nz=Math.ceil((b1[2]-b0[2])/s)+1;
  const vals=new Float32Array(nx*ny*nz),id=(i,j,k)=>i+nx*(j+ny*k);
  const B=4,diag=s*B*.9;for(let k0=0;k0<nz;k0+=B)for(let j0=0;j0<ny;j0+=B)for(let i0=0;i0<nx;i0+=B){
    const c=f([b0[0]+(i0+B/2)*s,b0[1]+(j0+B/2)*s,b0[2]+(k0+B/2)*s]),far=Math.abs(c)>diag*1.15;
    for(let k=k0;k<Math.min(nz,k0+B);k++)for(let j=j0;j<Math.min(ny,j0+B);j++)for(let i=i0;i<Math.min(nx,i0+B);i++)vals[id(i,j,k)]=far?c:f([b0[0]+i*s,b0[1]+j*s,b0[2]+k*s])}
  const vid=new Int32Array(nx*ny*nz).fill(-1),pos=[],tris=[];
  const corners=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]],edges=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  for(let k=0;k<nz-1;k++)for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
    let mask=0;const c=[];for(let q=0;q<8;q++){const v=vals[id(i+corners[q][0],j+corners[q][1],k+corners[q][2])];c.push(v);if(v<0)mask|=1<<q}
    if(mask===0||mask===255)continue;
    let px=0,py=0,pz=0,n=0;for(const[a,b]of edges){if((c[a]<0)===(c[b]<0))continue;const u=c[a]/(c[a]-c[b]);px+=corners[a][0]+u*(corners[b][0]-corners[a][0]);py+=corners[a][1]+u*(corners[b][1]-corners[a][1]);pz+=corners[a][2]+u*(corners[b][2]-corners[a][2]);n++}
    vid[id(i,j,k)]=pos.length/3;pos.push(b0[0]+(i+px/n)*s,b0[1]+(j+py/n)*s,b0[2]+(k+pz/n)*s)}
  const q=(a,b,c,d,flip)=>{if(a<0||b<0||c<0||d<0)return;if(!flip)tris.push(a,c,b,a,d,c);else tris.push(a,b,c,a,c,d)};
  for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++)for(let i=1;i<nx-1;i++){
    const v0=vals[id(i,j,k)];
    if((v0<0)!==(vals[id(i+1,j,k)]<0))q(vid[id(i,j-1,k-1)],vid[id(i,j,k-1)],vid[id(i,j,k)],vid[id(i,j-1,k)],v0<0);
    if((v0<0)!==(vals[id(i,j+1,k)]<0))q(vid[id(i-1,j,k-1)],vid[id(i-1,j,k)],vid[id(i,j,k)],vid[id(i,j,k-1)],v0<0);
    if((v0<0)!==(vals[id(i,j,k+1)]<0))q(vid[id(i-1,j-1,k)],vid[id(i,j-1,k)],vid[id(i,j,k)],vid[id(i-1,j,k)],v0<0)}
  return{pos:new Float32Array(pos),idx:new Uint32Array(tris)}}
/* Which wall does this point belong to? Used for painting, picking and vessel motion. */
function region(p){
  const v=sub(p,LV_B),ax=dot(v,AX),h=ax/AXL,u=sub(v,mul(AX,ax)),th=Math.atan2(dot(u,E2),dot(u,E1))*180/Math.PI;
  if(rc(p,RV_B,RV_A,.56,.22)<.0&&rc(p,LV_B,LV_A,.66,.27)>.0)return"RV";
  if(h>.84)return"APEX";
  if(th>=-85&&th<-8)return"ANTSEP";
  if(th>=-8&&th<55&&h>=.2)return"ANT";
  if(th>=-8&&th<55)return"HILAT";
  if(th>=55&&th<125&&h<.42)return"HILAT";
  if(th>=55&&th<138)return"LAT";
  if(th>=138||th<-170)return"POST";
  return"INF"}
const inVent=p=>Math.min(rc(p,LV_B,LV_A,.68,.29),rc(p,RV_B,RV_A,.57,.23))<.02&&dot(sub(p,LV_B),AX)>-.34;
const FAT=[];function fatInit(){for(const k of['LADp','LADm','LCxp','LCxd','RCAp','RCAm','RCAd','PDA'])for(const q of VESSELS[k].pts)FAT.push(q)}
function fatAt(p){let m=9;for(const q of FAT){const d=len(sub(p,q));if(d<m)m=d}return m}
function baseColor(p,cut,o){
  const c=(r,g,b)=>[r/255,g/255,b/255];
  const onCut=o.cut&&Math.abs(dot(p,CUTN)-CUTD)<.03;
  const dLV=rc(p,LV_B,LV_A,.45,.1),dil=o.rvDil?.07:0,dRV=Math.max(rc(p,RV_B,RV_A,.445+dil,.12+dil*.5),-(rc(p,LV_B,LV_A,.66,.27)+.005));
  const ao=Math.min(cap(p,V(-.08,.5,0),V(-.14,1.32,.02),.26),cap(p,V(-.14,1.32,.02),V(.2,1.68,-.14),.24),cap(p,V(.2,1.68,-.14),V(.52,1.5,-.46),.23),cap(p,V(.52,1.5,-.46),V(.56,.72,-.92),.21),cap(p,V(-.02,1.6,-.04),V(-.08,2.02,0),.1),cap(p,V(.18,1.72,-.12),V(.2,2.04,-.14),.09),cap(p,V(.34,1.66,-.26),V(.42,2.02,-.3),.09));
  const pa=Math.min(cap(p,V(-.02,.58,.42),V(.26,1.2,.14),.26),cap(p,V(.26,1.2,.14),V(.92,1.3,-.2),.16),cap(p,V(.26,1.2,.14),V(-.52,1.22,-.2),.15));
  const cv=Math.min(cap(p,V(-.74,.95,-.05),V(-.74,1.86,-.08),.18),cap(p,V(-.74,.5,-.16),V(-.74,-.2,-.2),.19));
  const ra=Math.min(ell(p,V(-.74,.72,-.03),[.44,.48,.44]),sph(p,V(-.47,1.02,.24),.17));
  const la=Math.min(ell(p,V(.28,.9,-.56),[.52,.38,.36]),laaF(p,-.02)),pvn=p[2]<-.68&&(p[0]>.5||p[0]<.05)&&p[1]>.6&&p[1]<1.15;
  if(o.thrombus&&sph(p,THR,.19)<.012)return c(70,16,26);
  if(o.cut&&ao<.05&&p[1]>.5&&Math.abs(dot(p,AON)-AOD)<.035)return c(222,152,142);
  if(onCut){if(inVent(p))return c(198,96,86);return c(214,150,140)}
  const isVent=inVent(p);
  if(isVent&&p[1]<.62){const n=.96+.07*Math.sin(p[0]*24+p[1]*16)*Math.sin(p[2]*19-p[1]*11);
    if(dLV<.03)return mul(c(216,128,118),n);if(dRV<.03)return mul(c(196,132,150),n);
    const fd=fatAt(p),fw=Math.max(0,Math.min(1,(.2-fd)/.14)),base=mul(c(150,44,40),n),fat=c(232,196,130);return add(mul(base,1-fw*.7),mul(fat,fw*.7))}
  if(ao<.02)return o.cut&&cap(p,V(-.08,.5,0),V(-.14,1.32,.02),.19)<0?c(176,56,54):c(203,62,58);
  if(pa<.02)return c(72,106,178);
  if(cv<.02)return c(70,92,160);
  if(pvn)return c(204,96,96);
  if(ra<.02)return c(118,108,178);
  if(la<.02)return c(190,92,104);
  return mul(c(164,58,52),1)}
function snapFn(f){return p=>{let q=p.slice();for(let it=0;it<10;it++){const e=.012,d=f(q),g=[f(add(q,[e,0,0]))-f(add(q,[-e,0,0])),f(add(q,[0,e,0]))-f(add(q,[0,-e,0])),f(add(q,[0,0,e]))-f(add(q,[0,0,-e]))],gn=norm(g);q=sub(q,mul(gn,d))}return q}}
const outer=p=>{const lv=rc(p,LV_B,LV_A,.66,.27),rv=rc(p,RV_B,RV_A,.54,.2);let w=smin(lv,rv,.2);const ra=ell(p,V(-.74,.72,-.03),[.42,.46,.42]),la=ell(p,V(.28,.9,-.56),[.5,.36,.34]);return smin(w,Math.min(ra,la),.05)};
/* Interventricular groove: where the LV and RV surfaces meet, found numerically at each level. */
function groove(hs,thLo,thHi){const out=[];for(const h of hs){let best=null,bv=9;for(let th=thLo;th<=thHi;th+=1.5){const t=th*Math.PI/180,c=add(LV_B,mul(AX,h*AXL));let dir=add(mul(E1,Math.cos(t)),mul(E2,Math.sin(t))),r=.05;for(let i=0;i<70&&outer(add(c,mul(dir,r)))<0;i++)r+=.018;const q=add(c,mul(dir,r)),e=Math.abs(rc(q,LV_B,LV_A,.6,.2)-rc(q,RV_B,RV_A,.5,.16));if(e<bv){bv=e;best=q}}if(best)out.push(best)}return out}
const SNAP=snapFn(outer);
const pts=a=>a.map(q=>SNAP(q));
const antG=groove([.0,.14,.28,.42,.56,.7,.84,.95],-85,30),postG=groove([.12,.26,.4,.54,.68,.82],-178,-96);
const VESSELS=(()=>{
  const LMo=V(-.02,.62,.13);
  const lm=[LMo,add(antG[0],V(-.0,.02,-.04))];
  const lad=antG;
  const avL=pts([V(.28,.5,.34),V(.56,.46,.1),V(.78,.42,-.2),V(.74,.34,-.54),V(.46,.26,-.74),V(.14,.14,-.74)]);
  const avR=pts([V(-.28,.64,.36),V(-.56,.46,.42),V(-.82,.2,.32),V(-.88,-.02,.04),V(-.68,-.18,-.24),V(-.34,-.22,-.46),V(-.04,-.14,-.62)]);
  const rcaO=V(-.14,.64,.2);
  const d1=pts([antG[1],V(.56,.28,.46),V(.84,-.02,.32),V(.98,-.32,.14)]);
  const om=pts([avL[2],V(.96,.18,-.2),V(1.08,-.2,-.18),V(1.04,-.58,-.12)]);
  const am=pts([avR[2],V(-.5,-.02,.62),V(-.18,-.34,.74),V(.1,-.56,.7)]);
  const pl=pts([avL[5],V(.46,-.08,-.62),V(.68,-.36,-.42)]);
  const pda=[avR[6]].concat(postG);
  return{
   LM:{name:"Left main",r:.056,pts:[LMo,lm[1]],occ:"lmca"},
   LADp:{name:"Proximal LAD",r:.05,pts:[lm[1],lad[1],lad[2]],occ:"proxLAD"},
   LADm:{name:"Mid LAD",r:.042,pts:[lad[2],lad[3],lad[4],lad[5]],occ:"ant"},
   LADd:{name:"Distal LAD",r:.034,pts:[lad[5],lad[6],lad[7]],occ:"apex"},
   D1:{name:"First diagonal",r:.03,pts:d1,occ:"hilat"},
   LCxp:{name:"Proximal LCx",r:.046,pts:[lm[1],avL[0],avL[1],avL[2]],occ:"lat"},
   LCxd:{name:"Distal LCx",r:.038,pts:avL.slice(2),occ:"post"},
   OM:{name:"Obtuse marginal",r:.03,pts:om,occ:"lat"},
   PL:{name:"Posterolateral branch",r:.028,pts:pl,occ:"post"},
   RCAp:{name:"Proximal RCA",r:.05,pts:[rcaO,avR[0],avR[1],avR[2]],occ:"infRV"},
   RCAm:{name:"Mid RCA",r:.044,pts:avR.slice(2,5),occ:"inf"},
   RCAd:{name:"Distal RCA",r:.04,pts:avR.slice(4),occ:"inf"},
   AM:{name:"Acute marginal",r:.026,pts:am,occ:"infRV"},
   PDA:{name:"Posterior descending",r:.034,pts:pda,occ:"inf"}
  }})();
/* Smooth every vessel and press it onto the epicardium so no segment sinks into the wall */
const snapO=snapFn(p=>outer(p)-.012);
const chaikin=(a,n)=>{let o=a;for(let i=0;i<n;i++){const r=[o[0]];for(let j=0;j<o.length-1;j++){const p=o[j],q=o[j+1];r.push(add(mul(p,.75),mul(q,.25)),add(mul(p,.25),mul(q,.75)))}r.push(o[o.length-1]);o=r}return o};
for(const k in VESSELS){const v=VESSELS[k];v.pts=chaikin(v.pts,2).map(q=>(q[1]>.56&&Math.abs(q[0])<.3&&(k==="LM"||k==="RCAp"))?q:snapO(q))}
fatInit();
const DOWN={LM:["LM","LADp","LADm","LADd","D1","LCxp","LCxd","OM","PL"],LADp:["LADp","LADm","LADd","D1"],LADm:["LADm","LADd"],LADd:["LADd"],D1:["D1"],LCxp:["LCxp","LCxd","OM","PL"],LCxd:["LCxd","PL"],OM:["OM"],PL:["PL"],RCAp:["RCAp","RCAm","RCAd","AM","PDA"],RCAm:["RCAm","RCAd","PDA"],RCAd:["RCAd","PDA"],AM:["AM"],PDA:["PDA"]};
const CONDUCT={sa:V(-.68,1.05,.14),av:add(sL(-.1),mul(SEPT,.12)),his:add(sL(.06),mul(SEPT,.1)),rb:[add(sL(.06),mul(SEPT,.1)),sR(.3),sR(.6),sR(.86)],lb:[add(sL(.06),mul(SEPT,.1)),sL(.3),sL(.6),sL(.9)]};
return{PP,PU,PV,RPM:()=>RPM,MODB:()=>MODB,LAA,AON,AOD,sst,RV_B,RV_A,inVent,outerF:outer,MVTOP,SEPT,cAx,sL,sR,snapO,field,mesh,region,baseColor,VESSELS,DOWN,CONDUCT,AX,LV_B,AXL,CUTN,CUTD,VSD_L,VSD_R,RUP_IN,RUP_OUT,ANEU,PM_PM,PM_AL,add,sub,mul,norm,dot,cross,outer,pPM,rc,RV_B,RV_A,LV_A}
})();
