/* Dump the legacy conduction graph (h3-anatomy.js + conduction.js) as JSON: node/edge times per mode, foci, QRS onsets.
   Usage: node heart3d/tools/dump_legacy_conduction.js heart3d/src/js > /tmp/legacy.json   (used by make_conduction_spec.py) */
const fs=require('fs'),vm=require('vm');const src=process.argv[2];
const ctx={console,Math,Object,Set,Float32Array,Uint8Array,Int32Array,Uint32Array,Array,JSON,Infinity,isFinite};vm.createContext(ctx);
for(const f of ['h3-anatomy.js','conduction.js'])vm.runInContext(fs.readFileSync(src+'/'+f,'utf8').replace(/^const (H3|CS)=/m,'globalThis.$1='),ctx);
const CS=ctx.CS,out={U:CS.U,TA_AVN:CS.TA_AVN,D0:Math.round(160+10-CS.TA_AVN-22),nodes:{},edges:[],atrial:{},vent:{}};
for(const id in CS.N){const n=CS.N[id];if(/^P[LR]\d/.test(id))continue;out.nodes[id]={side:n.side,pos:n.pos.map(v=>+v.toFixed(3))}}
for(const e of CS.E){if(/^P[LR]\d/.test(e.a)||/^P[LR]\d/.test(e.b))continue;out.edges.push({id:e.id,kind:e.kind,struct:e.struct,L_mm:+(e.L*CS.U).toFixed(1),T_ms:+e.T.toFixed(1)})}
for(const m of ['sinus','iab']){const t=CS.atrialTimes(m),o={};for(const id in out.nodes)if(isFinite(t[id]))o[id]=+t[id].toFixed(1);out.atrial[m]=o}
for(const m of Object.keys(CS.VMODES)){const t=CS.ventGraph(m),o={};for(const id in out.nodes)if(isFinite(t[id]))o[id]=+t[id].toFixed(1);
 const pk=[];for(const id in CS.N)if(/^P[LR]/.test(id)&&isFinite(t[id]))pk.push([id[1],t[id]]);
 const st=s=>{const a=pk.filter(x=>x[0]===s).map(x=>x[1]).sort((a,b)=>a-b);return a.length?[+a[0].toFixed(1),+a[a.length-1].toFixed(1)]:null};
 o._purkLV=st('L');o._purkRV=st('R');out.vent[m]=o}
out.foci={};for(const m in CS.VMODES)if(CS.VMODES[m].focus)out.foci[m]={pos:CS.VMODES[m].focus.map(v=>+v.toFixed(3)),retro:CS.VMODES[m].retro};
out.onset={};for(const m in CS.VMODES){if(m==='wpw'){out.onset[m]=0;continue}const t=CS.ventGraph(m);let mm=Infinity;for(const id in CS.N){const n=CS.N[id];if(n.side==='V'&&n.purk&&isFinite(t[id]))mm=Math.min(mm,t[id])}if(CS.VMODES[m].focus)mm=0;out.onset[m]=isFinite(mm)?+(mm+4).toFixed(1):0}
out.WPW_LEAD=CS.WPW_LEAD;
console.log(JSON.stringify(out,null,1));
