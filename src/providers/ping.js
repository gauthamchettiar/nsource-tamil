/**
 * ping - Built from src/ping/
 * Generated: 2026-08-16T22:38:50.922Z
 */
var r=(a,p,t)=>new Promise((s,o)=>{var g=e=>{try{i(t.next(e))}catch(n){o(n)}},d=e=>{try{i(t.throw(e))}catch(n){o(n)}},i=e=>e.done?s(e.value):Promise.resolve(e.value).then(g,d);i((t=t.apply(a,p)).next())});function l(){return r(this,null,function*(){return[{name:"Ping",title:"PING OK - provider loading works on this build",url:"https://example.com/ping-not-playable.mp4",quality:"N/A",provider:"Ping"}]})}typeof module!="undefined"&&module.exports?module.exports={getStreams:l}:global.getStreams={getStreams:l};
