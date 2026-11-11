/* ===== LAB APP v2: two independent 3D labs (Explore + Pathology simulator), live 12-lead ===== */
(function(){
"use strict";
const {STRUCT,SC,TERR,VESSEL,MI_TEXT,WALLNAME}=CONTENT;
const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
/* Preserve the legacy timing provider, including full floating-point precision. */
const ONSET={};
for(const mode in CS.VMODES){
  const t=CS.ventGraph(mode);let m=Infinity;
  for(const id in CS.N){const n=CS.N[id];if(n.side==='V'&&n.purk&&isFinite(t[id]))m=Math.min(m,t[id])}
  if(CS.VMODES[mode].focus)m=0;
  ONSET[mode]=mode==='wpw'?0:isFinite(m)?m+4:0;
}
const {D0,LEADS,VCG,nrm,g,sstep,bsearch,vecAt,leadVal,buildEvents,curEv}=ECG.init({TA_AVN:CS.TA_AVN,WPW_LEAD:CS.WPW_LEAD,onset:ONSET});

/* ================= scenarios ================= */
function miScenario(terrKey,vesselKey,wall,title){const tr=TERR[terrKey],vs=vesselKey?VESSEL[vesselKey]:null,rh=vs?vs.rh:{type:"sinus",rate:84};
  const cul=vesselKey||tr.culprit,cname=H3.VESSELS[cul]?H3.VESSELS[cul].name:cul;
  return{name:title||(tr.name+(vs&&vs.cond?" + conduction complication":"")),rh,lead:tr.lead,block:[],mi:{terr:terrKey,culprit:cul,walls:tr.walls},hl:leadsOf(tr.leads),
    find:[`ST elevation in ${tr.leads}`,`Reciprocal ST depression: ${tr.recip}`,"Hyperacute T waves; Q waves follow within hours"].concat(vs&&vs.cond?[vs.cond]:[]),
    mech:(vs?vs.note+" ":"")+MI_TEXT.mech,mgmt:MI_TEXT.mgmt,see:SIMC.SEE.mi,
    mean:`Culprit in this model: ${cname}. `+(wall?`You tapped the ${WALLNAME[wall].toLowerCase()}; follow its artery back to the occlusion.`:"Grey vessels downstream of the clot have lost flow; their wall is shaded and no longer depolarises."),
    fx:{view:"ext",look:SIMC.LOOK[terrKey],flow:"coronary",cond:!!(vs&&vs.cond)}}}
function leadsOf(s){const out=[];for(const k of["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]){if(new RegExp("(^|[^A-Za-z0-9])"+k+"([^0-9A-Za-z]|$)").test(s))out.push(k)}
  const m=s.match(/V(\d)–V(\d)/);if(m)for(let i=+m[1];i<=+m[2];i++)if(!out.includes("V"+i))out.push("V"+i);return out}
const ALLSC=Object.assign({},SC,SIMC.EXTRA);
for(const k in SIMC.MIS){const[terr,ves,title]=SIMC.MIS[k];ALLSC[k]=miScenario(terr,ves,null,title)}
for(const k in ALLSC){const s=ALLSC[k];if(!s.see&&SIMC.SEE[k])s.see=SIMC.SEE[k];if(!s.fx)s.fx=SIMC.FX[k]||{}}
SC.normal.see=SIMC.SEE.normal;
const HL={normal:["II","V1"],sinusBrady:["II"],af:["V1","II"],flutter:["II","III","aVF","V1"],avb1:["II"],wenck:["II"],mobitz2:["II","V1"],chbJ:["II"],chbV:["II","V1"],rbbb:["V1","V2","I","V6"],lbbb:["V1","V6","I","aVL"],lafb:["I","aVL","II","III","aVF"],lpfb:["I","aVL","III","aVF"],bifasc:["V1","I","II","aVF"],wpw:["V1","II","I","aVL"],pvc:["II"],rvot:["II","III","aVF","V1"],iab:["II","V1"],sinusArrest:["II"],saExit:["II"]};
for(const k in HL)if(ALLSC[k]&&!ALLSC[k].hl)ALLSC[k].hl=HL[k];

/* ================= instance factory ================= */
const LEADLIST=["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
const TWELVE4=[["I","aVR","V1","V4"],["II","aVL","V2","V5"],["III","aVF","V3","V6"]],TWELVE2=[["I","V1"],["II","V2"],["III","V3"],["aVR","V4"],["aVL","V5"],["aVF","V6"]];
const css=k=>getComputedStyle(document.documentElement).getPropertyValue(k).trim();
const esc=s=>String(s).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]));
function markup(mode){return `
<div class="main"><div class="col">
  <div class="toolbar" role="toolbar" aria-label="Model controls">
    <div class="seg segView" role="group" aria-label="Anatomy view"><button data-v="ext" aria-pressed="true">External</button><button data-v="int" aria-pressed="false">Internal (cut)</button></div>
    <button class="tog bCond" aria-pressed="true">Conduction<span class="st">On</span></button>
    <button class="tog bWave" aria-pressed="true">Wave<span class="st">On</span></button>
    <div class="seg segLabels" role="group" aria-label="Show labels"><button data-l="cond" aria-pressed="true">Conduction labels</button><button data-l="valve" aria-pressed="true">Valve labels</button><button data-l="anat" aria-pressed="true">Anatomy labels</button></div>
    <button class="tog bRel" aria-pressed="${mode==="sim"}" title="Show only the labels that matter for the chosen condition">Relevant labels only<span class="st">${mode==="sim"?"On":"Off"}</span></button>
  </div>
  <div class="viewer" aria-label="Rotatable 3D heart. Drag to rotate; tap structures for details.">
    <div class="labels"></div><div class="tip" hidden></div><div class="busy" hidden>Building mesh…</div>
    <div class="hint">${mode==="sim"?"Pick a condition → watch the mechanism":"Drag to rotate · tap to explore"}</div>
    <div class="legend" aria-hidden="true"><span>depolarising<i style="background:#ffd34d"></i></span><span>conduction<i style="background:#22c3ab"></i></span><span>block<i style="background:#ff3b3b"></i></span></div>
  </div>
  <div class="views" role="group" aria-label="Viewpoints"><button data-v="Front">Front</button><button data-v="Back">Back</button><button data-v="Left">Left side</button><button data-v="Right">Right side</button><button data-v="Below">Below</button><button data-v="Cut">Face the cut</button></div>
  <section class="card ecgcard" aria-label="ECG">
    <div class="ecghead"><div class="rname"></div><div class="reads"><span>HR <b class="rHR">–</b></span><span>PR <b class="rPR">–</b> ms</span><span>QRS <b class="rQRS">–</b> ms</span></div></div>
    <div class="phase"><span data-k="P">P</span><span data-k="PR">PR</span><span data-k="QRS">QRS</span><span data-k="ST">ST</span><span data-k="T">T</span><span class="phaseTxt"></span></div>
    <div class="ecgwrap"><div class="strip"><canvas class="ecg1" role="img" aria-label="Lead II rhythm strip"></canvas></div><div class="strip"><canvas class="ecg2" role="img" aria-label="Selected lead"></canvas></div></div>
    <div class="leadrow"><span class="glabel">Second strip: <b class="lead2name">V1</b></span><div class="seg leads" role="group" aria-label="Choose lead"></div></div>
    <div class="leadrow play"><button class="bPlay">❚❚ Pause</button>
      <div class="seg segSpeed" role="group" aria-label="Speed"><button data-s="0.125" aria-pressed="false">⅛×</button><button data-s="0.25" aria-pressed="true">¼×</button><button data-s="0.5" aria-pressed="false">½×</button><button data-s="1" aria-pressed="false">1×</button></div>
      <button class="bNormal">Reset to normal</button></div>
    <div class="twhead"><span class="glabel">Live 12-lead</span><span class="twnote">highlighted leads carry the key finding</span></div>
    <div class="twelve"><canvas class="ecg12" role="img" aria-label="Twelve-lead ECG"></canvas></div>
    <p class="foot">25 mm/s, 10 mm/mV in simulated time; slow motion stretches the 3D model and every strip together. Idealized teaching drawings generated from the model's activation timing.</p>
  </section>
</div><aside class="card panel" aria-live="polite"></aside></div>`}

function createLab(root,mode){
  root.innerHTML=markup(mode);
  const q=s=>root.querySelector(s),qa=s=>Array.from(root.querySelectorAll(s));
  const host=q(".viewer"),tipEl=q(".tip"),labelLayer=q(".labels"),panel=q(".panel");
  const S=HeartScene(host,{pick:onPick,hover:onHover,prePick,noHover:true,frame:onFrame,beat:beatFn});
  if(!S)host.innerHTML='<p class="fallback">WebGL is not available in this browser, so the 3D model cannot be drawn. The ECG and notes still work.</p>';
  const T=S?S.T:null;
  const st={view:"ext",cond:true,wave:true,labels:true,playing:!reduced,speed:.25,simT:0,lastNow:0,lead2:"V1",sc:null,ctx:null,hocm:false};
  const cx={ev:{A:[],V:[],cont:null,cl:200,end:1},ST:null,pAmp:1};
  let valves=null;

  /* ---------- conduction system meshes ---------- */
  const tubes=[],pickables=[],blockRings=[];let condG=null,saMesh=null,avnMesh=null;
  const COL={base:[.13,.74,.66],hot:[1,.97,.72],after:[.42,.95,.86],dead:[.75,.18,.2],ap:[.95,.55,.95]};
  if(S){
    condG=new T.Group();S.root.add(condG);
    const R={tract:.013,bach:.022,cs:.011,ine:.014,avn:.034,his:.026,bb:.019,fasc:.015,mod:.018,purk:.0065,ap:.02};
    const mat=new T.MeshBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false,transparent:true,opacity:.96});
    const pmat=new T.MeshBasicMaterial({vertexColors:true,depthTest:false,depthWrite:false,transparent:true,opacity:.72});
    const pickMat=new T.MeshBasicMaterial({visible:false});
    for(const e of CS.E){if(e.kind==="sa")continue;
      const curve=new T.CatmullRomCurve3(e.pts.map(p=>new T.Vector3(...p)),false,"centripetal"),segs=Math.max(6,Math.ceil(e.L/.025)),rad=6;
      const geo=new T.TubeGeometry(curve,segs,R[e.kind],rad,false),n=geo.attributes.position.count,col=new Float32Array(n*3),uu=new Float32Array(n);
      for(let i=0;i<n;i++)uu[i]=Math.floor(i/(rad+1))/segs;geo.setAttribute("color",new T.BufferAttribute(col,3));
      const m=new T.Mesh(geo,e.kind==="purk"?pmat:mat);m.renderOrder=e.kind==="purk"?4:6;condG.add(m);tubes.push({e,geo,col,uu,m});
      const pk=new T.Mesh(new T.TubeGeometry(curve,segs,e.kind==="purk"?.016:Math.max(.045,R[e.kind]*2.2),5,false),pickMat);pk.userData.struct=e.struct;condG.add(pk);pickables.push(pk)}
    const saC=new T.CatmullRomCurve3(["SA_H","SA","SA_T"].map(k=>new T.Vector3(...CS.N[k].pos)));
    saMesh=new T.Mesh(new T.TubeGeometry(saC,16,.042,10,false),new T.MeshBasicMaterial({color:0x22c3ab,depthTest:false,transparent:true}));saMesh.renderOrder=7;condG.add(saMesh);
    [CS.N.SA_H.pos,CS.N.SA_T.pos].forEach(p=>{const c=new T.Mesh(new T.SphereGeometry(.042,10,8),saMesh.material);c.position.set(...p);c.renderOrder=7;condG.add(c)});
    avnMesh=new T.Mesh(new T.SphereGeometry(.06,16,12),new T.MeshBasicMaterial({color:0x22c3ab,depthTest:false,transparent:true}));avnMesh.scale.set(1.3,.8,.9);avnMesh.position.set(...CS.N.AVN.pos);avnMesh.renderOrder=7;condG.add(avnMesh);
    const sp=(p,r,s)=>{const m=new T.Mesh(new T.SphereGeometry(r,8,6),pickMat);m.position.set(...p);m.userData.struct=s;condG.add(m);pickables.push(m)};
    sp(CS.N.SA.pos,.1,"sa");sp(CS.N.SA_H.pos,.08,"sa");sp(CS.N.SA_T.pos,.08,"sa");sp(CS.N.AVN.pos,.09,"avn");
    for(let i=0;i<2;i++){const r=new T.Mesh(new T.TorusGeometry(.075,.014,8,28),new T.MeshBasicMaterial({color:0xff3b3b,depthTest:false,transparent:true}));r.renderOrder=9;r.visible=false;condG.add(r);blockRings.push(r)}
    valves=HeartValves(S);
  }
  const BLOCKPOS={SA:CS.N.SA.pos,AVN:CS.N.AVN.pos,HIS:CS.lerp(CS.N.HIS.pos,CS.N.BIF.pos,.5),RB1:CS.lerp(CS.N.BIF.pos,CS.N.RB1.pos,.6),LB1:CS.lerp(CS.N.BIF.pos,CS.N.LB1.pos,.6),LAF1:CS.lerp(CS.N.LB1.pos,CS.N.LAF1.pos,.5),LPF1:CS.lerp(CS.N.LB1.pos,CS.N.LPF1.pos,.5),BB1:CS.N.BB1.pos};
  function setBlocks(list){blockRings.forEach((r,i)=>{const k=list[i];r.visible=!!k;if(k)r.position.set(...BLOCKPOS[k])})}

  /* ---------- pericardium / effusion shells ---------- */
  const shells={};
  function shellMesh(kind){if(shells[kind])return shells[kind];const off=kind==="eff"?.24:.1;
    const m=H3.mesh(p=>{const lv=H3.rc(p,H3.LV_B,H3.LV_A,.66,.27),rv=H3.rc(p,H3.RV_B,H3.RV_A,.54,.2);return Math.min(lv,rv)-off-(p[1]>.55?(p[1]-.55)*.1:0)},.07),geo=new T.BufferGeometry();
    geo.setAttribute("position",new T.BufferAttribute(m.pos,3));geo.setIndex(new T.BufferAttribute(m.idx,1));geo.computeVertexNormals();
    const mat=new T.MeshStandardMaterial({color:kind==="eff"?0xe9d97a:0xd8402c,transparent:true,opacity:kind==="eff"?.28:.3,side:T.DoubleSide,depthWrite:false,roughness:.5,emissive:kind==="eff"?0x2a2408:0x3a0804});
    const mesh=new T.Mesh(geo,mat);mesh.renderOrder=3;mesh.visible=false;S.root.add(mesh);return shells[kind]=mesh}

  /* ---------- labels ---------- */
  /* every label: [text, position, category (cond|valve|anat), key, view class, onlyWhenRelevant] */
  const RPM=H3.RPM(),MODB=H3.MODB(),N=id=>CS.N[id].pos;
  const LABS=[["SA node",N("SA"),"cond","SA"],["AV node",N("AVN"),"cond","AVN"],["His",N("BIF"),"cond","HIS"],["Bachmann's",N("BB1"),"cond","BACH"],["RBB",N("RB2"),"cond","RBB"],["LBB",N("LB1"),"cond","LBB"],["LAF",N("LAF2"),"cond","LAF"],["LPF",N("LPF2"),"cond","LPF"],["Purkinje",N("LVAP"),"cond","PURK"],["Accessory pathway",N("AP_A"),"cond","AP"],["Crista terminalis",N("CT1"),"cond","CT"],
    ["Mitral valve",[.36,.5,-.36],"valve","MV","intonly"],["Tricuspid valve",[-.6,.36,.12],"valve","TV","intonly"],["Aortic valve",[-.2,.66,.04],"valve","AV","intonly"],["Pulmonary valve",[.1,.82,.32],"valve","PV","intonly"],
    ["RA",[-1.12,.95,.12],"anat","RA"],["LA",[.7,1.12,-.55],"anat","LA"],["RV",[-.38,-.12,.66],"anat","RV"],["LV",[.88,-.35,.2],"anat","LV"],["Aorta",[-.12,1.55,.12],"anat","AO","extonly"],["Pulm. trunk",[.42,1.32,.2],"anat","PT","extonly"],["SVC",[-.74,1.8,-.05],"anat","SVC","extonly"],["IVC",[-.74,-.16,-.2],"anat","IVC","extonly"],["LAA",H3.LAA[3],"anat","LAA","extonly"],["Pulmonary veins",[1.12,.9,-.86],"anat","PVS","extonly"],["RVOT",[.06,.4,.64],"anat","RVOT","extonly"],
    ["LVOT",[.08,.4,.0],"anat","LVOT","intonly"],["Ascending aorta",[-.12,1.18,0],"anat","AO","intonly"],["LAA",H3.LAA[1],"anat","LAA","intonly"],["Papillary muscle",H3.PM_AL[0],"anat","PAP","intonly"],["Moderator band",CS.lerp(MODB[0],MODB[1],.5),"anat","MOD","intonly"],["Pectinate muscles",[-1.0,.7,-.05],"anat","PECT","intonly"],
    ["Septal bulge",CS.lerp(H3.sL(.24),[.3,.3,-.2],.25),"anat","SEPT","intonly",1],["Inflamed pericardium",[-.95,-.25,.55],"anat","PERI","",1],["Pericardial effusion",[-1.05,-.35,.55],"anat","EFF","",1]];
  const labelEls=[];let culpritLab=null;
  if(S){for(const[t,p,cat,key,vc,only]of LABS){const el=document.createElement("span");el.className=`lab ${cat==="cond"?"cond":cat==="valve"?"anat valve":"anat"} ${vc||""}`;el.textContent=t;labelLayer.appendChild(el);S.addLabel(el,p);labelEls.push({el,cat,key,only})}
    const el=document.createElement("span");el.className="lab culprit";labelLayer.appendChild(el);culpritLab={el,entry:S.addLabel(el,[0,-9,0])};el.hidden=true}
  const labCats={cond:true,valve:true,anat:true};st.rel=mode==="sim";
  const REL={normal:["SA","AVN","HIS","RA","LA","RV","LV","MV","AV"],sinusBrady:["SA","RA"],sinusArrest:["SA","AVN","RA"],saExit:["SA","RA"],iab:["BACH","LA","RA","SA"],
    af:["LA","LAA","PVS","AVN"],flutter:["TV","RA","CT","AVN","IVC"],avb1:["AVN","HIS","SA","TV"],wenck:["AVN","HIS","SA","TV"],chbJ:["AVN","HIS","SA"],mobitz2:["AVN","HIS","RBB","LBB"],chbV:["AVN","HIS","RBB","LBB","PURK"],
    rbbb:["RBB","LBB","HIS","RV","LV"],lbbb:["LBB","LAF","LPF","RBB","LV"],lafb:["LAF","LPF","LBB","LV"],lpfb:["LAF","LPF","LBB","LV"],bifasc:["RBB","LAF","LPF","HIS"],
    wpw:["AP","AVN","LA","LV","MV"],pvc:["PURK","LV","AVN"],rvot:["RVOT","PT","RV","PV"],peri:["PERI","RA","LV","RV"],tamp:["EFF","RV","LV","RA"],hocm:["SEPT","LVOT","MV","AV","PAP","LA","LV"]};
  const TERRREL={ANT:["LV","RV","AO"],ANTSEP:["LV","RV","RBB","LAF"],APEX:["LV"],HILAT:["LV","LA"],LAT:["LV","LA","LAA"],INF:["LV","RV","AVN"],POST:["LV","LA"],RV:["RV","LV","RA","AVN"],LM:["LV","AO","LA"]};
  function relevantSet(){const sc=st.sc;if(!sc)return null;const k=Object.keys(ALLSC).find(x=>ALLSC[x]===sc);let r=REL[k];if(!r&&sc.mi)r=TERRREL[sc.mi.terr];if(!r&&k==null&&sc.mi)r=TERRREL[sc.mi.terr];return r?new Set(r):null}
  function updateLabels(){const rel=relevantSet();for(const L of labelEls){let vis=labCats[L.cat];if(L.only)vis=vis&&!!rel&&rel.has(L.key);else if(st.rel&&rel)vis=vis&&rel.has(L.key);L.el.classList.toggle("off",!vis)}
    if(culpritLab){const mi=st.sc&&st.sc.mi;culpritLab.el.hidden=!(mi&&labCats.anat);if(mi){const v=S.vessels[mi.culprit];if(v){const p=v.userData.curve.getPoint(mi.culprit==="LM"?.72:.42);culpritLab.entry.pos.copy(p);culpritLab.el.textContent="Clot: "+H3.VESSELS[mi.culprit].name}}}}

  /* ---------- picking ---------- */
  function prePick(ray){if(valves&&valves.grp.visible){const h=ray.intersectObjects(valves.pickers.concat([valves.ghost]),false)[0];
      if(h&&(!st.cond||true)){const condHit=st.cond&&condG?ray.intersectObjects(pickables,false).find(x=>x.object.userData.struct!=="purk"):null;if(!condHit||condHit.distance>h.distance+.3)return{valve:h.object.userData.valve,label:h.object.userData.label}}}
    if(!st.cond||!condG)return null;const hits=ray.intersectObjects(pickables,false);if(!hits.length)return null;
    const non=hits.find(h=>h.object.userData.struct!=="purk");const h=non||hits[0];return{struct:h.object.userData.struct}}
  function classifyOther(p){if(!p)return null;if(NEO&&NEO.active){const nc=NEO.classify(p);if(nc!==undefined)return nc}/*NEO-HOOK*/
    if(Math.hypot(p[0]-H3.LAA[2][0],p[1]-H3.LAA[2][1],p[2]-H3.LAA[2][2])<.25||Math.hypot(p[0]-H3.LAA[1][0],p[1]-H3.LAA[1][1],p[2]-H3.LAA[1][2])<.2)return{valveKey:"laa"};
    if(p[0]<-.55&&p[1]>1.25)return{name:"Superior vena cava",note:"A great vein with no working myocardium. The SA node lies at its junction with the right atrium."};
    if(p[0]<-.55&&p[1]<.35)return{name:"Inferior vena cava",note:"Its junction with the RA bounds the cavotricuspid isthmus, the narrow gate of typical flutter."};
    if(Math.hypot(p[0]+.1,p[2])<.33&&p[1]>.62)return{name:"Aorta",note:"Ascending aorta, arch and its branches. The aortic root sits between the mitral and tricuspid valves; the His bundle runs just under the non-coronary cusp."};
    if(p[2]>.1&&p[1]>.75&&p[0]>-.3)return{name:"Pulmonary trunk",note:"Arises from the conus arteriosus of the RV. The muscular RVOT just below the pulmonary valve is a common source of idiopathic VT."};
    if(p[0]>-.1&&p[2]<-.25)return{struct:"la"};
    if(p[0]<-.2)return{struct:"tracts"};
    return null}
  function onPick(h){if(!h)return;
    if(h.valve){const n=SIMC.VALVENOTE[h.valve];st.ctx={type:"note",o:{name:h.label||n.name,note:n.note}};renderPanel();return}
    if(mode==="sim"){/* in the simulator, taps only explain anatomy */
      let o=null;if(h.struct)o={name:STRUCT[h.struct].name,note:STRUCT[h.struct].anat};else if(h.vessel)o={name:H3.VESSELS[h.vessel].name,note:VESSEL[h.vessel].note};else if(h.region)o={name:WALLNAME[h.region],note:"Ventricular myocardium. Pick an MI condition to see what happens when its artery occludes."};else{const c=classifyOther(h.point);if(c)o=c.valveKey?SIMC.VALVENOTE[c.valveKey]:c.struct?{name:STRUCT[c.struct].name,note:STRUCT[c.struct].anat}:c}
      if(o){tipNote=o;renderPanel()}return}
    if(h.struct)return selectStruct(h.struct);
    if(h.vessel){const k=h.vessel,vs=VESSEL[k];setScenario(miScenario(vs.terr,k),{type:"vessel",key:k});return}
    if(h.region){const r=h.region;if(r==="RV"&&h.point&&h.point[1]>.28)return selectStruct("rvot");setScenario(miScenario(r,null,r),{type:"wall",key:r});return}
    const o=classifyOther(h.point);if(o&&o.valveKey){const n=SIMC.VALVENOTE[o.valveKey];st.ctx={type:"note",o:n};renderPanel();return}if(o&&o.struct)return selectStruct(o.struct);if(o){st.ctx={type:"note",o};renderPanel()}}
  let tipNote=null;
  function onHover(h,e){if(!h||!e){tipEl.hidden=true;return}let t="";
    if(h.valve)t=h.label;else if(h.struct)t=STRUCT[h.struct].name;else if(h.vessel)t=H3.VESSELS[h.vessel].name;else if(h.region)t=(h.region==="RV"&&h.point&&h.point[1]>.28)?"RV outflow tract":WALLNAME[h.region];else{const o=classifyOther(h.point);t=o?(o.valveKey?SIMC.VALVENOTE[o.valveKey].name:o.struct?STRUCT[o.struct].name:o.name):""}
    if(!t){tipEl.hidden=true;return}const r=host.getBoundingClientRect();tipEl.textContent=t;tipEl.hidden=false;tipEl.style.transform=`translate(${Math.min(e.clientX-r.left+12,r.width-180)}px,${e.clientY-r.top+12}px)`}
  function selectStruct(k){const s=STRUCT[k];setScenario(ALLSC[s.sc[0]],{type:"struct",key:k})}

  /* ---------- scenario application ---------- */
  function setScenario(sc,ctx){st.sc=sc;st.ctx=ctx||{};tipNote=null;cx.ev=buildEvents(sc.rh,sc);st.simT=0;
    cx.ST=null;if(sc.mi){const tr=TERR[sc.mi.terr];cx.ST={d:nrm(tr.st),a:tr.a,tallR:!!tr.tallR}}
    if(sc.peri)cx.ST={d:nrm([.45,.75,.45]),a:.17,peri:true};
    cx.pAmp=sc.tamp?.6:1;
    if(sc.lead)setLead2(sc.lead==="II"?"V1":sc.lead);
    if(S){S.setCulprit(sc.mi?sc.mi.culprit:null);setBlocks(sc.block||[]);applyFx(sc.fx||{})}
    renderPanel();updateReadouts(true);updateLabels()}
  function setCond(on){st.cond=on;q(".bCond").setAttribute("aria-pressed",on);q(".bCond .st").textContent=on?"On":"Off";if(condG)condG.visible=on;labelLayer.classList.toggle("nocond",!on)}
  function applyFx(fx){const wantHocm=!!fx.hocm;if(mode==="sim")setCond(fx.cond!==false);
    if(mode==="sim"&&fx.view&&(fx.view!==st.view||wantHocm!==st.hocm))setView(fx.view,{hocm:wantHocm,look:fx.look});
    else if(mode==="sim"&&fx.look)S.lookFrom(fx.look);
    else if(mode==="sim"&&fx.view)S.lookFrom(fx.view==="int"?H3.CUTN:[.25,.1,1]);
    else if(st.hocm&&!wantHocm)setView(st.view,{hocm:false});
    else applyInfarct();
    for(const k of["peri","eff"])if(shells[k])shells[k].visible=false;if(fx.shell)shellMesh(fx.shell).visible=true;
    setFlowFx(fx.flow)}
  const VPATH=k=>H3.VESSELS[k].pts;
  function setFlowFx(kind){const spd=st.speed;let f=null;
    const PV=[[.52,.98,-.74],[.52,.8,-.78],[.04,.98,-.76],[.04,.8,-.8]];
    if(kind==="pv")f={col:0xffe066,n:44,speed:1.6*spd*4,size:.8,fn:(u,i)=>{const o=PV[Math.floor(i*4)%4],a=i*97.3,b=i*41.1,r=.04+u*.22;return[o[0]+Math.cos(a)*Math.sin(b)*r*.6+(o[0]>.3?.05:-.05)*u,o[1]+Math.sin(a)*r*.6,o[2]+Math.cos(b)*r*.5+u*.12]}};
    else if(kind==="flutterLoop"){const C=valves.TC,n0=nrm([.544,-.762,.353]),e1=nrm([n0[1],-n0[0],0]),e2=[n0[1]*e1[2]-n0[2]*e1[1],n0[2]*e1[0]-n0[0]*e1[2],n0[0]*e1[1]-n0[1]*e1[0]];
      f={col:0xff7a3d,n:56,speed:(1000/200)*spd,size:.9,fn:(u)=>{const a=-u*Math.PI*2,r=.33;return[C[0]+(e1[0]*Math.cos(a)+e2[0]*Math.sin(a))*r-n0[0]*.08,C[1]+(e1[1]*Math.cos(a)+e2[1]*Math.sin(a))*r-n0[1]*.08,C[2]+(e1[2]*Math.cos(a)+e2[2]*Math.sin(a))*r-n0[2]*.08]}}}
    else if(kind==="ap")f={pts:CS.APE.pts,col:0xff8cff,n:24,speed:1.2*spd*4,jit:.012,size:.9};
    else if(kind==="coronary"&&st.sc&&st.sc.mi){const pts=[];for(const k of upstream(st.sc.mi.culprit))pts.push(...VPATH(k));const cut=Math.max(2,Math.round(pts.length*.86));f={pts:pts.slice(0,cut),col:0xff2a2a,n:34,speed:.55*spd*4,jit:.012,size:.75}}
    else if(kind==="peri"){f={col:0xffb36b,n:60,speed:.5*spd*4,size:.75,fn:(u,i,t)=>{const a=i*12.9898*7,b=i*78.233*3,d=[Math.cos(a)*Math.sin(b),Math.cos(b)*.9,Math.sin(a)*Math.sin(b)],r=.98+.04*Math.sin(t*6+i*9);return[.15+d[0]*r*.95,-.15+d[1]*r*1.1,.08+d[2]*r*.85].map((v,j)=>v+(Math.sin(u*Math.PI*2+i)*.01))}}}
    else if(kind==="eff"){f={col:0xfff0a0,n:60,speed:.12*spd*4,size:.6,fn:(u,i,t)=>{const a=i*2.399+u*6.28,b=1.2+Math.sin(i*1.7)*.9,r=1.12;return[.15+Math.cos(a)*Math.sin(b)*r,-.2+Math.cos(b)*r*1.05,.08+Math.sin(a)*Math.sin(b)*r*.9]}}}
    else if(kind==="lvot"){const A=H3.cAx(.55),B=[.08,.42,-.02],Cc=valves.AOC,Dd=[-.12,1.2,.01],M1=valves.MC,LA=[.32,.9,-.62];
      f={col:0xff5b5b,n:60,speed:1.1*spd*4,size:.8,fn:(u,i,t)=>{const lerp=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];const sys=sysPhase();if(sys<=0)return[0,-9,0];
        if(i<.7){const p=u<.35?lerp(A,B,u/.35):u<.55?lerp(B,Cc,(u-.35)/.2):lerp(Cc,Dd,(u-.55)/.45),j=u>.4?.06*(u-.4):0;return[p[0]+Math.sin(i*91+t*20)*j,p[1],p[2]+Math.cos(i*57+t*17)*j]}
        const p=u<.4?lerp(A,M1,u/.4):lerp(M1,LA,(u-.4)/.6),j=.05*u;return[p[0]+Math.sin(i*71+t*15)*j,p[1],p[2]+Math.cos(i*33+t*13)*j]}}}
    S.setFlow(f)}
  function upstream(seg){const P={LADp:["LM","LADp"],LADm:["LM","LADp","LADm"],LADd:["LM","LADp","LADm","LADd"],D1:["LM","LADp","D1"],LCxp:["LM","LCxp"],LCxd:["LM","LCxp","LCxd"],OM:["LM","LCxp","OM"],PL:["LM","LCxp","LCxd","PL"],RCAp:["RCAp"],RCAm:["RCAp","RCAm"],RCAd:["RCAp","RCAm","RCAd"],AM:["RCAp","AM"],PDA:["RCAp","RCAm","RCAd","PDA"],LM:["LM"]};return P[seg]||[seg]}
  function sysPhase(){const v=curEv(cx.ev,st.simT).v;if(!v||!v.qrs)return 0;const tv=st.simT-v.t-v.on;return tv>60&&tv<330?1:0}

  /* ---------- per-frame updates ---------- */
  function act(dt,apd){if(dt<0||dt>apd+80)return 0;if(dt<30)return 1-dt/30*.7;if(dt<apd)return .3;return .3*(1-(dt-apd)/80)}
  let infMask=null,flPhase=null,flMesh=null;
  function applyInfarct(){const mesh=S&&S.currentMesh();if(!mesh)return;const ud=mesh.userData,col=mesh.geometry.attributes.color;if(!ud.col0)ud.col0=col.array.slice();col.array.set(ud.col0);
    const walls=st.sc&&st.sc.mi?new Set(st.sc.mi.walls.map(w=>S.REG_I[w])):null;infMask=new Uint8Array(ud.reg.length);
    if(walls){for(let i=0;i<ud.reg.length;i++)if(walls.has(ud.reg[i])){infMask[i]=1;col.array[i*3]=ud.col0[i*3]*.55+.16;col.array[i*3+1]=ud.col0[i*3+1]*.55+.12;col.array[i*3+2]=ud.col0[i*3+2]*.55+.2}}
    col.needsUpdate=true}
  function flutterPhase(mesh){if(flMesh===mesh)return flPhase;const pos=mesh.geometry.attributes.position.array,n=pos.length/3,cls=CS.classify(mesh),ph=new Float32Array(n);
    const c=[-.62,.52,.02],ax=nrm([.3,-.35,.4]),u=nrm([0,1,0].map((v,i)=>v-ax[i]*ax[1])),w=[ax[1]*u[2]-ax[2]*u[1],ax[2]*u[0]-ax[0]*u[2],ax[0]*u[1]-ax[1]*u[0]];
    for(let i=0;i<n;i++){if(cls[i]!==1)continue;const p=[pos[i*3]-c[0],pos[i*3+1]-c[1],pos[i*3+2]-c[2]];
      if(pos[i*3]<-.15)ph[i]=((Math.atan2(p[0]*w[0]+p[1]*w[1]+p[2]*w[2],p[0]*u[0]+p[1]*u[1]+p[2]*u[2])/(2*Math.PI))+1)%1;
      else ph[i]=(.55+Math.hypot(pos[i*3]+.05,pos[i*3+1]-1.1,pos[i*3+2]+.3)*.55)%1}
    flMesh=mesh;return flPhase=ph}
  let lastWaveOff=false;
  function updateMuscle(t,ce){const mesh=S.currentMesh();if(!mesh)return;const attr=mesh.geometry.attributes.aInf,arr=attr.array,n=arr.length,ev=cx.ev;
    if(!st.wave){if(!lastWaveOff){arr.fill(0);attr.needsUpdate=true;lastWaveOff=true}return}lastWaveOff=false;
    const cls=CS.classify(mesh);const a=ce.a,v=ce.v;
    let am=null,nowA=0;if(!ev.cont&&a&&(a.mode==="sinus"||a.mode==="iab")){am=CS.aMap(mesh,a.mode).t;nowA=t-a.t}
    let vm=null,nowV=0;if(v&&v.mode!=="hisOnly"){vm=CS.vMap(mesh,v.mode,v.his).t;nowV=t-v.t}
    const pos=mesh.geometry.attributes.position.array;let fp=null;if(ev.cont==="flutter")fp=flutterPhase(mesh);
    const k1=[3.1,1.2,-2.2],k2=[-1.4,2.8,1.9],k3=[1.9,-2.4,2.9];
    for(let i=0;i<n;i++){const c=cls[i];let val=0;
      if(c===2){if(vm&&!(infMask&&infMask[i]))val=act(nowV-vm[i],270)}
      else if(c===1){if(am)val=act(nowA-am[i],150);
        else if(fp){const dt=((t/ev.cl-fp[i])%1+1)%1*ev.cl;val=act(dt,110)}
        else if(ev.cont==="af"){const x=pos[i*3],y=pos[i*3+1],z=pos[i*3+2];let m=0;
          for(const[k,p,o]of[[k1,131,0],[k2,157,.3],[k3,173,.6]]){const f=((x*k[0]+y*k[1]+z*k[2])*.5+t/p+o+Math.sin(t/900+x*3)*.3)%1;const ff=f<0?f+1:f;if(ff<.16)m=Math.max(m,1-ff/.16*.6)}val=m*.9}}
      arr[i]=val}
    attr.needsUpdate=true}
  const mix=(a,b,k)=>[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k];
  function colorAt(dt){if(!(dt>=0))return COL.base;if(dt<40)return mix(COL.after,COL.hot,1-dt/40);if(dt<260)return mix(COL.base,COL.after,1-(dt-40)/220);return COL.base}
  function edgeTimes(e,ce,t){const a=ce.a,v=ce.v,ev=cx.ev;
    if(e.side==="A"){if(!a)return null;const tm=CS.atrialTimes(ev.cont?"avnOnly":a.mode);
      if(e.kind==="avn"){const t0=tm.AVN;if(!isFinite(t0))return null;return[t0,t0+a.d,t-a.t,a.cond?1:a.dieAt]}
      if(e.kind==="ine")return null;return[tm[e.a],tm[e.b],t-a.t,1]}
    if(e.side==="AP"){if(!v||v.mode!=="wpw")return null;const tA=v.from?v.from.t:v.t-100,t0=CS.atrialTimes("sinus").AP_A;return[t0,v.t-tA,t-tA,1]}
    if(!v)return null;const tm=CS.ventGraph(v.mode),off=v.his||0;return[tm[e.a]+off,tm[e.b]+off,t-v.t,1]}
  function updateTubes(t,ce){const vmode=ce.v?ce.v.mode:"normal",blk=new Set((CS.VMODES[vmode]||{}).blk||[]);
    for(const tb of tubes){const e=tb.e,et=edgeTimes(e,ce,t),col=tb.col,uu=tb.uu,n=uu.length;
      const isBlk=e.side==="V"&&blk.has(e.struct)&&!(vmode==="vesc"||vmode==="pvc"||vmode==="rvot");
      for(let i=0;i<n;i++){let c;if(!et)c=isBlk?COL.dead:COL.base;else{const u=uu[i],[t0,t1,now,dieAt]=et;
          if(u>dieAt+1e-6)c=COL.dead;else{const T0=isFinite(t0)?t0:Infinity,T1=isFinite(t1)?t1:Infinity;let tt;
            if(e.kind==="avn"||e.side==="AP")tt=T0+u*(T1-T0);else tt=Math.min(T0+u*e.T,T1+(1-u)*e.T);c=isFinite(tt)?colorAt(now-tt):(isBlk?COL.dead:COL.base)}}
        col[i*3]=c[0];col[i*3+1]=c[1];col[i*3+2]=c[2]}
      if(e.side==="AP"&&!et)for(let i=0;i<n;i++){col[i*3]=COL.ap[0]*.6;col[i*3+1]=COL.ap[1]*.6;col[i*3+2]=COL.ap[2]*.6}
      tb.geo.attributes.color.needsUpdate=true}
    const a=ce.a,ev=cx.ev;let saC=COL.base;if(a&&!ev.cont&&a.mode!=="avnOnly")saC=colorAt(t-a.t);if(ev.cont)saC=mix(COL.base,[.3,.35,.4],.6);saMesh.material.color.setRGB(...saC);
    let avC=COL.base;if(a){const t0=CS.atrialTimes(ev.cont?"avnOnly":a.mode).AVN,dt=t-a.t-t0;if(dt>=0&&dt<a.d+60)avC=mix(COL.after,COL.hot,Math.max(0,.75-dt/(a.d+60)*.6));else avC=colorAt(dt-a.d)}
    avnMesh.material.color.setRGB(...avC)}
  function beatFn(){const v=curEv(cx.ev,st.simT).v;if(!v||!v.qrs)return 0;const x=(st.simT-v.t-v.on-40)/300;const b=x>0&&x<1?Math.pow(Math.sin(Math.PI*x),.8):0;return st.sc&&st.sc.tamp?b*.45:b}
  let swingX=0;
  function updateSwing(ce){const target=st.sc&&st.sc.tamp&&ce.v?(ce.v.swing||0)*.07:0;swingX+=(target-swingX)*.06;S.root.position.x=.02+swingX}

  /* ---------- ECG drawing ---------- */
  const WIN=4000,WIN12=2500,strips=[{cv:q(".ecg1"),lead:"II"},{cv:q(".ecg2"),lead:"V1"}],tw={cv:q(".ecg12")};
  function sizeStrips(){const dpr=Math.min(2,window.devicePixelRatio||1);for(const s of strips){const w=s.cv.parentElement.clientWidth;if(!w)continue;const pxmm=w/(WIN/40),h=Math.round(Math.max(96,Math.min(170,pxmm*22)));
      s.cv.width=Math.round(w*dpr);s.cv.height=Math.round(h*dpr);s.cv.style.width=w+"px";s.cv.style.height=h+"px";Object.assign(s,{w,h,dpr,pxmm});s.cv.parentElement.style.setProperty("--mm",pxmm+"px")}
    const w=tw.cv.parentElement.clientWidth;if(!w)return;const cols=w<560?2:4,cw=w/cols,pxmm=cw/(WIN12/40),rows=12/cols,ch=Math.round(Math.max(64,pxmm*21)),h=ch*rows;
    tw.cv.width=Math.round(w*dpr);tw.cv.height=Math.round(h*dpr);tw.cv.style.width=w+"px";tw.cv.style.height=h+"px";Object.assign(tw,{w,h,dpr,pxmm,cols,rows,cw,ch,layout:cols===4?TWELVE4:TWELVE2});tw.cv.parentElement.style.setProperty("--mm",pxmm+"px")}
  function drawStrips(){const t=st.simT,ev=cx.ev,ink=css("--trace"),acc=css("--accent"),mut=css("--muted"),cursor=css("--cursor"),mono=css("--f-mono");
    const gap=WIN*.035,t0=t-WIN,segStart=Math.floor(t/WIN)*WIN;
    for(const s of strips){if(!s.w)continue;const c=s.cv.getContext("2d");c.setTransform(s.dpr,0,0,s.dpr,0,0);c.clearRect(0,0,s.w,s.h);const ymid=s.h*.6,k=s.pxmm*10;
      c.lineWidth=1.6;c.strokeStyle=ink;c.lineJoin="round";c.beginPath();let pen=false;
      for(let tt=Math.max(0,t0+gap);tt<=t;tt+=4){const x=((tt%WIN)/WIN)*s.w,y=ymid-leadVal(vecAt(cx,tt),s.lead)*k;if(!pen||(tt>=segStart&&tt-4<segStart)){c.moveTo(x,y);pen=true}else c.lineTo(x,y)}
      c.stroke();const cxp=((t%WIN)/WIN)*s.w;c.fillStyle=cursor;c.fillRect(cxp-1,0,2,s.h);c.beginPath();c.arc(cxp,ymid-leadVal(vecAt(cx,t),s.lead)*k,3.2,0,7);c.fillStyle=acc;c.fill();
      if(s===strips[0]){c.font="600 10px "+mono;c.textAlign="center";for(const a of ev.A){if(a.t<t0+gap||a.t>t||!a.p)continue;const x=(((a.t+50)%WIN)/WIN)*s.w;c.fillStyle=a.cond?mut:acc;c.fillText("P",x,12);if(!a.cond)c.fillRect(x-5,8,10,1.5)}
        let pv=null;for(const v of ev.V){const prev=pv;pv=v;const tq=v.t+v.on;if(prev&&prev.mode===v.mode&&v.mode!=="pvc")continue;if(tq<t0+gap||tq>t||!v.qrs)continue;if(v.mode!=="normal"&&v.mode!==(st.sc&&st.sc.rh.vmode||"normal")){const x=(((tq+40)%WIN)/WIN)*s.w;c.fillStyle=acc;c.fillText(v.mode==="pvc"?"PVC":v.mode==="rvot"?"NSVT":v.mode==="vesc"?"escape":"",x,24)}}}
      c.fillStyle=mut;c.font="600 11px "+mono;c.textAlign="left";c.fillText(s.lead,6,s.h-7)}
    /* 12-lead: every lead shows the same 2.5 s window, sweeping in sync */
    if(!tw.w)return;const c=tw.cv.getContext("2d");c.setTransform(tw.dpr,0,0,tw.dpr,0,0);c.clearRect(0,0,tw.w,tw.h);
    const g12=WIN12*.04,a0=t-WIN12+g12,seg12=Math.floor(t/WIN12)*WIN12,samp=[];for(let tt=Math.max(0,a0);tt<=t;tt+=4)samp.push([tt,vecAt(cx,tt)]);const vnow=vecAt(cx,t);
    const k=tw.pxmm*10,hl=new Set(st.sc&&st.sc.hl||[]);c.lineJoin="round";
    tw.layout.forEach((row,ri)=>row.forEach((ld,ci)=>{const x0=ci*tw.cw,y0=ri*tw.ch,ym=y0+tw.ch*.58;
      c.strokeStyle=css("--grid2");c.lineWidth=1;c.strokeRect(x0+.5,y0+.5,tw.cw-1,tw.ch-1);
      c.save();c.beginPath();c.rect(x0,y0,tw.cw,tw.ch);c.clip();c.strokeStyle=ink;c.lineWidth=1.3;c.beginPath();let pen=false;
      for(const[tt,v]of samp){const x=x0+((tt%WIN12)/WIN12)*tw.cw,y=ym-leadVal(v,ld)*k;if(!pen||(tt>=seg12&&tt-4<seg12)){c.moveTo(x,y);pen=true}else c.lineTo(x,y)}
      c.stroke();const xc=x0+((t%WIN12)/WIN12)*tw.cw;c.fillStyle=cursor;c.fillRect(xc-.75,y0,1.5,tw.ch);c.beginPath();c.arc(xc,ym-leadVal(vnow,ld)*k,2.4,0,7);c.fillStyle=acc;c.fill();c.restore();
      const H=hl.has(ld);c.font=(H?"700 ":"600 ")+"11px "+mono;c.textAlign="left";if(H){c.fillStyle=acc;c.fillRect(x0+3,y0+3,c.measureText(ld).width+8,15);c.fillStyle="#fff"}else c.fillStyle=mut;c.fillText(ld,x0+7,y0+14)}))}

  /* ---------- readouts ---------- */
  const PH=qa(".phase span[data-k]");
  function phaseOf(t,ce){const a=ce.a,v=ce.v,ev=cx.ev,ST=cx.ST;let key="base",txt="Diastole: cells at rest, baseline flat; ventricles filling.";
    if(ev.cont==="flutter"){key="P";txt="Flutter wave circling the tricuspid annulus (F waves)"}
    if(ev.cont==="af"){key="P";txt="Chaotic atrial wavelets (fibrillatory baseline)"}
    if(a&&!ev.cont){const r=t-a.t;if(a.mode==="saOnly"&&r<200){key="P";txt="SA node fired, but the impulse is trapped: no P wave"}
      else if(r>=0&&r<115&&a.p){key="P";txt="SA node fires → atria depolarise → P wave"}
      else if(r>=115&&r<CS.TA_AVN+a.d+5){key="PR";txt=a.cond?(ST&&ST.peri?"AV-node delay; atrial injury current depresses the PR segment":"Impulse held in the AV node → flat PR segment"):(a.dieAt<1?"Impulse dies inside the AV node → dropped beat":"Impulse dies below the AV node → dropped beat")}}
    if(v&&v.qrs){const r=t-v.t-v.on,m=VCG[v.mode];if(r>=-v.on&&r<0&&v.his===0){key="PR";txt="His bundle and bundle branches firing (silent on the surface ECG)"}
      else if(r>=0&&r<m.dur){key="QRS";txt=v.mode==="wpw"&&r<45?"Pre-excitation through the accessory pathway → delta wave":v.mode==="hocm"?"Thick septum depolarises first → deep narrow Q, huge voltage":(m.dur>=120?"Slow muscle-to-muscle spread → wide QRS":"His–Purkinje fires the ventricles → narrow QRS; mitral & tricuspid valves close (S1)")}
      else if(r>=m.dur&&r<m.T.c-70){key="ST";txt=ST?(ST.peri?"Plateau with diffuse epicardial injury current → diffuse ST elevation":"Plateau with injury current → ST elevation"):(st.sc&&st.sc.fx&&st.sc.fx.sam?"Ejection: SAM pulls the mitral leaflet into the LVOT":"Plateau (phase 2): ventricles ejecting, aortic valve open")}
      else if(r>=m.T.c-70&&r<m.T.c+70){key="T";txt="Ventricles repolarise → T wave; aortic valve closes (S2)"}}
    return[key,txt]}
  let lastRead=0;
  function updateReadouts(force){const t=st.simT,ce=curEv(cx.ev,t);const[key,txt]=phaseOf(t,ce);PH.forEach(s=>s.classList.toggle("on",s.dataset.k===key));q(".phaseTxt").textContent=txt;
    if(!force&&performance.now()-lastRead<250)return;lastRead=performance.now();
    const iv=ce.iv;let hr="–",pr="–",qrs="–";const qs=[];for(let i=iv;i>=0&&qs.length<2;i--)if(cx.ev.V[i].qrs)qs.unshift(cx.ev.V[i]);
    if(qs.length===2)hr=Math.round(60000/(qs[1].t+qs[1].on-qs[0].t-qs[0].on));const last=qs[qs.length-1];if(last){qrs=VCG[last.mode].dur;if(last.from&&last.from.p)pr=Math.round(last.t+last.on-last.from.t-12)}
    q(".rHR").textContent=hr;q(".rPR").textContent=pr;q(".rQRS").textContent=qrs;q(".rname").textContent=st.sc?st.sc.name:""}

  /* ---------- panel ---------- */
  function scBlock(sc){return `<div class="scard"><h3>${esc(sc.name)}</h3>
    ${sc.see?`<div class="mm see"><b>In the 3D model</b><p>${sc.see}</p></div>`:""}
    <div class="mm"><b>On the ECG</b><ul>${sc.find.map(f=>`<li>${f}</li>`).join("")}</ul></div>
    <div class="mm"><b>Mechanism</b><p>${sc.mech}</p></div><div class="mm"><b>Management</b><p>${sc.mgmt}</p></div>
    <div class="mm pearl"><b>Meaning</b><p>${sc.mean}</p></div></div>`}
  function renderPanel(){let h="";const ctx=st.ctx||{};
    if(mode==="sim"){const cur=Object.keys(ALLSC).find(k=>ALLSC[k]===st.sc);
      h=`<span class="eyebrow">Pathology simulator</span><h2>Choose a condition</h2><p class="small">The model, the activation wave and every ECG lead switch to that condition. Taps on the heart explain anatomy.</p>
      <div class="groups"><div class="grp"><button class="chip ghost${cur==="normal"?" on":""}" data-sc="normal" aria-pressed="${cur==="normal"}">Normal heart</button></div>
      ${SIMC.GROUPS.map(([gname,keys])=>`<div class="grp"><span class="glabel">${gname}</span><div class="chips">${keys.map(k=>`<button class="chip" data-sc="${k}" aria-pressed="${cur===k}">${esc(shortName(k))}</button>`).join("")}</div></div>`).join("")}</div>
      ${tipNote?`<div class="note"><b>${esc(tipNote.name)}</b><p>${esc(tipNote.note)}</p></div>`:""}${scBlock(st.sc)}`}
    else if(ctx.type==="struct"){const s=STRUCT[ctx.key];
      h=`<span class="eyebrow">${esc(s.tag)}</span><h2>${esc(s.name)}</h2><p>${s.anat}</p>
      <table class="phys">${s.phys.map(([a,b])=>`<tr><th>${a}</th><td>${b}</td></tr>`).join("")}<tr><th>Blood supply</th><td>${s.supply}</td></tr></table>
      <div class="glabel">Complications: tap to run on the model and ECG</div><div class="chips">${s.sc.map(k=>`<button class="chip" data-sc="${k}" aria-pressed="${st.sc===ALLSC[k]}">${esc(ALLSC[k].name)}</button>`).join("")}<button class="chip ghost" data-sc="normal">Normal conduction</button></div>${scBlock(st.sc)}`}
    else if(ctx.type==="vessel"||ctx.type==="wall"){const title=ctx.type==="vessel"?H3.VESSELS[ctx.key].name:WALLNAME[ctx.key];
      h=`<span class="eyebrow">${ctx.type==="vessel"?"Coronary artery":"Ventricular wall"}</span><h2>${esc(title)}</h2><p>${ctx.type==="vessel"?esc(VESSEL[ctx.key].note):"Tapping a wall infarcts it: its muscle is shaded and stops depolarising, and the ECG shows the matching injury pattern."}</p>
      <div class="chips"><button class="chip ghost" data-sc="normal">Clear: normal conduction</button></div>${scBlock(st.sc)}`}
    else if(ctx.type==="note"){h=`<span class="eyebrow">Anatomy</span><h2>${esc(ctx.o.name)}</h2><p>${esc(ctx.o.note)}</p><div class="chips"><button class="chip ghost" data-sc="normal">Back to normal conduction</button></div>`}
    else{h=`<span class="eyebrow">Start here</span><h2>Follow one heartbeat</h2>
      <p>Watch the gold wave leave the SA node, crawl through the AV node and flash down the His–Purkinje system while every ECG lead sweeps at the same moment. Switch to <b>Internal</b> to see the valves open and close. <b>Tap any structure, valve, artery or wall</b> to learn it and see what happens when it fails.</p>
      <table class="phys timeline"><tr><th>SA node fires</th><td class="num">0 ms</td></tr><tr><th>Impulse reaches AV node</th><td class="num">${Math.round(CS.TA_AVN)} ms</td></tr><tr><th>Leaves AV node into His</th><td class="num">${Math.round(CS.TA_AVN+D0)} ms</td></tr>
      <tr><th>QRS onset</th><td class="num">${Math.round(CS.TA_AVN+D0+ONSET.normal)} ms</td></tr><tr><th>AV node vs Purkinje velocity</th><td class="num">0.05 vs 2–4 m/s</td></tr></table>
      <div class="glabel">Try one</div><div class="chips">${["wenck","chbV","rbbb","lbbb","wpw","flutter"].map(k=>`<button class="chip" data-sc="${k}" data-st="${SC[k].struct}">${esc(SC[k].name)}</button>`).join("")}</div>${scBlock(SC.normal)}`}
    panel.innerHTML=h;
    panel.querySelectorAll("[data-sc]").forEach(b=>b.onclick=()=>{const k=b.dataset.sc;if(k==="normal"){setScenario(ALLSC.normal,mode==="sim"?{}:{});return}
      if(b.dataset.st){setScenario(ALLSC[k],{type:"struct",key:b.dataset.st});return}setScenario(ALLSC[k],mode==="sim"?{}:st.ctx)})}
  const SHORT={af:"Atrial fibrillation",flutter:"Atrial flutter",avb1:"1st-degree AV block",wenck:"Mobitz I (Wenckebach)",mobitz2:"Mobitz II",chbJ:"Complete block (nodal)",chbV:"Complete block (infranodal)",rbbb:"RBBB",lbbb:"LBBB",lafb:"LAFB",lpfb:"LPFB",bifasc:"Bifascicular",wpw:"WPW",miAnt:"Anterior",miInf:"Inferior + RV",miLat:"Lateral",miPost:"Posterior",miLM:"Left main",peri:"Pericarditis",tamp:"Tamponade",hocm:"HOCM",pvc:"PVC bigeminy",rvot:"RVOT VT"};
  const shortName=k=>SHORT[k]||ALLSC[k].name;

  /* ---------- controls ---------- */
  function setView(v,o){o=o||{};st.view=v;st.hocm=!!o.hocm;qa(".segView button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===v));if(!S)return;
    labelLayer.classList.toggle("int",v==="int");q(".busy").hidden=false;
    setTimeout(()=>{const opt=v==="int"?(st.hocm?{cut:true,hocm:true}:{cut:true}):(st.hocm?{hocm:true}:{});S.showHeart(opt);valves.setVisible(v==="int");applyInfarct();
      S.lookFrom(o.look&&v==="ext"?o.look:v==="int"?H3.CUTN:[.25,.1,1]);q(".busy").hidden=true},30)}
  qa(".segView button").forEach(b=>b.onclick=()=>setView(b.dataset.v,{hocm:st.hocm}));
  q(".bCond").onclick=()=>setCond(!st.cond);
  q(".bWave").onclick=()=>{st.wave=!st.wave;q(".bWave").setAttribute("aria-pressed",st.wave);q(".bWave .st").textContent=st.wave?"On":"Off"};
  qa(".segLabels button").forEach(b=>b.onclick=()=>{const k=b.dataset.l;labCats[k]=!labCats[k];b.setAttribute("aria-pressed",labCats[k]);updateLabels()});
  q(".bRel").onclick=()=>{st.rel=!st.rel;q(".bRel").setAttribute("aria-pressed",st.rel);q(".bRel .st").textContent=st.rel?"On":"Off";updateLabels()};
  q(".bPlay").onclick=()=>{st.playing=!st.playing;syncPlay()};
  function syncPlay(){q(".bPlay").textContent=st.playing?"❚❚ Pause":"▶ Play";q(".bPlay").setAttribute("aria-pressed",!st.playing)}
  qa(".segSpeed button").forEach(b=>b.onclick=()=>{st.speed=+b.dataset.s;qa(".segSpeed button").forEach(x=>x.setAttribute("aria-pressed",x===b));if(S&&st.sc)setFlowFx((st.sc.fx||{}).flow)});
  const VIEWS={Front:[.25,.1,1],Back:[-.1,.05,-1],Left:[1,.1,.05],Right:[-.9,.1,.3],Below:[.05,-1,.1]};
  qa(".views button").forEach(b=>b.onclick=()=>{if(!S)return;const k=b.dataset.v;S.lookFrom(k==="Cut"?H3.CUTN:VIEWS[k])});
  const leadBar=q(".leads");LEADLIST.forEach(k=>{const b=document.createElement("button");b.textContent=k;b.dataset.l=k;b.type="button";b.onclick=()=>setLead2(k);leadBar.appendChild(b)});
  function setLead2(k){st.lead2=k;strips[1].lead=k;q(".lead2name").textContent=k;leadBar.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.l===k))}
  q(".bNormal").onclick=()=>setScenario(ALLSC.normal,{});

  /* ---------- loop ---------- */
  function step(now){const dt=Math.min(100,now-(st.lastNow||now));st.lastNow=now;if(st.playing)st.simT+=dt*st.speed;if(st.simT>cx.ev.end)st.simT=0}
  function onFrame(now){step(now);const ce=curEv(cx.ev,st.simT);updateMuscle(st.simT,ce);if(condG&&st.cond)updateTubes(st.simT,ce);
    if(valves&&valves.grp.visible){const v=ce.v;valves.fromCycle(v&&v.qrs?st.simT-v.t-v.on:null,!!(st.sc&&st.sc.fx&&st.sc.fx.sam))}
    updateSwing(ce);for(const k in shells)if(shells[k].visible)shells[k].material.opacity=(k==="eff"?.26:.22)+(k==="peri"?.12*(.5+.5*Math.sin(now/260)):0);
    blockRings.forEach(r=>{r.quaternion.copy(S.root.quaternion).invert();r.scale.setScalar(1+.18*Math.sin(now/180))});
    drawStrips();updateReadouts(false)}
  let plainRun=false;function plainLoop(now){if(!plainRun)return;step(now);drawStrips();updateReadouts(false);requestAnimationFrame(plainLoop)}
  sizeStrips();new ResizeObserver(()=>sizeStrips()).observe(q(".ecgcard"));
  setLead2("V1");syncPlay();setScenario(ALLSC.normal,{});
  let started=false;
  const api={st,S,setScenario,setView,ALLSC,cx,valves,onPick,start(){if(S){if(!started){S.showHeart({});S.snapView([.25,.1,1]);applyInfarct();started=true}st.lastNow=0;S.start()}else if(!plainRun){plainRun=true;requestAnimationFrame(plainLoop)}},stop(){if(S)S.stop();plainRun=false}};
  return api}

/* ================= boot the lab(s) on this page, render only what is on screen =================
   Each page of the 3D Heart section holds one lab ([data-lab=explore] on 3D Heart, [data-lab=sim] on Pathology).
   The site shell posts {pun:"lab", visible, sub}: visible=false when its iframe is hidden (another page is shown),
   sub = the part after "/" in the route (#pathology/af → "af") to open a scenario directly. */
const labs={},seen={};let shown=true,pendingSub="";
function run(k){const L2=labs[k];if(!L2)return;
  if(shown&&!document.hidden&&seen[k]){L2.start();if(pendingSub&&ALLSC[pendingSub]&&k==="sim"){L2.setScenario(ALLSC[pendingSub],{});pendingSub=""}}else L2.stop()}
function runAll(){for(const k in labs)run(k)}
const io=new IntersectionObserver(es=>{for(const e of es){const k=e.target.dataset.lab;seen[k]=e.isIntersecting;if(!labs[k]&&e.isIntersecting&&shown)labs[k]=createLab(e.target,k);run(k)}},{rootMargin:"120px 0px"});
document.querySelectorAll("[data-lab]").forEach(el=>io.observe(el));
document.addEventListener("visibilitychange",runAll);
window.addEventListener("message",e=>{const d=e.data;if(!d||d.pun!=="lab")return;
  if(typeof d.sub==="string"&&d.sub)pendingSub=d.sub;
  if(typeof d.visible==="boolean")shown=d.visible;
  for(const el of document.querySelectorAll("[data-lab]")){const k=el.dataset.lab;if(!labs[k]&&shown&&seen[k])labs[k]=createLab(el,k)}
  runAll()});
window.LABS=labs;window.LABCORE={ALLSC,vecAt,leadVal,D0,ONSET,createLab};
})();
/* links between the two pages: change the SITE route (parent); opened on its own, fall back to scrolling */
document.querySelectorAll(".jump a").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const go=a.dataset.go;
  if(go){try{if(window.parent&&window.parent!==window&&window.parent.document.querySelector(`.tabs a[data-topic="${go}"]`)){window.parent.location.hash="#"+go;return}}catch(err){}}
  const t=document.querySelector(a.getAttribute("href"));if(t)t.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}));
