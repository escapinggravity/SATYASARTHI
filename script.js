'use strict';
const $ = s => document.querySelector(s);
const LS = { get: k => localStorage.getItem(k) || '', set: (k, v) => localStorage.setItem(k, v) };
const MAX_ROUNDS = 3, MAX_CLAIMS = 5;
let kind = 'text', img = null, results = [], sel = 0;

/* ---------- helpers ---------- */
const el = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); kids.forEach(k => e.append(k)); return e; };
const safeUrl = u => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : '#'; } catch { return '#'; } };
const log = m => { $('#logCard').hidden = false; const li = el('li', { textContent: m }); $('#log').append(li); li.scrollIntoView({ block: 'nearest' }); };
const norm = s => s.toLowerCase().replace(/\s+/g, ' ').trim();

/* ---------- tools ---------- */
async function gemma(prompt, image) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LS.get('gmodel') || 'gemma-3-27b-it'}:generateContent`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': LS.get('gkey') },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.1 } })
  });
  if (!r.ok) throw new Error(`Gemma API error ${r.status}`);
  const j = await r.json();
  return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
}
function parseJSON(t) { const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error('Model returned no JSON'); return JSON.parse(m[0]); }
async function tavily(path, body) {
  const r = await fetch('https://api.tavily.com/' + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + LS.get('tkey') }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Tavily error ${r.status}`);
  return r.json();
}

/* ---------- verdict logic: only verified quotes count ---------- */
function verifyEvidence(ev, sources) {
  return (ev || []).filter(e => {
    const s = sources.find(x => x.id === e.source);
    return s && e.quote && e.quote.length >= 12 && norm(s.text).includes(norm(e.quote)) && (e.stance === 'supports' || e.stance === 'contradicts');
  });
}
function decide(model, ev, n) {
  const sup = ev.filter(e => e.stance === 'supports').length, con = ev.filter(e => e.stance === 'contradicts').length;
  if (sup && con) return 'INCONCLUSIVE';
  if (con && model === 'CONTRADICTED') return 'CONTRADICTED';
  if (sup && model === 'SUPPORTED') return 'SUPPORTED';
  return !sup && !con && n === 0 ? 'UNVERIFIED' : 'INCONCLUSIVE'; // absence of evidence is never "false"
}

/* ---------- agent ---------- */
async function investigate(input) {
  let content = input.text || '';
  if (input.kind === 'url') {
    log('Extracting content from submitted URL');
    const x = await tavily('extract', { urls: [content] });
    content = (x.results?.[0]?.raw_content || '').slice(0, 8000);
    if (!content) throw new Error('Could not read that URL. Paste its text instead.');
  }
  log('Extracting atomic factual claims with Gemma');
  const ex = parseJSON(await gemma(`Extract up to ${MAX_CLAIMS} distinct, checkable factual claims (who/what/when/numbers) from the ${input.img ? 'screenshot' : 'content'} below. Ignore opinions. Return ONLY JSON: {"claims":[{"text":"..."}]}\n\n${content}`, input.img));
  const claims = (ex.claims || []).slice(0, MAX_CLAIMS);
  if (!claims.length) throw new Error('No checkable factual claims found.');
  results = claims.map(c => ({ claim: c.text, verdict: 'PENDING', reasoning: '', evidence: [], missing: [], sources: [] }));
  sel = 0; $('#dash').hidden = false; render();

  for (let i = 0; i < claims.length; i++) {
    const sources = []; let queries, a = {}, ev = [];
    log(`[C${i + 1}] Planning investigation`);
    try { queries = parseJSON(await gemma(`Write 2 web search queries: one to find evidence supporting, one to find evidence contradicting or fact-checking this claim. Return ONLY JSON {"queries":["..",".."]}\nClaim: ${claims[i].text}`)).queries.slice(0, 2); }
    catch { queries = [claims[i].text]; }
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      for (const q of queries) {
        log(`[C${i + 1}] Round ${round}: searching "${q}"`);
        try {
          const res = await tavily('search', { query: q, max_results: 5, search_depth: 'advanced' });
          for (const r of res.results || []) if (!sources.some(s => s.url === r.url))
            sources.push({ id: 'S' + (sources.length + 1), url: r.url, title: r.title, text: r.content || '' });
        } catch (e) { log(`[C${i + 1}] Search failed: ${e.message}`); }
      }
      log(`[C${i + 1}] Analyzing ${sources.length} sources for contradictions`);
      if (!sources.length) a = { reasoning: 'No sources retrieved.', missing: ['Any independent source covering this claim'], follow_up_queries: [] };
      else {
        try {
          a = parseJSON(await gemma(`You are a careful fact-checker. Judge the claim ONLY from the sources. Quotes must be copied EXACTLY from a source. Look for contradictions between sources.\nClaim: ${claims[i].text}\n\nSOURCES:\n${sources.map(s => `[${s.id}] ${s.title} (${s.url})\n${s.text.slice(0, 2500)}`).join('\n\n')}\n\nReturn ONLY JSON: {"verdict":"SUPPORTED|CONTRADICTED|INCONCLUSIVE","reasoning":"..","evidence":[{"source":"S1","stance":"supports|contradicts","quote":"exact text"}],"missing":["evidence needed for stronger verification"],"needs_more":true,"follow_up_queries":["..."]}`));
        } catch (e) { a = { reasoning: 'Analysis failed: ' + e.message, missing: [], follow_up_queries: [] }; }
      }
      ev = verifyEvidence(a.evidence, sources);
      if ((ev.length && !a.needs_more) || round === MAX_ROUNDS || !(a.follow_up_queries || []).length) break;
      log(`[C${i + 1}] Evidence insufficient — planning follow-up searches`);
      queries = a.follow_up_queries.slice(0, 2);
    }
    const used = new Set(ev.map(e => e.source));
    results[i] = { claim: claims[i].text, verdict: decide(a.verdict, ev, sources.length), reasoning: a.reasoning || '',
      evidence: ev, missing: a.missing || [], sources: sources.map(s => ({ ...s, cited: used.has(s.id) })) };
    render();
  }
  finish();
}

/* ---------- rendering (textContent only: no XSS from model/web content) ---------- */
function render() {
  const box = $('#claims'); box.replaceChildren();
  results.forEach((r, i) => box.append(el('button', { className: i === sel ? 'sel' : '', onclick: () => { sel = i; render(); } },
    el('span', { className: 'badge ' + r.verdict, textContent: r.verdict }), r.claim)));
  const r = results[sel], d = $('#detail'); d.replaceChildren();
  if (!r) return;
  d.append(el('span', { className: 'badge ' + r.verdict, textContent: r.verdict }), el('strong', { textContent: r.claim }),
    el('p', { textContent: r.reasoning || 'Investigating…' }));
  r.evidence.forEach(e => {
    const s = r.sources.find(x => x.id === e.source);
    d.append(el('blockquote', { className: e.stance }, `“${e.quote}” `, el('a', { href: safeUrl(s.url), target: '_blank', rel: 'noopener noreferrer', textContent: s.title || s.url })));
  });
  if (r.verdict !== 'PENDING') {
    d.append(el('strong', { textContent: 'What’s missing?' }), el('ul', {}, ...r.missing.map(m => el('li', { textContent: m }))));
    d.append(el('details', {}, el('summary', { textContent: `All ${r.sources.length} sources inspected` }),
      el('ul', {}, ...r.sources.map(s => el('li', {}, el('a', { href: safeUrl(s.url), target: '_blank', rel: 'noopener noreferrer', textContent: s.title || s.url }))))));
  }
}
function drawGraph() {
  const NS = 'http://www.w3.org/2000/svg', svg = $('#graph'); svg.replaceChildren();
  const mk = (t, a, txt) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); if (txt) e.textContent = txt; svg.append(e); return e; };
  const col = { SUPPORTED: '#059669', CONTRADICTED: '#dc2626', UNVERIFIED: '#64748b', INCONCLUSIVE: '#d97706' };
  let y = 10;
  results.forEach((r, i) => {
    const cy = y; mk('rect', { x: 10, y: cy, width: 230, height: 36, rx: 6, fill: col[r.verdict] || '#94a3b8' });
    const t = mk('text', { x: 18, y: cy + 22 }, `C${i + 1}: ${r.claim.slice(0, 30)}…`); t.style.fill = '#fff';
    r.sources.filter(s => s.cited).forEach(s => {
      mk('line', { x1: 240, y1: cy + 18, x2: 300, y2: y + 18, stroke: '#94a3b8' });
      mk('rect', { x: 300, y, width: 170, height: 36, rx: 6, fill: 'none', stroke: '#94a3b8' });
      let host = s.url; try { host = new URL(s.url).hostname; } catch {}
      mk('text', { x: 308, y: y + 22 }, host.slice(0, 24));
      r.evidence.filter(e => e.source === s.id).forEach((e, k) => {
        const c = e.stance === 'supports' ? '#059669' : '#dc2626';
        mk('line', { x1: 470, y1: y + 18, x2: 520, y2: y + 18 + k * 0, stroke: c });
        mk('rect', { x: 520, y, width: 300, height: 36, rx: 6, fill: 'none', stroke: c, 'stroke-width': 2 });
        mk('text', { x: 528, y: y + 22 }, `“${e.quote.slice(0, 40)}…”`); y += 44;
      });
      y += 8;
    });
    y += 30;
  });
  svg.setAttribute('width', 830); svg.setAttribute('height', y + 10);
}
function finish() {
  const counts = {}; results.forEach(r => counts[r.verdict] = (counts[r.verdict] || 0) + 1);
  const list = results.flatMap((r, i) => [
    ...(r.verdict !== 'SUPPORTED' ? r.missing.map(m => `Claim ${i + 1}: ${m}`) : []),
    ...(r.verdict === 'CONTRADICTED' ? [`Claim ${i + 1}: Do not share — cite the contradicting sources`] : [])]);
  $('#summary').textContent = Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · ');
  $('#checklist').replaceChildren(...list.map(t => el('label', { className: 'check' }, el('input', { type: 'checkbox' }), t)));
  $('#report').hidden = false; $('#graphCard').hidden = false; drawGraph();
}

/* ---------- wiring ---------- */
$('#theme').onclick = () => { document.documentElement.classList.toggle('dark'); LS.set('theme', document.documentElement.classList.contains('dark') ? 'dark' : ''); };
if (LS.get('theme')) document.documentElement.classList.add('dark');
$('#gkey').value = LS.get('gkey'); $('#tkey').value = LS.get('tkey'); if (LS.get('gmodel')) $('#gmodel').value = LS.get('gmodel');
$('#save').onclick = () => { LS.set('gkey', $('#gkey').value.trim()); LS.set('tkey', $('#tkey').value.trim()); LS.set('gmodel', $('#gmodel').value.trim()); $('#settings').open = false; };
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('on')); b.classList.add('on'); kind = b.dataset.k;
  $('#input').hidden = kind === 'image'; $('#file').hidden = kind !== 'image';
  $('#input').placeholder = kind === 'url' ? 'https://…' : 'Paste a suspicious message or claim';
});
$('#file').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(f.type) || f.size > 3.5e6) { $('#err').textContent = 'PNG/JPEG/WebP under 3.5 MB only.'; e.target.value = ''; return; }
  const r = new FileReader(); r.onload = () => { img = { mime: f.type, data: r.result.split(',')[1] }; }; r.readAsDataURL(f);
};
$('#go').onclick = async () => {
  const err = $('#err'); err.textContent = '';
  if (!LS.get('gkey') || !LS.get('tkey')) { err.textContent = 'Add your Gemini and Tavily API keys first.'; $('#settings').open = true; return; }
  const text = $('#input').value.trim();
  if (kind === 'image' ? !img : !text) { err.textContent = 'Provide something to investigate.'; return; }
  if (kind === 'url' && !/^https?:\/\//.test(text)) { err.textContent = 'Enter a valid http(s) URL.'; return; }
  $('#go').disabled = true; $('#log').replaceChildren(); $('#report').hidden = $('#graphCard').hidden = true;
  try { await investigate({ kind, text, img: kind === 'image' ? img : null }); }
  catch (e) { err.textContent = e.message || 'Investigation failed.'; }
  $('#go').disabled = false;
};
