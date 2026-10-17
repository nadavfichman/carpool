// Shared state for the carpool board, stored in Upstash Redis (free tier via Vercel Storage).
const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const DEFAULT_CONFIG = {
  families: ["נדב פיכמן","סמדר אבן פיכמן","חגית ברנס","ניר ברנס","יובל קינן","יפית קינן","שי מיכאלי","שרון בוסתן"],
  groups: [
    {name:"פיכמן", members:["נדב פיכמן","סמדר אבן פיכמן"]},
    {name:"ברנס", members:["חגית ברנס","ניר ברנס"]},
    {name:"קינן", members:["יובל קינן","יפית קינן"]},
    {name:"מיכאלי", members:["שי מיכאלי","שרון בוסתן"]}
  ]
};

async function redis(cmd){
  const r = await fetch(URL_, {method:"POST", headers:{Authorization:"Bearer "+TOKEN,"Content-Type":"application/json"}, body:JSON.stringify(cmd)});
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

const clean = (v, n=120) => String(v ?? "").slice(0, n);
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d||"");

module.exports = async (req, res) => {
  res.setHeader("Cache-Control","no-store");
  if (!URL_ || !TOKEN) return res.status(500).json({error:"no_db"});
  try {
    if (req.method === "GET") {
      const [cfg, all] = await Promise.all([redis(["GET","config"]), redis(["HGETALL","sessions"])]);
      const sessions = [];
      for (let i=0; i<(all||[]).length; i+=2) { try { sessions.push(JSON.parse(all[i+1])); } catch(e){} }
      return res.status(200).json({config: cfg ? JSON.parse(cfg) : DEFAULT_CONFIG, sessions});
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    if (b.action === "assign") {
      if (!["there","back"].includes(b.key)) return res.status(400).json({error:"bad_key"});
      const raw = await redis(["HGET","sessions",clean(b.id,40)]);
      if (!raw) return res.status(404).json({error:"not_found"});
      const s = JSON.parse(raw); s[b.key] = clean(b.value,60);
      await redis(["HSET","sessions",s.id,JSON.stringify(s)]);
      return res.status(200).json({ok:true});
    }
    if (b.action === "add") {
      const list = Array.isArray(b.sessions) ? b.sessions.slice(0,20) : [];
      for (const o of list) {
        if (!okDate(o.date)) continue;
        const id = Date.now().toString(36)+Math.random().toString(36).slice(2,7);
        const s = {id, date:o.date, week:clean(o.week,10), time:clean(o.time,5), title:clean(o.title)||"אימון", note:clean(o.note,80), there:"", back:""};
        await redis(["HSET","sessions",id,JSON.stringify(s)]);
      }
      return res.status(200).json({ok:true});
    }
    if (b.action === "delete") {
      await redis(["HDEL","sessions",clean(b.id,40)]);
      return res.status(200).json({ok:true});
    }
    if (b.action === "config") {
      const families = (b.families||[]).map(f=>clean(f,60)).filter(Boolean).slice(0,12);
      const groups = Array.isArray(b.groups) ? b.groups.slice(0,8) : [];
      await redis(["SET","config",JSON.stringify({families, groups})]);
      return res.status(200).json({ok:true});
    }
    return res.status(400).json({error:"bad_action"});
  } catch (e) {
    return res.status(500).json({error:"server", message:String(e.message||e)});
  }
};
