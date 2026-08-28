const CACHE="our-schedule-v1-20260829";
const ASSETS=["./","./index.html","./manifest.json","./icon.svg"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;
  if(event.request.mode==="navigate"){
    event.respondWith(fetch(event.request).then(r=>{
      const copy=r.clone();caches.open(CACHE).then(c=>c.put("./index.html",copy));return r;
    }).catch(()=>caches.match("./index.html")));
    return;
  }
  event.respondWith(fetch(event.request).then(r=>{
    const copy=r.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return r;
  }).catch(()=>caches.match(event.request)));
});