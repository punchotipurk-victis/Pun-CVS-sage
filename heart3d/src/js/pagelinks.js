/* links between the two pages of the 3D Heart section: change the SITE route (parent); opened on its own, fall back to scrolling */
document.querySelectorAll(".jump a").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const go=a.dataset.go;
  if(go){try{if(window.parent&&window.parent!==window&&window.parent.document.querySelector(`.tabs a[data-topic="${go}"]`)){window.parent.location.hash="#"+go;return}}catch(err){}}
  const t=document.querySelector(a.getAttribute("href"));if(t)t.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"})}));
