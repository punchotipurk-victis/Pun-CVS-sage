/* ECG templates and rhythm generators extracted from app.js without numerical changes.
   init() returns an isolated engine; callers supply timing, never heart geometry. */
(function(){
'use strict';
// Full-precision pre-extraction timing. Approved for both pages to preserve ECG identity;
// conduction.json intentionally remains unchanged (its timing values are rounded).
const LEGACY_TIMING=Object.freeze({"TA_AVN":65.60150841471894,"WPW_LEAD":45,"onset":{"normal":29.735034397615696,"hocm":29.735034397615696,"rbbb":29.735034397615696,"lbbb":37.0210137181529,"lafb":29.735034397615696,"lpfb":29.735034397615696,"bifasc":29.735034397615696,"wpw":0,"hisOnly":0,"vesc":4,"pvc":4,"rvot":4}});
Object.freeze(LEGACY_TIMING.onset);
function timingFromSpec(legacy){
  const timing={TA_AVN:legacy.TA_AVN_ms,WPW_LEAD:legacy.WPW_LEAD_ms,onset:{...legacy.qrsOnset_ms}};
  if(Math.abs(timing.TA_AVN-LEGACY_TIMING.TA_AVN)>.05||timing.WPW_LEAD!==LEGACY_TIMING.WPW_LEAD||
     Object.keys(LEGACY_TIMING.onset).some(k=>!Number.isFinite(timing.onset[k])||Math.abs(timing.onset[k]-LEGACY_TIMING.onset[k])>.05))
    throw new Error('ECG timing contract changed: review the legacy precision calibration');
  return {TA_AVN:LEGACY_TIMING.TA_AVN,WPW_LEAD:timing.WPW_LEAD,onset:{...LEGACY_TIMING.onset}};
}
function init(timing){
  if(!Number.isFinite(timing.TA_AVN)||!Number.isFinite(timing.WPW_LEAD)||!timing.onset)
    throw new TypeError('ECG.init requires TA_AVN, WPW_LEAD and onset');
const {TA_AVN,WPW_LEAD}=timing;
const D0=Math.round(170-TA_AVN-22);

/* ================= shared ECG engine (ECG frame: x left, y inferior, z anterior) ================= */
const nrm=a=>{const l=Math.hypot(a[0],a[1],a[2])||1;return[a[0]/l,a[1]/l,a[2]/l]};
const LEADS={I:[1,0,0],II:[.5,.866,0],III:[-.5,.866,0],aVR:[-.866,-.5,0],aVL:[.866,-.5,0],aVF:[0,1,0]};
[["V1",115],["V2",92],["V3",75],["V4",58],["V5",35],["V6",10]].forEach(([k,a])=>{const r=a*Math.PI/180;LEADS[k]=nrm([Math.cos(r),.12,Math.sin(r)]).map(v=>v*1.25)});
const L=(c,w,a,d)=>({c,w,a,d:nrm(d)});
const VCG={
 normal:{q:[L(12,7,.3,[-.5,-.1,.85]),L(42,13,1.5,[.5,.7,-.45]),L(72,9,.32,[-.3,-.7,-.6])],dur:92,T:L(300,0,.32,[.45,.8,0])},
 hocm:{q:[L(14,8,.85,[-.55,-.5,.65]),L(46,14,2.5,[.6,.55,-.6]),L(76,9,.35,[-.3,-.7,-.6])],dur:100,T:L(300,0,.38,[-.55,-.3,.45])},
 rbbb:{q:[L(12,7,.3,[-.5,-.1,.85]),L(42,13,1.4,[.5,.7,-.45]),L(108,19,.8,[-.75,0,.65])],dur:140,T:L(320,0,.3,[.6,.7,-.4])},
 lbbb:{q:[L(24,15,.55,[.75,.15,-.35]),L(72,24,1.3,[.75,.3,-.6]),L(122,16,.8,[.85,-.1,-.5])],dur:150,T:L(330,0,.4,[-.7,-.3,.6])},
 lafb:{q:[L(12,7,.32,[-.15,.95,.2]),L(46,14,1.4,[.55,-.75,-.35]),L(76,9,.2,[-.2,-.6,-.5])],dur:100,T:L(300,0,.3,[.6,.45,-.05])},
 lpfb:{q:[L(12,7,.32,[.5,-.8,.1]),L(46,14,1.4,[-.45,.85,-.25]),L(76,9,.2,[.2,-.5,-.5])],dur:100,T:L(300,0,.3,[0,.9,.2])},
 bifasc:{q:[L(12,7,.32,[-.15,.95,.2]),L(46,14,1.3,[.55,-.75,-.35]),L(110,19,.75,[-.75,0,.65])],dur:140,T:L(320,0,.3,[.6,.4,-.4])},
 wpw:{q:[L(28,19,.7,[-.35,.6,.7]),L(68,14,1.3,[.5,.7,-.45]),L(98,9,.28,[-.3,-.7,-.6])],dur:120,T:L(330,0,.3,[.6,.4,-.7])},
 vesc:{q:[L(45,28,1.1,[-.3,-.6,.75]),L(115,24,.75,[.6,.1,-.3])],dur:165,T:L(360,0,.45,[.3,.6,-.75])},
 pvc:{q:[L(45,26,1.3,[-.4,-.6,.7]),L(105,22,.6,[.3,-.3,.6])],dur:150,T:L(340,0,.45,[.4,.6,-.6])},
 rvot:{q:[L(55,30,1.45,[.15,.95,-.3]),L(115,20,.45,[.6,.4,-.6])],dur:150,T:L(340,0,.42,[-.1,-.9,.35])},
 hisOnly:{q:[],dur:0,T:null}
};
const PL={sinus:[L(32,15,.13,[.2,.9,.45]),L(70,17,.12,[.75,.45,-.5])],iab:[L(32,15,.13,[.2,.9,.45]),L(104,17,.13,[.75,.45,-.55])]};
const TA_LOBE=L(150,42,.055,[-.25,-.85,-.35]);
const g=(t,c,w)=>{const u=(t-c)/w;return u*u>30?0:Math.exp(-u*u*.5)};
const tShape=(t,c)=>{const u=t-c,w=u<0?62:40;return Math.exp(-u*u/(2*w*w))};
const sstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t)};
function bsearch(arr,t){let lo=0,hi=arr.length-1,r=-1;while(lo<=hi){const m=(lo+hi)>>1;if(arr[m].t<=t){r=m;lo=m+1}else hi=m-1}return r}
function vecAt(cx,t){const ev=cx.ev,ST=cx.ST;let x=0,y=0,z=0;const add=(d,k)=>{x+=d[0]*k;y+=d[1]*k;z+=d[2]*k};const pa=cx.pAmp||1;
  for(let i=Math.max(0,bsearch(ev.A,t-300)),n=ev.A.length;i<n;i++){const a=ev.A[i];if(a.t>t+10)break;if(!a.p)continue;const r=t-a.t;for(const l of PL[a.mode]||PL.sinus)add(l.d,pa*l.a*g(r,l.c,l.w));
    if(ST&&ST.peri)add(TA_LOBE.d,TA_LOBE.a*g(r,TA_LOBE.c,TA_LOBE.w))}
  if(ev.cont==="flutter"){const ph=((t/ev.cl)%1+1)%1,f=ph<.72?(.5-ph/.72):(-.5+(ph-.72)/.28);add([.1,.9,-.4],.2*f)}
  else if(ev.cont==="af"){add([.15,.3,.9],.045*(Math.sin(t/23.1)+Math.sin(t/31.7+1.3)*.8+Math.sin(t/17.3+2.1)*.6+Math.sin(t/41.9+.4)*.5))}
  for(let i=Math.max(0,bsearch(ev.V,t-700)),n=ev.V.length;i<n;i++){const v=ev.V[i];if(v.t>t+10)break;const m=VCG[v.mode];if(!m||!v.qrs)continue;const r=t-v.t-v.on,amp=v.amp||1;
    for(const l of m.q)add(l.d,amp*l.a*g(r,l.c,l.w));
    if(m.T)add(m.T.d,amp*m.T.a*tShape(r,m.T.c));
    if(ST&&v.st){const J=m.dur,sh=sstep(J-8,J+14,r)*(1-sstep(m.T.c+10,m.T.c+110,r));add(ST.d,ST.a*sh);if(!ST.peri)add(ST.d,ST.a*.9*tShape(r,m.T.c-25));if(ST.tallR)add([0,0,1],.45*g(r,46,13))}}
  return[x,y,z]}
const GAIN=.72,leadVal=(v,k)=>{const l=LEADS[k];return GAIN*(v[0]*l[0]+v[1]*l[1]+v[2]*l[2])};

/* ================= rhythm generators ================= */
let rng=1;const rand=()=>{rng=(rng*16807)%2147483647;return(rng-1)/2147483646};
const HIS_WPW=WPW_LEAD-22;
const ONSET=Object.freeze({...timing.onset});
function Aev(t,o){return Object.assign({t,mode:"sinus",d:D0,cond:true,p:true,dieAt:1},o||{})}
function Vev(t,mode,o){return Object.assign({t,mode,his:mode==="wpw"?HIS_WPW:0,qrs:mode!=="hisOnly",on:ONSET[mode]||0,st:true},o||{})}
function conductV(a,mode){if(mode==="wpw")return Vev(a.t+TA_AVN+a.d+22-WPW_LEAD,mode,{from:a});return Vev(a.t+TA_AVN+a.d,mode,{from:a})}
function buildEvents(rh,sc){rng=12345;const A=[],V=[],H=240000;let cont=null,cl=200;const vm=rh.vmode||"normal",PP=rh.rate?60000/rh.rate:800;
  const sinus=(t,o)=>{const a=Aev(t,o);A.push(a);if(a.cond)V.push(conductV(a,o&&o.vmode||vm));return a};
  switch(rh.type){
  case"sinus":for(let t=200;t<H;t+=PP)sinus(t,{mode:rh.amode||"sinus",d:D0+(rh.avAdd||0)});break;
  case"arrest":{let t=200;while(t<H){for(let k=0;k<4;k++){sinus(t);t+=PP}const esc=t-PP+2300;V.push(Vev(esc,"normal"));t=esc+760}break}
  case"saExit":{let k=0;for(let t=200;t<H;t+=PP,k++){if(k%4===3)A.push(Aev(t,{mode:"saOnly",p:false,cond:false}));else sinus(t)}break}
  case"wenck":{let k=0;const add=[0,110,165];for(let t=200;t<H;t+=PP,k++){const j=k%4;if(j<3)sinus(t,{d:D0+add[j]});else A.push(Aev(t,{cond:false,d:D0+230,dieAt:.8}))}break}
  case"mobitz2":{let k=0;for(let t=200;t<H;t+=PP,k++){const a=Aev(t);A.push(a);V.push(k%3===2?Vev(a.t+TA_AVN+a.d,"hisOnly",{from:a}):conductV(a,"rbbb"))}break}
  case"chb":{const pa=60000/rh.rateA,pv=60000/rh.rateV;for(let t=200;t<H;t+=pa)A.push(Aev(t,{cond:false,dieAt:rh.dieAt}));for(let t=520;t<H;t+=pv)V.push(Vev(t,rh.esc));break}
  case"flutter":{cont="flutter";cl=rh.cl;for(let t=300;t<H;t+=cl*rh.conduct){V.push(Vev(t,"normal"));A.push(Aev(t-TA_AVN-D0,{mode:"avnOnly",p:false}))}break}
  case"af":{cont="af";for(let t=300;t<H;t+=380+rand()*560){V.push(Vev(t,"normal"));A.push(Aev(t-TA_AVN-D0,{mode:"avnOnly",p:false}))}A.sort((a,b)=>a.t-b.t);break}
  case"bigeminy":{let k=0;for(let t=200;t<H;t+=PP,k++){if(k%2===0){sinus(t);const v=V[V.length-1];V.push(Vev(v.t+v.on+430,"pvc"))}else A.push(Aev(t,{cond:false,dieAt:.25}))}break}
  case"rvot":{let t=200;while(t<H){for(let j=0;j<3;j++){sinus(t);t+=PP}const v0=V[V.length-1].t+V[V.length-1].on+400,run=4,ci=355;for(let j=0;j<run;j++)V.push(Vev(v0+j*ci,"rvot"));const vend=v0+(run-1)*ci;
      while(t<vend+420){A.push(Aev(t,{cond:false,dieAt:.35}));t+=PP}}break}
  }
  V.sort((a,b)=>a.t-b.t);
  if(sc&&sc.tamp)V.forEach((v,i)=>{v.amp=i%2?.32:.48;v.swing=i%2?1:-1});
  return{A,V,cont,cl,end:H-8000}}
function curEv(ev,t){const ia=bsearch(ev.A,t),iv=bsearch(ev.V,t);return{a:ia>=0?ev.A[ia]:null,v:iv>=0?ev.V[iv]:null,iv}}


return {D0,ONSET,LEADS,VCG,PL,TA_LOBE,nrm,g,tShape,sstep,bsearch,vecAt,GAIN,leadVal,Aev,Vev,conductV,buildEvents,curEv};
}
window.ECG={init,timingFromSpec,LEGACY_TIMING};
})();
