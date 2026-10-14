import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
import {database} from './run-sql.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const db=await database();
await db.exec(`insert into auth.users(id,raw_user_meta_data) values
 ('00000000-0000-0000-0000-00000000000a','{"name":"운영자","org":"테스트","phone":"01012345678","sp_agreed":true}'),
 ('00000000-0000-0000-0000-00000000000c','{"name":"연구자","org":"KAIST","phone":"01012345678","sp_agreed":true}');
 update profiles set is_admin=true where id='00000000-0000-0000-0000-00000000000a';
 update settings set value='{"enabled":true}' where key='sp_access';
 select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
 select sp_adjust_credit('00000000-0000-0000-0000-00000000000c',1000000,'브라우저 테스트');`);
const ident=x=>{if(!/^[a-z_][a-z_0-9]*$/.test(x))throw Error('identifier');return '"'+x+'"';};
let queue=Promise.resolve();
async function request(q){
 const work=queue.then(async()=>{
  try{
   await db.exec('reset role');
   if(q.kind==='signup'){
    const id=crypto.randomUUID();await db.query('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id,q.args.email,q.args.options.data]);return {data:{user:{id},session:null},error:null};
   }
   await db.query("select set_config('request.jwt.claim.sub',$1,false)",[q.user||'']);await db.exec('set role '+(q.user?'authenticated':'anon'));
   if(q.kind==='rpc'){
    let keys=Object.keys(q.args),params=keys.map(k=>typeof q.args[k]==='object'&&q.args[k]!==null?JSON.stringify(q.args[k]):q.args[k]);
    let res=await db.query(`select * from public.${ident(q.name)}(${keys.map((k,i)=>ident(k)+' => $'+(i+1)).join(',')})`,params);
    return {data:res.rows.length===1&&Object.keys(res.rows[0]).length===1?Object.values(res.rows[0])[0]:res.rows,error:null};
   }
   let params=[];const val=x=>{params.push(x);return '$'+params.length;};
   let where=q.filters.map(([k,op,v])=>op==='in'?ident(k)+' in ('+v.map(val).join(',')+')':op==='is'?ident(k)+' is null':ident(k)+op+val(v));
   const cols=q.columns||'*';let sql='select * from '+ident(q.table)+(where.length?' where '+where.join(' and '):'');
   if(q.orders.length)sql+=' order by '+q.orders.map(([k,o])=>ident(k)+(o.ascending===false?' desc':' asc')+(o.nullsFirst===false?' nulls last':'')).join(',');
   if(q.limit)sql+=' limit '+Number(q.limit);
   let rows=(await db.query(sql,params)).rows;
   for(const r of rows){
    if(cols.includes('sp_samples(')){const ss=(await db.query('select * from sp_samples where order_id=$1',[r.id])).rows;r.sp_samples=cols.includes('sp_samples(count)')?[{count:ss.length}]:ss;}
    if(cols.includes('profiles('))r.profiles=(await db.query('select name,org,phone from profiles where id=$1',[r.client_id||r.user_id])).rows[0];
    if(cols.includes('sp_orders('))r.sp_orders=(await db.query('select order_no from sp_orders where id=$1',[r.order_id])).rows[0];
   }
   return {data:q.single?(rows[0]||null):rows,count:rows.length,error:null};
  }catch(e){return {data:null,error:{message:e.message,code:e.code}};}
 });queue=work.catch(()=>{});return work;
}
const root=process.cwd();const server=http.createServer((req,res)=>{
 let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(p.endsWith('/'))p+='index.html';
 if(!p.startsWith(root)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(p));}catch{res.writeHead(404).end();}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const results=[];fs.mkdirSync('review/evidence',{recursive:true});
async function pageFor(width,role='c'){
 const page=await browser.newPage({viewport:{width,height:900}});await page.exposeFunction('__reviewDB',request);
 await page.addInitScript(id=>{if(id)localStorage.setItem('review-user',id);else localStorage.removeItem('review-user');},role?'00000000-0000-0000-0000-00000000000'+role:null);
 await page.route('**/*',async route=>{
  const u=route.request().url();if(u.includes('supabase-js-'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync('review/browser-adapter.js','utf8')});
  if(u.endsWith('/site/om-config.js'))return route.fulfill({contentType:'application/javascript',body:'window.OM_CONFIG={url:"https://test.invalid",anonKey:"test",samplo:true,kakao:false};'});
  if(!u.startsWith(url))return route.abort();return route.continue();
 });return page;
}
async function check(page,label){await page.locator('#om-main h1, #om-main h2').first().waitFor();await page.waitForTimeout(150);const state=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,text:document.querySelector('#om-main').innerText}));
 const bad=/화면을 불러오지 못했습니다/.test(state.text);results.push({label,width:state.width,documentOverflow:state.scroll>state.width,renderError:bad});
 await page.screenshot({path:'review/evidence/'+label+'-'+state.width+'.png',fullPage:true});if(bad||state.scroll>state.width)throw Error(JSON.stringify(results.at(-1)));
}
try{
 for(const width of [390,1280]){
  await db.exec('reset role');await db.exec(`update settings set value='{"enabled":false}' where key='sp_access'`);
  let closedPage=await pageFor(width);await closedPage.goto(url+'/samplo/app/?new=1');await closedPage.getByRole('heading',{name:'온라인 의뢰는 오픈 준비 중입니다'}).waitFor();await check(closedPage,'closed-server-switch');await closedPage.close();
  await db.exec('reset role');await db.exec(`update settings set value='{"enabled":true}' where key='sp_access'`);
  let page=await pageFor(width,null);await page.goto(url+'/samplo/login/?mode=signup');await check(page,'signup');
  for(const [name,value] of Object.entries({name:'테스트 연구자',org:'테스트 대학',phone:'01012345678',email:'signup'+width+'@example.com',password:'ReviewPass1234'}))await page.locator('[name="'+name+'"]').fill(value);
  await page.locator('[name="agree"]').check();await page.locator('#f-signup [type="submit"]').click();await page.locator('[data-act="resend"]').waitFor();await check(page,'signup-confirmation');
  await db.exec('reset role');const pr=(await db.query('select p.* from profiles p join auth.users u on u.id=p.id where u.email=$1',['signup'+width+'@example.com'])).rows[0];if(!pr?.sp_agreed_at||pr.name!=='테스트 연구자')throw Error('signup metadata not persisted');
  await page.close();
  page=await pageFor(width);await page.goto(url+'/samplo/app/');await check(page,'customer-empty');
  await page.goto(url+'/samplo/app/?new=1');await check(page,'wizard-step1');
  await page.locator('[data-k="dna"]').click();await page.locator('#wz-next').click();await check(page,'wizard-step2');
  await page.locator('[data-k="wgs"]').click();await page.locator('#wz-next').click();await check(page,'wizard-step3');
  const today=await page.evaluate(()=>SP.todayKST());const tomorrow=await page.evaluate(()=>SP.addDays(SP.todayKST(),1));
  await page.locator('[data-c="name"]').first().fill('CASE-'+width);
  await page.locator('[data-c="collected_on"]').first().fill(today);
  await page.locator('[data-c="amount"]').first().fill('30');
  await page.locator('#wz-next').click();await page.locator('[name="pickup_date"]').waitFor();await check(page,'wizard-step4');
  for(const [name,value] of Object.entries({pickup_date:tomorrow,pickup_addr:'대전 유성구 대학로 291',pickup_addr2:'E16 5층 512호',lab_name:'KAIST 유전체연구실',pi_name:'김교수',contact_phone:'01012345678'}))await page.locator('[name="'+name+'"]').fill(value);
  await page.locator('[name="pickup_slot"]').selectOption('pm');await page.locator('#wz-next').click();await page.locator('[data-pay="credit"]').waitFor();await check(page,'wizard-step5');
  await page.locator('[data-pay="credit"]').click();for(const c of await page.locator('[data-chk]').all())await c.check();
  await page.locator('#wz-next').click();await page.waitForURL(/id=/);await check(page,'order-submitted');
  const oid=new URL(page.url()).searchParams.get('id');
  const admin='00000000-0000-0000-0000-00000000000a',client='00000000-0000-0000-0000-00000000000c';
  await db.exec('reset role');let row=(await db.query('select * from sp_orders where id=$1',[oid])).rows[0];
  if(row.status!=='submitted')throw Error('order not submitted');
  async function rpc(user,name,args){let r=await request({kind:'rpc',user,name,args});if(r.error)throw Error(r.error.message);return r.data;}
  await rpc(admin,'sp_confirm_order',{p_id:oid,amount:100000,p_seen:row.updated_at});
  await rpc(admin,'sp_set_status',{p_id:oid,new_status:'received'});
  await db.exec('reset role');const sid=(await db.query('select id from sp_samples where order_id=$1',[oid])).rows[0].id;
  await rpc(admin,'sp_record_qc',{p_sample:sid,p_status:'warn',p_value:'DIN 5.2',p_note:'확인 필요'});
  await page.reload();await page.locator('[data-dec="proceed"]').waitFor();await check(page,'order-qc');await page.locator('[data-dec="proceed"]').click();
  await page.waitForTimeout(200);await db.exec('reset role');if((await db.query('select decision from sp_samples where id=$1',[sid])).rows[0].decision!=='proceed')throw Error('QC decision not persisted');
  await rpc(admin,'sp_cancel_order',{p_id:oid,note:'테스트 취소'});
  const balance=await rpc(client,'sp_balance',{});if(balance!==1000000+(width===1280?1000000:0))throw Error('charge/refund imbalance '+balance);
  await page.reload();await check(page,'order-refunded');
  await page.goto(url+'/samplo/app/?topup=1');await page.locator('[name="amount"]').selectOption('1000000');await page.locator('[name="doc_type"][value="none"]').check();await page.locator('#tp-go').click();await page.waitForTimeout(300);await check(page,'topup-requested');
  await db.exec('reset role');const tp=(await db.query("select id from sp_topups where status='requested'")).rows[0];if(!tp)throw Error('no topup');await rpc(admin,'sp_confirm_topup',{p_id:tp.id});
  const after=await rpc(client,'sp_balance',{});if(after!==balance+1000000)throw Error('topup balance');
  await page.reload();await check(page,'topup-paid');
  results.push({label:'order-charge-qc-decision-refund',width,passed:true});
  await page.close();
  page=await pageFor(width,'a');await page.goto(url+'/samplo/admin/');await check(page,'admin-new');
  for(const tab of ['progress','credit','settings']){await page.goto(url+'/samplo/admin/?tab='+tab);await check(page,'admin-'+tab);}await page.close();
 }
 fs.writeFileSync('review/evidence/browser-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));
}finally{await browser.close();server.close();await db.close();}
