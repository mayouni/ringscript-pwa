/*
** The Ring half, tested with no page at all.
**
** That is what the ring/ + web/ split is for: the outbox rules are callable
** from Node, so they can be proven before any browser is involved.
**
**   node test/pwa-lib.js
**
** It needs the RingScript runtime. By default it looks for a checkout of
** github.com/mayouni/ringscript beside this one; set RINGSCRIPT_HOME to
** point somewhere else.
*/
const fs = require("fs"), path = require("path");
const HOME = process.env.RINGSCRIPT_HOME ||
             path.join(__dirname, "..", "..", "ringscript");
const RUNTIME = path.join(HOME, "playground");
if (!fs.existsSync(path.join(RUNTIME, "ringscript.wasm"))) {
    console.error("No RingScript runtime at " + RUNTIME);
    console.error("Set RINGSCRIPT_HOME to a checkout of mayouni/ringscript.");
    process.exit(2);
}
const RingScript = require(path.join(RUNTIME, "ringscript.js"));
const LIB = __dirname + "/..";

let bad=0;
const ok=(n,c,d)=>{console.log((c?"  PASS  ":"  FAIL  ")+n+(c||d===undefined?"":"  ["+JSON.stringify(d)+"]"));if(!c)bad++;};
(async()=>{
  const b=fs.readFileSync(path.join(RUNTIME,"ringscript.wasm"));
  const mk=async()=>{const vm=await RingScript.load(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),{onOutput:()=>{}});
    const e=vm.eval(fs.readFileSync(path.join(LIB,"ring","pwa.ring"),"utf8"));
    if(!e.ok){console.log("EVAL FAILED:",e.error);process.exit(1);} return vm;};
  // the loader already parses JSON and falls back to the raw string, so
  // only parse again when it plainly looks like JSON
  const call=(vm,f,a)=>{const r=vm.call(f,a===undefined?1:a); if(!r.ok)throw new Error(f+": "+r.error);
    const v=r.result;
    if(typeof v!=="string")return v;
    const t=v.trim();
    if(t.startsWith("{")||t.startsWith("[")){try{return JSON.parse(t);}catch(e){return v;}}
    return v;};

  let vm=await mk();
  ok("device tag is settable", call(vm,"PwaOutboxDevice","phone-7")==="phone-7");

  let a=call(vm,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",{shop:"m03",total:4200}]]));
  ok("add returns an id made on the device", a.ok===1&&a.id.startsWith("order-phone-7-1-"),a);
  let a2=call(vm,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",{shop:"m09",total:900}]]));
  ok("ids are distinct", a2.id!==a.id);
  ok("an entry needs a kind", call(vm,"PwaOutboxAdd",JSON.stringify([["payload",1]])).ok===0);

  ok("two pending", call(vm,"PwaOutboxPending",0)===2);
  const p=call(vm,"PwaOutboxPayload",a.id);
  ok("payload survives the round trip", p.ok===1&&p.payload.shop==="m03"&&p.payload.total===4200,p);
  ok("unknown id refused", call(vm,"PwaOutboxPayload","nope").ok===0);

  call(vm,"PwaOutboxSent",a.id);
  ok("sent reduces pending", call(vm,"PwaOutboxPending",0)===1);
  call(vm,"PwaOutboxRollback",a.id);
  ok("rollback restores pending", call(vm,"PwaOutboxPending",0)===2);

  call(vm,"PwaOutboxSent",a.id);
  ok("forget drops only sent", call(vm,"PwaOutboxForget",0)===1&&call(vm,"PwaOutboxList",0).length===1);

  // a restart: new VM, restored from the snapshot the page had stored
  const snap=vm.call("PwaOutboxSnapshot",0).result;
  const vm2=await mk();
  ok("restore returns the entry count", call(vm2,"PwaOutboxRestore",snap)===1);
  ok("restored work is still pending", call(vm2,"PwaOutboxPending",0)===1);
  const a3=call(vm2,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",1]]));
  ok("the sequence continues after a restart, so ids stay unique",
     a3.id!==a.id&&a3.id!==a2.id&&a3.id.indexOf("-3-")>0,a3);
  ok("restore of nothing is harmless", call(vm2,"PwaOutboxRestore","")===0);

  // ---- 1.1: the batch, and per-entry verdicts -------------------------
  const vm3 = await mk();
  call(vm3,"PwaOutboxDevice","van-3");
  const o1 = call(vm3,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",{shop:"a"}]]));
  const o2 = call(vm3,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",{shop:"b"}]]));
  const o3 = call(vm3,"PwaOutboxAdd",JSON.stringify([["kind","order"],["payload",{shop:"c"}]]));

  const batch = call(vm3,"PwaOutboxBatch",0);
  ok("batch carries the device and every queued entry",
     batch.device==="van-3"&&batch.count===3&&batch.entries.length===3,batch);
  ok("batch keeps the payloads", batch.entries[0].payload.shop==="a",batch.entries[0]);

  ok("marking the batch sending clears pending", call(vm3,"PwaOutboxMarkSending",0)===3
     && call(vm3,"PwaOutboxPending",0)===0);

  ok("rollbackAll puts the whole batch back", call(vm3,"PwaOutboxRollbackAll",0)===3
     && call(vm3,"PwaOutboxPending",0)===3);

  call(vm3,"PwaOutboxMarkSending",0);
  const summary = call(vm3,"PwaOutboxApply", JSON.stringify([["results",[
      [["id",o1.id],["status","accepted"],["note",""]],
      [["id",o2.id],["status","rejected"],["note","over the credit limit"]],
      [["id",o3.id],["status","accepted"],["note",""]]
  ]]]));
  ok("verdicts counted", summary.accepted===2&&summary.rejected===1,summary);
  const after = call(vm3,"PwaOutboxList",0);
  const rejected = after.find(e=>e.id===o2.id);
  ok("a refused entry keeps the reason",
     rejected.state==="rejected"&&rejected.note==="over the credit limit",rejected);
  ok("one refusal does not touch the others",
     after.filter(e=>e.state==="accepted").length===2,after.map(e=>e.state));

  const old = JSON.stringify({device:"old",seq:1,
      entries:[["order-old-1-1","order",{x:1},"queued",1]]});
  const vm4 = await mk();
  ok("a pre-1.1 snapshot restores", call(vm4,"PwaOutboxRestore",old)===1);
  ok("...and gains an empty note rather than breaking",
     call(vm4,"PwaOutboxList",0)[0].note==="",call(vm4,"PwaOutboxList",0)[0]);

  console.log(bad?"\n"+bad+" FAILED":"\nAll pwa.ring checks passed.");
  process.exit(bad?1:0);
})().catch(e=>{console.error("ERROR",e.message);process.exit(1);});
