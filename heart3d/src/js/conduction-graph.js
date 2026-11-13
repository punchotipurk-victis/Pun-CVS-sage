/* Conduction contract in heart-frame centimetres. No geometry or teaching text lives here. */
(function(){
'use strict';
let spec, nodes, edges, constants, lengths;
let atrialCache=new Map(), ventricularCache=new Map();
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
function load(json){
  spec=json;nodes=json.nodes;edges=json.edges;
  const legacy=json.timing.legacy;
  constants=Object.freeze({TA_AVN:legacy.TA_AVN_ms,D0:Math.round(170-legacy.TA_AVN_ms-22),
    WPW_LEAD:legacy.WPW_LEAD_ms,A_MUSCLE:json.timing.muscleVelocity_mps.atrial,
    V_MUSCLE:json.timing.muscleVelocity_mps.ventricular,JUNCTION_DELAY:4});
  lengths=new Map(edges.map(e=>{const cumulative=[0];for(let i=1;i<e.points.length;i++)
    cumulative.push(cumulative[i-1]+distance(e.points[i-1],e.points[i]));return[e,cumulative]}));
  atrialCache.clear();ventricularCache.clear();return api;
}
function edgeDuration(edge,avDelay=constants.D0){return edge.T_ms==='avDelay'?avDelay:edge.T_ms}
function times(side,sources,blockedStructs=[],avDelay=constants.D0){
  const blocked=new Set(blockedStructs),t=Object.fromEntries(Object.keys(nodes).map(id=>[id,Infinity]));
  const adj={},done=new Set();
  for(const [id,time] of Object.entries(sources)){if(!(id in nodes))throw new Error('Unknown source: '+id);t[id]=time}
  for(const e of edges){
    if(e.circuitOnly||e.T_ms===null||(side&&e.side!==side)||blocked.has('*')||blocked.has(e.struct)||blocked.has(e.id))continue;
    const duration=edgeDuration(e,avDelay);
    (adj[e.a]??=[]).push([e.b,duration]);(adj[e.b]??=[]).push([e.a,duration]);
  }
  for(;;){let next=null,min=Infinity;
    for(const id in t)if(!done.has(id)&&t[id]<min){next=id;min=t[id]}
    if(next===null)break;done.add(next);
    for(const [id,cost] of adj[next]||[])if(min+cost<t[id])t[id]=min+cost;
  }
  return t;
}
function atrialTimes(mode='sinus'){
  if(atrialCache.has(mode))return atrialCache.get(mode);
  const m=spec.modes.atrial[mode];if(!m)throw new Error('Unknown atrial mode: '+mode);
  let sources=Object.fromEntries(Object.entries(m.seed).map(([id,t])=>[id,t==='TA_AVN'?constants.TA_AVN:t]));
  if(mode==='focal')sources={CT1:0};
  // As in CS, these special modes light only their source. The legacy atrial graph
  // has a zero-duration AV edge; the beat-specific delay is added by the playback clock.
  const blocked=(mode==='avnOnly'||mode==='none')?['*']:m.blk||[];
  const t=times('A',sources,blocked,0);atrialCache.set(mode,t);return t;
}
function ventGraph(mode='normal'){
  if(ventricularCache.has(mode))return ventricularCache.get(mode);
  const m=spec.modes.ventricular[mode];if(!m)throw new Error('Unknown ventricular mode: '+mode);
  let sources={HIS:0};
  if(m.focus){const focus=spec.foci[m.focus];let best=null,min=Infinity;
    for(const [id,n] of Object.entries(nodes))if(n.purkinje){const d=distance(n.p,focus.p);if(d<min){best=id;min=d}}
    sources={[best]:focus.retro_ms+min*10/.75};
    // Approved compatibility rule: this sparse graph omits the legacy Purkinje
    // cloud. Existing ectopic modes enter at the earliest retained terminal in
    // the contract's reference timings; new modes use geometric entry above.
    const reference=spec.timing.legacy.ventricularNodeTimes[mode];
    if(reference){const entry=Object.keys(nodes).filter(id=>nodes[id].purkinje&&Number.isFinite(reference[id]))
      .sort((a,b)=>reference[a]-reference[b])[0];
      if(entry)sources={[entry]:reference[entry]};
    }
  }
  const t=times('V',sources,m.blk||[]);ventricularCache.set(mode,t);return t;
}
function edgeTimeAt(edge,u,tNodes,avDelay=constants.D0){
  if(edge.circuitOnly||edge.T_ms===null)return Infinity;
  const duration=edgeDuration(edge,avDelay);
  return Math.min(tNodes[edge.a]+u*duration,tNodes[edge.b]+(1-u)*duration);
}
function pointAt(edge,u){
  const cumulative=lengths.get(edge);if(!cumulative)throw new Error('Edge is not in the loaded graph');
  const total=cumulative[cumulative.length-1],s=Math.max(0,Math.min(1,u))*total;
  if(total===0)return edge.points[0].slice();
  for(let i=1;i<cumulative.length;i++)if(s<=cumulative[i]&&cumulative[i]>cumulative[i-1]){
    const f=(s-cumulative[i-1])/(cumulative[i]-cumulative[i-1]);
    return edge.points[i-1].map((v,k)=>v+(edge.points[i][k]-v)*f);
  }
  return edge.points[edge.points.length-1].slice();
}
const api={load,times,atrialTimes,ventGraph,edgeTimeAt,pointAt,edgeDuration,
  get spec(){return spec},get nodes(){return nodes},get edges(){return edges},get constants(){return constants}};
window.CGRAPH=api;
// In the integrated site the parent holds a single copy, as for the interior mesh.
let data=window.PUN_CONDUCTION;
if(!data&&window.parent!==window)try{data=window.parent.PUN_CONDUCTION}catch(e){}
if(data)load(data);
})();
