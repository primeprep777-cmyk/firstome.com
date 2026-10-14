// Test-only transport. Auth is simulated; data queries and RPCs run against disposable PGlite.
window.supabase={createClient(){
 const user=()=>{const id=localStorage.getItem('review-user');return id?{id,email:'review@example.test'}:null;};
 function from(table){let q={table,filters:[],orders:[]};const b={
 select(columns='*',options={}){Object.assign(q,{columns,options});return b;},
 eq(k,v){q.filters.push([k,'=',v]);return b;},neq(k,v){q.filters.push([k,'<>',v]);return b;},
 in(k,v){q.filters.push([k,'in',v]);return b;},is(k,v){q.filters.push([k,'is',v]);return b;},
 order(k,v={}){q.orders.push([k,v]);return b;},limit(n){q.limit=n;return b;},
 maybeSingle(){q.single=true;return b;},single(){q.single=true;return b;},
 then(resolve,reject){return window.__reviewDB({kind:'select',user:user()?.id,...q}).then(resolve,reject);}
 };return b;}
 return {from,rpc(name,args={}){return window.__reviewDB({kind:'rpc',user:user()?.id,name,args});},auth:{
 async getSession(){return {data:{session:user()?{user:user()}:null}};},onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}};},
 async signOut(){localStorage.removeItem('review-user');return {error:null};},
 async signUp(args){return window.__reviewDB({kind:'signup',args});},
 async signInWithPassword(args){return {error:{message:'Test transport: authentication must be verified against Supabase'}};}
 }};
}};
