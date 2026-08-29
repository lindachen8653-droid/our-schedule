const CACHE="our-schedule-cloud-v33-20260830";
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
  const reminder=body.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+⏰\s*提醒：\s*(.+)$/);
  if(reminder){
    title=`${reminder[1]} ${reminder[2]} ${reminder[3].trim()}`;
    body='';
  }else{
    const m=body.match(/\[DIARY:(ling|sheng):(added|updated|deleted)\]/);
    if(m){
      const person=m[1]==='ling'?'鈴':'生';
      const verb=m[2]==='added'?'新增了日記':m[2]==='updated'?'更新了日記':'刪除了日記';
      title=`📖 ${person}${verb}`;
      body=body.replace(/\[DIARY:(ling|sheng):(added|updated|deleted)\]\s*/,'').trim();
    }
  }
  const options={body,tag:data.tag||'our-schedule-update',icon:'./icon.svg',badge:'./icon.svg',data:{url:data.url||'./'}};
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