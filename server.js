import http from "node:http";
import { readFile } from "node:fs/promises";

const { ANTHROPIC_API_KEY: KEY, MODEL = "claude-sonnet-5-5", ACCESS_CODE, PORT = 3000 } = process.env;
if (!KEY) { console.error("Missing ANTHROPIC_API_KEY (see .env.example)"); process.exit(1); }

const MODES = {
  deep: "a deep dive: background, key facts, current state, debates, outlook",
  compare: "a side-by-side comparison with a clear verdict and when each option wins",
  fact: "a fact-check: split the claim into parts, rate each true, false, misleading or unverifiable",
  market: "market and competitor analysis: players, positioning, pricing, gaps, risks",
  dd: "due diligence on a company or product using public business information: model, strengths, risks, red flags",
  eli: "a plain-language explanation with examples and common misconceptions",
};
const DEPTH = { quick: 3, std: 5, deep: 7 };
const RULE = "You are the research engine of CASS by abdul. Never compile personal information about private individuals; if the topic is a private person, say you can't research them. Be honest about uncertainty and never invent sources, quotes or statistics.";

async function ask({ messages, system = RULE, search = false, max_tokens = 1800 }) {
  let msgs = messages, text = "", sources = [];
  for (let k = 0; k < 3; k++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens, system, messages: msgs,
        ...(search && { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }] }),
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || r.statusText);
    for (const b of j.content) {
      if (b.type === "text") text += b.text;
      if (b.type === "web_search_tool_result" && Array.isArray(b.content))
        for (const s of b.content) if (s.url) sources.push({ url: s.url, title: s.title });
    }
    if (j.stop_reason !== "pause_turn") break;
    msgs = [...messages, { role: "assistant", content: j.content }];
  }
  return { text, sources };
}

async function research(b, send) {
  const n = DEPTH[b.depth] || 5, mode = MODES[b.mode] || MODES.deep, topic = String(b.topic || "").slice(0, 1500);
  const plan = JSON.parse((await ask({
    max_tokens: 700,
    messages: [{ role: "user", content: `Plan research. Task: ${mode}\nTopic: ${topic}\nReturn only JSON: {"title":"short title","questions":[${n} specific, distinct sub-questions]}` }],
  })).text.replace(/```json|```/g, "").trim());
  const qs = plan.questions.slice(0, n);
  send({ t: "plan", title: plan.title, questions: qs });

  const pool = [];
  const num = s => { let i = pool.findIndex(p => p.url === s.url); if (i < 0) i = pool.push(s) - 1; return i + 1; };
  const found = await Promise.all(qs.map(async (q, i) => {
    const r = await ask({
      search: true,
      messages: [{ role: "user", content: `Topic: ${topic}\nQuestion: ${q}\nSearch the web, then answer in 150-220 words with concrete, current facts and dates. End with "Confidence: high/medium/low" and flag any conflict between sources.` }],
    });
    const ids = [...new Set(r.sources.map(num))];
    send({ t: "step", i });
    return `Q: ${q}\n${r.text}\nSources: ${ids.map(x => `[${x}]`).join(" ")}`;
  }));

  const rep = await ask({
    max_tokens: 3500,
    messages: [{ role: "user", content: `Write a research report on: ${topic}\nType: ${mode}\n\nFindings:\n${found.join("\n\n")}\n\nMarkdown, with a blank line between every heading, paragraph and list. Sections: "## Bottom line" (3 sentences), "## Key findings" (bullets), "## Analysis" (### subsections), "## Risks and open questions" (bullets), "## Next steps" (bullets). Cite claims with [n] using the source numbers above; never cite a number not listed.` }],
  });
  send({ t: "done", title: plan.title, report: rep.text, sources: pool });
}

async function followup(b) {
  const history = (b.messages || []).slice(-8).map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 3000) }));
  return ask({
    search: true,
    system: RULE + " Use the report as context and search the web if it doesn't cover the question. Be concise.",
    messages: [{ role: "user", content: "Report:\n" + String(b.report || "").slice(0, 20000) }, { role: "assistant", content: "Ready." }, ...history],
  });
}

const body = req => new Promise((ok, no) => {
  let d = "";
  req.on("data", c => { d += c; if (d.length > 2e5) req.destroy(); });
  req.on("end", () => { try { ok(JSON.parse(d || "{}")); } catch (e) { no(e); } });
});

http.createServer(async (req, res) => {
  try {
    if (req.method === "GET") {
      if (req.url !== "/" && req.url !== "/index.html") { res.writeHead(404); return res.end(); }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return res.end(await readFile(new URL("./public/index.html", import.meta.url)));
    }
    if (ACCESS_CODE && req.headers["x-access-code"] !== ACCESS_CODE) { res.writeHead(401); return res.end("{}"); }
    const b = await body(req);
    if (req.url === "/api/research") {
      res.writeHead(200, { "content-type": "application/x-ndjson", "cache-control": "no-store" });
      const send = e => res.write(JSON.stringify(e) + "\n");
      try { await research(b, send); } catch (e) { send({ t: "error", message: e.message }); }
      return res.end();
    }
    if (req.url === "/api/ask") {
      const out = await followup(b);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end();
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}).listen(PORT, () => console.log(`CASS by abdul running on http://localhost:${PORT}`));
    
