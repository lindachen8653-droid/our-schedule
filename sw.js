const CACHE="our-schedule-cloud-v30-20260830";
const ASSETS=["./manifest.json","./icon.svg","./cloud.css","./cloud.js"];

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(ASSETS))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET") return;

  if(event.request.mode==="navigate"){
    event.respondWith(
      fetch(event.request,{cache:"no-store"})
        .catch(()=>caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(event.request,{cache:"no-store"})
      .then(response=>{
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(event.request,copy));
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});

self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{}

  let title=data.title||'Our Schedule';
  let body=data.body||'共用行程有更新';

  if(/日記/.test(body)){
    const person=/生的日記/.test(body)?'生':/鈴的日記/.test(body)?'鈴':'對方';
    title=`📖 ${person}新增了日記`;
    body=body.replace(/\s*📖\s*(生|鈴)的日記\s*/,' ').trim();
  }

  const options={
    body,
    tag:data.tag||'our-schedule-update',
    icon:'./icon.svg',
    badge:'./icon.svg',
    data:{url:data.url||'./'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'./';
  event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{
    for(const c of list){if('focus'in c)return c.focus()}
    return clients.openWindow?clients.openWindow(url):null;
  }));
});