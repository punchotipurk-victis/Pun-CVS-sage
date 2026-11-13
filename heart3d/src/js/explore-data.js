/* ===== 3D HEART (explore page) DATA: label colours, layer groups, structure info =====
   Ids are the phantom label ids (echo-sim/src/engine/phantom.js LABELS), landmark ids (export/heart-landmarks.json),
   or "artery:<id>" / "vein:<id>" for the coronary tree (export/heart-mesh.json vessels).
   Teaching text: mechanism first, short here; full cards (complications, pearls) live in CONTENT / come with step 7. */
const EXPLORE_DATA = (() => {
  /* ---- label colours: an anatomical TINT, not a poster. Muscle stays muscle-red; only the parts whose blood differs are tinted,
     in soft natural tones that blend into each other on the surface (colours are smoothed across the mesh):
     right side (deoxygenated): RA lavender-blue, RV muscle with a cool tint, cavae and PA muted blue
     left side (oxygenated): LA rose, LV muscle red, aorta and pulmonary veins warm red
     valves and fibrous skeleton ivory; IAS a pale amber so the fossa ovalis stands out; groove fat stays yellow */
  const PAL = {
    SVC: "#4a5c9e", IVC: "#4a5c9e", RA: "#7a72b4", RA_wall: "#7a72b4", RV_cavity: "#8c3c48", RV_free_wall: "#8c3c48", RVOT: "#90434f",
    PA_main: "#506cae", RPA: "#506cae", LPA: "#506cae", coronary_sinus: "#6a5a9a", cardiac_veins: "#5c4c8c",
    pulmonary_veins: "#c46068", LA: "#be6070", LA_wall: "#be6070", LAA: "#b45a68", LV_cavity: "#a6352f", LV_myocardium: "#a6352f", PW: "#a6352f", LVOT: "#ad3d36",
    aortic_root: "#c4443c", "aortic_root.ascending": "#c4443c", aortic_arch: "#c4443c", arch_branches: "#c4443c",
    IVS: "#9a3438", IAS: "#c99a68", membranous_septum: "#e2d8c4", central_fibrous_body: "#ece2cc", TV_annulus: "#e2d8c4",
    MV_AML: "#efe6d4", MV_PML: "#efe6d4", TV_septal: "#efe6d4", TV_anterior: "#efe6d4", TV_posterior: "#efe6d4",
    "AV_cusps.RCC": "#efe6d4", "AV_cusps.LCC": "#efe6d4", "AV_cusps.NCC": "#efe6d4", PV_cusps: "#efe6d4", chordae: "#efe6d4",
    "papillary_muscles.ALPM": "#a83a33", "papillary_muscles.PMPM": "#a83a33", moderator_band: "#94424c",
    crista_terminalis: "#6e66a8", pectinate_muscles: "#7068ac", eustachian_valve: "#e2d8c4", thebesian_valve: "#e2d8c4", todaro_tendon: "#e2d8c4",
    epicardial_fat: "#e2c482", pericardium: "#f0e2a8", LCA: "#c62a1e", RCA: "#c62a1e",
    artery: "#c62a1e", vein: "#4a3d86", conduction: "#22c3ab", node: "#35e0c4", koch: "#ffd34d", cti: "#ff7a3d" };
  const LEGEND = [["Right heart · cavae · pulmonary trunk (deoxygenated)", ["#4a5c9e", "#7a72b4", "#506cae"]], ["Left heart · aorta · pulmonary veins (oxygenated)", ["#be6070", "#c46068", "#c4443c"]],
    ["Ventricular muscle", ["#a6352f", "#8c3c48"]], ["Valves · fibrous skeleton", ["#efe6d4"]], ["Conduction system", ["#22c3ab"]]];

  /* ---- layers (the "Labels" drop-down): which structures carry a label in each group ---- */
  const LAYERS = [
    { id: "chambers", name: "Chambers", ids: ["RA", "RV_cavity", "LA", "LV_cavity", "LAA", "LVOT", "RVOT"] },
    { id: "valves", name: "Valves", ids: ["mitral_valve", "tricuspid_valve", "aortic_valve", "pulmonary_valve", "chordae", "papillary_muscles.ALPM", "papillary_muscles.PMPM"] },
    { id: "vessels", name: "Vessels", ids: ["aortic_root", "aortic_arch", "PA_main", "RPA", "LPA", "SVC", "IVC", "pulmonary_veins", "coronary_sinus", "artery:LM", "artery:LAD", "artery:LCx", "artery:RCA", "artery:PDA", "artery:OM1", "artery:D1", "vein:GCV"] },
    { id: "conduction", name: "Conduction", ids: ["sa_node", "internodal_anterior", "internodal_middle", "internodal_posterior", "bachmann_bundle", "av_node", "his_bundle", "rbb", "lbb_anterior_fascicle", "lbb_posterior_fascicle", "lbb_septal_fascicle"] },
    { id: "landmarks", name: "Anatomical landmarks", ids: ["crista_terminalis", "pectinate_muscles", "fossa_ovalis", "IAS", "IVS", "membranous_septum", "central_fibrous_body", "koch_triangle", "todaro_tendon", "eustachian_valve", "thebesian_valve", "cs_ostium", "cti", "moderator_band"] }];

  /* ---- short names for labels on the model (T6.2-B) ----
     Rule: at most 18 characters; sentence case, eponyms keep their capital (Koch's triangle, Tendon of Todaro).
     Abbreviate only what a student already reads on an echo or ECG report: chambers (RA, RV, LA, LV, LAA, LVOT, RVOT), veins and
     arteries (SVC, IVC, RPA, LPA, LM, LAD, LCx, RCA, PDA, OM1, D1), the conduction parts named in ECG diagnoses (SA node, AV node,
     LBB, RBB, LAF, LPF) and CTI. Everything else in words; "Pulm." / "Ant." / "Post." only when the words do not fit.
     Valve leaflets read "<valve>, <leaflet>" so they group by valve. The card always shows the full name. */
  const SHORT = { RA: "RA", RV_cavity: "RV", LA: "LA", LV_cavity: "LV", LAA: "LAA", LVOT: "LVOT", RVOT: "RVOT",
    mitral_valve: "Mitral valve", tricuspid_valve: "Tricuspid valve", aortic_valve: "Aortic valve", pulmonary_valve: "Pulmonary valve",
    MV_AML: "Mitral, anterior", MV_PML: "Mitral, posterior", TV_septal: "Tricuspid, septal", TV_anterior: "Tricuspid, ant.", TV_posterior: "Tricuspid, post.",
    "AV_cusps.RCC": "Aortic, right cusp", "AV_cusps.LCC": "Aortic, left cusp", "AV_cusps.NCC": "Aortic, non-cor.", PV_cusps: "Pulm. valve", chordae: "Chordae",
    "papillary_muscles.ALPM": "Ant-lat papillary", "papillary_muscles.PMPM": "Post-med papillary",
    "aortic_root.ascending": "Ascending aorta", aortic_root: "Aortic root", aortic_arch: "Aortic arch", PA_main: "Pulm. trunk", RPA: "RPA", LPA: "LPA", SVC: "SVC", IVC: "IVC", pulmonary_veins: "Pulm. veins", coronary_sinus: "Coronary sinus",
    "artery:LM": "LM", "artery:LAD": "LAD", "artery:LCx": "LCx", "artery:RCA": "RCA", "artery:PDA": "PDA", "artery:OM1": "OM1", "artery:D1": "D1", "vein:GCV": "Great cardiac v.",
    sa_node: "SA node", internodal_anterior: "Ant. internodal", internodal_middle: "Mid. internodal", internodal_posterior: "Post. internodal", bachmann_bundle: "Bachmann's bundle", av_node: "AV node", his_bundle: "His bundle",
    rbb: "RBB", lbb_anterior_fascicle: "LAF", lbb_posterior_fascicle: "LPF", lbb_septal_fascicle: "Septal fascicle",
    crista_terminalis: "Crista terminalis", pectinate_muscles: "Pectinate muscles", fossa_ovalis: "Fossa ovalis", IAS: "Atrial septum", IVS: "Ventricular septum", membranous_septum: "Membranous septum", central_fibrous_body: "Central fib. body",
    koch_triangle: "Koch's triangle", todaro_tendon: "Tendon of Todaro", eustachian_valve: "Eustachian valve", thebesian_valve: "Thebesian valve", cs_ostium: "CS ostium", cti: "CTI", moderator_band: "Moderator band" };

  /* ---- what a tap opens: an existing card (CONTENT.STRUCT / SIMC.VALVENOTE / CONTENT.VESSEL / walls) or a short note ---- */
  const CARD = { sa_node: ["struct", "sa"], internodal_anterior: ["struct", "tracts"], internodal_middle: ["struct", "tracts"], internodal_posterior: ["struct", "tracts"], crista_terminalis: ["struct", "tracts"],
    bachmann_bundle: ["struct", "bach"], av_node: ["struct", "avn"], koch_triangle: ["struct", "avn"], his_bundle: ["struct", "his"], his_bifurcation: ["struct", "his"], rbb: ["struct", "rbb"],
    lbb_septal_fascicle: ["struct", "lbb"], lbb_anterior_fascicle: ["struct", "laf"], lbb_posterior_fascicle: ["struct", "lpf"], LA: ["struct", "la"], LA_wall: ["struct", "la"], pulmonary_veins: ["struct", "la"], RVOT: ["struct", "rvot"],
    mitral_valve: ["valve", "mitral"], tricuspid_valve: ["valve", "tricuspid"], aortic_valve: ["valve", "aortic"], pulmonary_valve: ["valve", "pulmonary"],
    MV_AML: ["valve", "mitral"], MV_PML: ["valve", "mitral"], chordae: ["valve", "mitral"], TV_septal: ["valve", "tricuspid"], TV_anterior: ["valve", "tricuspid"], TV_posterior: ["valve", "tricuspid"], TV_annulus: ["valve", "tricuspid"],
    "AV_cusps.RCC": ["valve", "aortic"], "AV_cusps.LCC": ["valve", "aortic"], "AV_cusps.NCC": ["valve", "aortic"], PV_cusps: ["valve", "pulmonary"], LAA: ["valve", "laa"], LVOT: ["valve", "lvot"] };
  /* coronary tree (heart-mesh.json ids) → the lab's vessel keys (CONTENT.VESSEL); split by position along the artery */
  const VESSEL_KEY = (id, t) => ({ LM: "LM", LAD: t < .28 ? "LADp" : t < .62 ? "LADm" : "LADd", D1: "D1", LCx: t < .45 ? "LCxp" : "LCxd", OM1: "OM", PLB: "PL",
    RCA: t < .34 ? "RCAp" : t < .67 ? "RCAm" : "RCAd", AM: "AM", PDA: "PDA" })[id] || null;
  /* LV wall regions from the AHA 17 segments (as the refined-heart adapter) */
  const AHA_WALL = a => ({ 1: "ANT", 7: "ANT", 13: "ANT", 2: "ANTSEP", 8: "ANTSEP", 14: "ANTSEP", 3: "INF", 4: "INF", 9: "INF", 10: "INF", 15: "INF", 5: "POST", 11: "POST", 6: "HILAT", 12: "LAT", 16: "LAT", 17: "APEX" })[a] || null;

  /* ---- short notes for structures without a full card yet (mechanism first; full cards with complications and pearls follow) ---- */
  const NOTE = {
    RA: ["Right atrium", "Chamber", "Receives deoxygenated blood from the SVC, IVC and coronary sinus. Its smooth posterior part (sinus venarum) and its rough, muscle-ridged front (pectinate muscles) meet at the crista terminalis, which is also where the SA node and the fastest atrial conduction lie."],
    RA_wall: ["Right atrial wall", "Chamber wall", "Thin (about 2 mm) muscle. Fibre direction, not insulation, makes some routes conduct faster, which is why the crista and the cavotricuspid isthmus matter in flutter."],
    RV_cavity: ["Right ventricle", "Chamber", "A crescent wrapped around the LV, triangular in the 4-chamber view. It pumps into the low-pressure pulmonary circulation, so its wall is thin (under 5 mm) and its inflow is rough with trabeculae and the moderator band."],
    RV_free_wall: ["RV free wall", "Chamber wall", "Thin wall facing the sternum. It fails first in pulmonary embolism and RV infarction (proximal RCA), and is the chamber closest to the chest wall in echo."],
    LV_cavity: ["Left ventricle", "Chamber", "A bullet-shaped high-pressure pump. Thick walls (about 1 cm) generate systemic pressure; the smooth outflow (LVOT) lies in front of the anterior mitral leaflet."],
    PW: ["LV wall", "Chamber wall", "The thick LV myocardium. Tap the outer surface to see its coronary territory and the matching MI."], LV_myocardium: ["LV wall", "Chamber wall", "The thick LV myocardium."],
    IVS: ["Interventricular septum", "Septum", "Mostly muscular and behaves as part of the LV (it thickens toward the LV in systole). The His bundle and both bundle branches run on its crest and surfaces, so septal infarction or surgery can block conduction."],
    IAS: ["Interatrial septum", "Septum", "The true septum is mostly the fossa ovalis and its rim (limbus); the thin floor of the fossa is the remnant of the fetal foramen ovale, the site of a PFO or a secundum ASD."],
    fossa_ovalis: ["Fossa ovalis", "Landmark", "A thin oval membrane in the interatrial septum, ringed by the muscular limbus. A flap that never sealed (PFO, about 25 % of adults) can let a venous clot cross to the left heart; a hole in its floor is a secundum ASD. It is also the transseptal puncture site for left-atrial procedures."],
    LAA: ["Left atrial appendage", "Chamber", "A narrow, trabeculated pouch off the LA. Slow flow in AF makes it the commonest source of cardiac emboli; that is why it is occluded or excised in some patients."],
    LVOT: ["LV outflow tract", "Chamber", "Smooth channel between the septum and the anterior mitral leaflet leading to the aortic valve. Septal bulge plus systolic anterior motion of the mitral leaflet obstructs it in HOCM."],
    SVC: ["Superior vena cava", "Vessel", "Returns blood from the head and arms to the top of the RA. The SA node lies at its junction with the RA, along the crista terminalis."],
    IVC: ["Inferior vena cava", "Vessel", "Returns blood from the lower body to the floor of the RA; the Eustachian valve guards the front of its opening. In echo its size and collapse estimate RA pressure."],
    coronary_sinus: ["Coronary sinus", "Vessel", "The main cardiac vein, running in the posterior AV groove and opening into the RA between the IVC and the tricuspid valve. Its ostium is the base of Koch's triangle and the route for CRT leads."],
    pulmonary_veins: ["Pulmonary veins", "Vessel", "Four veins carry oxygenated blood into the LA. Muscle sleeves from the atrium extend into them and fire the ectopic beats that start most AF, the target of pulmonary vein isolation."],
    "aortic_root.ascending": ["Ascending aorta", "Vessel", "Leaves the aortic valve with the three sinuses of Valsalva (the coronary arteries arise from the right and left sinuses) and rises to the arch."],
    aortic_root: ["Aortic root", "Vessel", "Annulus, sinuses of Valsalva and sinotubular junction. The left and right coronary arteries arise from their sinuses; root dilatation pulls the cusps apart (aortic regurgitation)."],
    aortic_arch: ["Aortic arch", "Vessel", "Gives the brachiocephalic trunk, left common carotid and left subclavian arteries; the RPA passes underneath it."],
    arch_branches: ["Arch branches", "Vessel", "Brachiocephalic trunk, left common carotid and left subclavian arteries."],
    PA_main: ["Pulmonary trunk", "Vessel", "Carries deoxygenated blood from the RV, in front of and to the left of the aorta, then divides under the arch into the right and left pulmonary arteries."],
    RPA: ["Right pulmonary artery", "Vessel", "Runs under the aortic arch, behind the ascending aorta and SVC, to the right lung."], LPA: ["Left pulmonary artery", "Vessel", "Continues from the trunk over the left bronchus to the left lung."],
    "papillary_muscles.ALPM": ["Anterolateral papillary muscle", "Valve apparatus", "Holds the mitral chordae. It has a dual blood supply (LAD diagonals and LCx marginals), so it rarely ruptures."],
    "papillary_muscles.PMPM": ["Posteromedial papillary muscle", "Valve apparatus", "Holds the mitral chordae. It depends on one artery (usually the PDA from the RCA), so it is the one that ruptures after an inferior MI, causing acute severe mitral regurgitation."],
    moderator_band: ["Moderator band", "Landmark", "A muscle bar from the septum to the anterior papillary muscle of the RV. It carries the right bundle branch, so the RV free wall can contract in time; it also identifies the RV in echo."],
    crista_terminalis: ["Crista terminalis", "Landmark", "Muscle ridge between the smooth and rough parts of the RA. The SA node lies at its top; fast conduction along it and block across it shape typical flutter. Focal atrial tachycardias often start on it."],
    pectinate_muscles: ["Pectinate muscles", "Landmark", "Parallel muscle ridges on the front of the RA and in its appendage, running off the crista terminalis. They mark the part of the RA that came from the embryonic atrium."],
    eustachian_valve: ["Eustachian valve", "Landmark", "Fetal valve on the front of the IVC opening that directed oxygenated IVC blood across the foramen ovale. Its remnant continues as the Eustachian ridge and the tendon of Todaro; a large one can obstruct catheters across the cavotricuspid isthmus."],
    thebesian_valve: ["Thebesian valve", "Landmark", "A thin fold over the coronary sinus ostium. When prominent it makes cannulating the sinus (CRT leads, ablation) harder."],
    todaro_tendon: ["Tendon of Todaro", "Landmark", "Fibrous cord from the Eustachian valve to the central fibrous body. With the CS ostium and the septal tricuspid leaflet hinge it bounds Koch's triangle."],
    membranous_septum: ["Membranous septum", "Fibrous skeleton", "The thin fibrous top of the interventricular septum under the right and non-coronary aortic cusps. The septal tricuspid leaflet divides it into an atrioventricular and an interventricular part; it is the commonest site of VSDs, and the His bundle runs along its lower edge."],
    central_fibrous_body: ["Central fibrous body", "Fibrous skeleton", "The right fibrous trigone where the mitral, tricuspid and aortic valve rings meet. It insulates atria from ventricles; the His bundle is the only normal electrical route through it, which is why it matters in heart block after valve surgery or TAVI."],
    cs_ostium: ["Coronary sinus ostium", "Landmark", "Opening of the coronary sinus into the RA, the base of Koch's triangle. The slow AV-nodal pathway runs between it and the tricuspid annulus (AVNRT ablation site)."],
    cti: ["Cavotricuspid isthmus", "Landmark", "Strip of RA floor between the IVC and the tricuspid annulus. The typical flutter circuit must pass through it, so an ablation line across it cures typical flutter."],
    TV_annulus: ["Tricuspid annulus", "Valve apparatus", "Fibrous ring of the tricuspid valve, about 1 cm more apical than the mitral ring at the septum."],
    epicardial_fat: ["Epicardial fat", "Surface", "Fat in the atrioventricular and interventricular grooves that cushions the coronary arteries and veins."] };
  const ART_NAME = { LM: "Left main", LAD: "Left anterior descending (LAD)", D1: "First diagonal", D2: "Second diagonal", LCx: "Left circumflex (LCx)", OM1: "First obtuse marginal", OM2: "Second obtuse marginal",
    RCA: "Right coronary artery (RCA)", PDA: "Posterior descending (PDA)", PLB: "Posterolateral branch", AM: "Acute marginal", CB: "Conus branch", SAN: "SA nodal artery", AVN: "AV nodal artery", S1: "First septal", S2: "Second septal", S3: "Third septal", RVB1: "RV branch", RVB2: "RV branch" };
  const CONDUCTION_SHORT={...(CGRAPH.spec?.display.shortNames||{})};
  const UI_FLAGS={activationTimingMap:true};
  /* ---- one name per valve (Punnatorn, 13 Nov): the model labels the valve, not each leaflet; a tap on any leaflet opens the valve.
     The leaflet ids stay in the phantom, the exports and the shaders. */
  const VALVE_GROUPS = { mitral_valve: ["MV_AML", "MV_PML"], tricuspid_valve: ["TV_septal", "TV_anterior", "TV_posterior"],
    aortic_valve: ["AV_cusps.RCC", "AV_cusps.LCC", "AV_cusps.NCC"], pulmonary_valve: ["PV_cusps"] };
  /* what a tap on one leaflet shows (callout + card line); the model's labels stay one per valve */
  const LEAFLET = {
    MV_AML: ["Mitral · anterior leaflet", "Anterior (aortic) leaflet: the larger, deeper leaflet, in fibrous continuity with the aortic valve (the aorto-mitral curtain). In HOCM its tip is pulled into the LVOT (systolic anterior motion). [teaching (verify)]"],
    MV_PML: ["Mitral · posterior leaflet", "Posterior (mural) leaflet: shorter but longer along the annulus, with three scallops P1–P3; P2 is the commonest site of prolapse or flail. [teaching (verify)]"],
    TV_septal: ["Tricuspid · septal leaflet", "Septal leaflet: hinged on the septum about 1 cm more apical than the mitral hinge (the normal offset; much more in Ebstein anomaly). The His bundle runs just below its attachment, near the membranous septum. [teaching (verify)]"],
    TV_anterior: ["Tricuspid · anterior leaflet", "Anterior leaflet: the largest tricuspid leaflet; most of its chordae come from the anterior papillary muscle, which the moderator band joins. [teaching (verify)]"],
    TV_posterior: ["Tricuspid · posterior leaflet", "Posterior (inferior) leaflet: the smallest, along the diaphragmatic wall of the RV. [teaching (verify)]"],
    "AV_cusps.RCC": ["Aortic · right coronary cusp", "Right coronary cusp: the most anterior cusp; the right coronary artery arises from its sinus. [teaching (verify)]"],
    "AV_cusps.LCC": ["Aortic · left coronary cusp", "Left coronary cusp: the left main coronary artery arises from its sinus. [teaching (verify)]"],
    "AV_cusps.NCC": ["Aortic · non-coronary cusp", "Non-coronary cusp: posterior, facing the atrial septum; it sits above the membranous septum and the His bundle, so aortic-root disease can cause heart block. [teaching (verify)]"],
    PV_cusps: ["Pulmonary valve cusps", "Three thin semilunar cusps (anterior, left, right) at the top of the RVOT. [teaching (verify)]"] };
  const VALVE_OF = Object.fromEntries(Object.entries(VALVE_GROUPS).flatMap(([g, ids]) => ids.map(id => [id, g])));
  /* ---- Relevant labels per view (T6.2-B, Claude): what a student should find first in that view, 4–10 names (up to 20 where the view is explored with the level slider, e.g. 4C), including the essential vessels that can be seen in that view (vessels layer on in every view; coronary arteries still follow the Coronaries switch; the IVC has no surface of its own to label, and See-through hides great-vessel names).
     The cut view's "Find in this view" chips use the same list. Conduction parts use the "conduction:<tap id>" namespace.
     A name shows only when its layer is on and its anchor can be seen, so External lists both sides of the heart. */
  const RELEVANT_LABELS = {
    external: ["RA", "RV_cavity", "LV_cavity", "LA", "LAA", "aortic_root", "aortic_arch", "PA_main", "SVC"],
    seeThrough: ["RA", "LA", "RV_cavity", "LV_cavity", "conduction:sa", "conduction:avn", "conduction:lbb", "conduction:rbb"],
    valves: ["pulmonary_valve", "aortic_valve", "mitral_valve", "tricuspid_valve", "central_fibrous_body", "coronary_sinus"],
    a4c: ["RA", "LA", "RV_cavity", "LV_cavity", "IVS", "mitral_valve", "tricuspid_valve", "papillary_muscles.ALPM", "papillary_muscles.PMPM", "LVOT", "aortic_valve", "conduction:sa", "conduction:avn", "conduction:his", "conduction:lbb", "conduction:rbb", "conduction:purk", "coronary_sinus"],
    lvOpen: ["LA", "LV_cavity", "LVOT", "mitral_valve", "papillary_muscles.ALPM", "papillary_muscles.PMPM", "aortic_valve", "pulmonary_veins"],
    rvOpen: ["RV_cavity", "tricuspid_valve", "moderator_band", "RVOT", "pulmonary_valve", "IVS", "conduction:rbb", "PA_main", "SVC"],
    raOpen: ["crista_terminalis", "pectinate_muscles", "fossa_ovalis", "cs_ostium", "koch_triangle", "eustachian_valve", "cti", "conduction:sa", "conduction:avn", "SVC"],
    laOpen: ["LA", "pulmonary_veins", "LAA", "fossa_ovalis", "crista_terminalis", "conduction:sa", "conduction:bach", "conduction:avn", "SVC"],
    sax: ["LV_cavity", "RV_cavity", "IVS", "papillary_muscles.ALPM", "papillary_muscles.PMPM", "coronary_sinus"],
    coronal: [], axial: [], sagittal: [] };
  /* ---- default layers per view, applied when the student enters the view: "on" · "fade" · "off".
     "fade" = labels show in All at .55 opacity; selected labels stay fully opaque.
     Coronaries stay off in every cut (st.coronaries). Conduction is on only where the view teaches it. */
  const VIEW_LAYERS = {
    external:   { chambers: "on", vessels: "on", valves: "off", landmarks: "off", conduction: "off" },
    seeThrough: { chambers: "on", valves: "on", conduction: "on", landmarks: "fade", vessels: "on" },
    valves:     { valves: "on", landmarks: "on", chambers: "off", vessels: "on", conduction: "off" },
    a4c:        { chambers: "on", valves: "on", landmarks: "on", vessels: "on", conduction: "on" },
    lvOpen:     { chambers: "on", valves: "on", landmarks: "fade", vessels: "on", conduction: "off" },
    rvOpen:     { chambers: "on", valves: "on", landmarks: "on", conduction: "on", vessels: "on" },
    raOpen:     { landmarks: "on", conduction: "on", valves: "fade", chambers: "off", vessels: "on" },
    laOpen:     { chambers: "on", vessels: "on", valves: "on", landmarks: "on", conduction: "on" },
    sax:        { chambers: "on", valves: "on", landmarks: "fade", vessels: "on", conduction: "off" } };
  /* ---- conduction parts drawn in each dissection view (tap ids; Punnatorn 13 Nov: a beginner should not see the whole network
     in every cut). Parts not listed are not drawn; listed parts show only where they lie on the visible anatomy, so sliding the
     cut level reveals more. External / See-through / CT sections draw everything. */
  const VIEW_CONDUCTION = {
    valves: ["avn", "his"],
    a4c: ["sa", "avn", "his", "lbb", "lsf", "laf", "lpf", "rbb", "moderator", "purk"],
    lvOpen: ["his", "lbb", "lsf", "laf", "lpf", "purk"],
    rvOpen: ["avn", "his", "rbb", "moderator", "purk"],
    raOpen: ["sa", "tracts", "avn", "avn_fast", "avn_slow", "his", "cti"],
    laOpen: ["sa", "tracts", "bach", "avn"],
    sax: ["lsf", "laf", "lpf", "rbb", "moderator", "purk"] };
  /* ---- crowded AV junction: in All, one "AV junction" label at the AV node; a tap fans it out
     into its members. Relevant shows only the AV node; the pathways belong to Advanced / the pathology page (AVNRT). */
  const LABEL_GROUPS = { avJunction: { text: "AV junction", anchor: "conduction:avn", modes: ["all"],
    members: ["conduction:avn", "conduction:avn_fast", "conduction:avn_slow", "conduction:his", "conduction:lbb"] } };
  return { UI_FLAGS, VALVE_GROUPS, VALVE_OF, LEAFLET, RELEVANT_LABELS, VIEW_LAYERS, VIEW_CONDUCTION, LABEL_GROUPS, CONDUCTION_SHORT, PAL, LEGEND, LAYERS, SHORT, CARD, VESSEL_KEY, AHA_WALL, NOTE, ART_NAME };
})();
