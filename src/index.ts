interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * SEC Regulations MCP — US securities regulations (17 CFR).
 *
 * The SEC's rules ARE US federal regulations codified in Title 17 of the CFR
 * (Commodity and Securities Exchanges) — SEC parts 200-249 plus CFTC parts
 * 1-190. Agents search "SEC regulation on X", "Rule 10b-5", "17 CFR 240.10b-5",
 * "Regulation S-K item 303" — never "eCFR title 17". This is a thin,
 * SEC-branded, keyless wrapper over the official eCFR API (www.ecfr.gov/api),
 * scoped to the whole of Title 17: part 210 Regulation S-X, part 229
 * Regulation S-K, part 230 Securities Act rules (144, 506, Reg D/A/S),
 * part 240 Exchange Act rules (10b-5, 15l-1 Reg BI, 15c3-1/3), part 242
 * Regulation NMS/SHO/ATS/M, part 243 Regulation FD, part 275 Investment
 * Advisers Act rules (Form ADV), part 249 forms, plus CFTC commodity rules.
 *
 * Tools:
 * - sec_regulation:          full text of one SEC/CFTC rule by citation
 * - sec_regulations_search:  keyword search across the securities regulations
 *
 * Distinct from the `edgar` and `sec-xbrl` packs, which serve SEC FILINGS DATA
 * (company filings, financial statements, XBRL facts). This pack serves the
 * RULES — the regulatory text itself.
 *
 * Self-contained: does NOT import the eCFR pack — calls the eCFR API directly.
 */


const BASE = 'https://www.ecfr.gov/api';
const UA = 'pipeworx/1.0 (+https://pipeworx.io)';
const TITLE = 17;
const CITE = '17 CFR';

// --- XML/entity helpers ------------------------------------------------------
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripHtml(s: unknown): string {
  if (typeof s !== 'string') return '';
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function xmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<\?xml[^>]*\?>/g, '')
      .replace(/<HEAD>[\s\S]*?<\/HEAD>/g, '')
      .replace(/<\/(P|FP|HEAD|DIV\d+)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

// --- eCFR fetch with per-attempt timeout + 503 retry -------------------------
async function ecfrOnce(path: string, accept: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${BASE}${path}`, {
      headers: { Accept: accept, 'User-Agent': UA },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function ecfrFetch(path: string, accept: string, retries = 3): Promise<Response> {
  let res: Response | null = null;
  for (let i = 0; i < retries; i++) {
    try {
      res = await ecfrOnce(path, accept, 12000);
      if (res.status !== 503) return res;
    } catch {
      res = null; // aborted (timeout) or network error — retry
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  if (res) return res;
  throw new Error('eCFR temporarily unavailable (the eCFR text endpoint is timing out — retry in a few seconds).');
}

async function ecfrGet(path: string): Promise<Record<string, unknown>> {
  const res = await ecfrFetch(path, 'application/json');
  if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Record<string, unknown>;
}

// Current currency date for this title, with a 7-day-ago fallback.
async function currentDate(): Promise<string> {
  try {
    const data = await ecfrGet('/versioner/v1/titles.json');
    const titles = Array.isArray(data.titles) ? (data.titles as Array<Record<string, unknown>>) : [];
    const t = titles.find((x) => Number(x.number) === TITLE);
    if (t && typeof t.up_to_date_as_of === 'string' && t.up_to_date_as_of) return t.up_to_date_as_of;
  } catch {
    /* fall through to date fallback */
  }
  return new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
}

// --- rule-name -> citation map -----------------------------------------------
// Agents cite securities rules by NAME ("Rule 10b-5", "Regulation S-K",
// "Reg FD") far more often than by CFR section. Names resolve either straight
// to a section, or to a part (whose section list is then returned).
const NAME_MAP: Record<string, { part: string; section?: string }> = {
  // Exchange Act rules (part 240)
  'rule 10b-5': { part: '240', section: '240.10b-5' },
  '10b-5': { part: '240', section: '240.10b-5' },
  'rule 10b5-1': { part: '240', section: '240.10b5-1' },
  '10b5-1': { part: '240', section: '240.10b5-1' },
  'rule 10b5-2': { part: '240', section: '240.10b5-2' },
  'rule 10b-18': { part: '240', section: '240.10b-18' },
  'rule 13a-15': { part: '240', section: '240.13a-15' },
  'rule 14a-8': { part: '240', section: '240.14a-8' },
  'shareholder proposal rule': { part: '240', section: '240.14a-8' },
  'rule 15c3-1': { part: '240', section: '240.15c3-1' },
  'net capital rule': { part: '240', section: '240.15c3-1' },
  'rule 15c3-3': { part: '240', section: '240.15c3-3' },
  'customer protection rule': { part: '240', section: '240.15c3-3' },
  'regulation bi': { part: '240', section: '240.15l-1' },
  'reg bi': { part: '240', section: '240.15l-1' },
  'regulation best interest': { part: '240', section: '240.15l-1' },
  'rule 15l-1': { part: '240', section: '240.15l-1' },
  'rule 17a-4': { part: '240', section: '240.17a-4' },
  'books and records rule': { part: '240', section: '240.17a-4' },
  'exchange act rules': { part: '240' },
  // Securities Act rules (part 230)
  'rule 144': { part: '230', section: '230.144' },
  'rule 144a': { part: '230', section: '230.144A' },
  'rule 145': { part: '230', section: '230.145' },
  'rule 415': { part: '230', section: '230.415' },
  'shelf registration': { part: '230', section: '230.415' },
  'rule 501': { part: '230', section: '230.501' },
  'accredited investor': { part: '230', section: '230.501' },
  'rule 504': { part: '230', section: '230.504' },
  'rule 506': { part: '230', section: '230.506' },
  'rule 506(b)': { part: '230', section: '230.506' },
  'rule 506(c)': { part: '230', section: '230.506' },
  'rule 701': { part: '230', section: '230.701' },
  'regulation d': { part: '230', section: '230.501' },
  'reg d': { part: '230', section: '230.501' },
  'regulation a': { part: '230', section: '230.251' },
  'reg a': { part: '230', section: '230.251' },
  'regulation a+': { part: '230', section: '230.251' },
  'regulation s': { part: '230', section: '230.901' },
  'reg s': { part: '230', section: '230.901' },
  'securities act rules': { part: '230' },
  // Disclosure regulations
  'regulation s-k': { part: '229' },
  'reg s-k': { part: '229' },
  'regulation sk': { part: '229' },
  'item 303': { part: '229', section: '229.303' },
  'mdna': { part: '229', section: '229.303' },
  'regulation s-x': { part: '210' },
  'reg s-x': { part: '210' },
  'regulation sx': { part: '210' },
  'regulation fd': { part: '243', section: '243.100' },
  'reg fd': { part: '243', section: '243.100' },
  'regulation g': { part: '244', section: '244.100' },
  'reg g': { part: '244', section: '244.100' },
  'regulation ab': { part: '229', section: '229.1100' },
  'regulation crowdfunding': { part: '227' },
  'reg cf': { part: '227' },
  // Market structure (part 242)
  'regulation nms': { part: '242' },
  'reg nms': { part: '242' },
  'regulation sho': { part: '242', section: '242.200' },
  'reg sho': { part: '242', section: '242.200' },
  'regulation ats': { part: '242', section: '242.300' },
  'reg ats': { part: '242', section: '242.300' },
  'regulation m': { part: '242', section: '242.100' },
  'reg m': { part: '242', section: '242.100' },
  'regulation sci': { part: '242', section: '242.1000' },
  'reg sci': { part: '242', section: '242.1000' },
  // Investment Advisers Act (part 275) / Investment Company Act (part 270)
  'form adv': { part: '275', section: '275.203-1' },
  'investment advisers act rules': { part: '275' },
  'advisers act rules': { part: '275' },
  'rule 206(4)-7': { part: '275', section: '275.206(4)-7' },
  'compliance rule': { part: '275', section: '275.206(4)-7' },
  'custody rule': { part: '275', section: '275.206(4)-2' },
  'marketing rule': { part: '275', section: '275.206(4)-1' },
  'investment company act rules': { part: '270' },
};

function lookupName(norm: string): { part: string; section?: string } | null {
  const variants = [
    norm,
    norm.replace(/^(the|sec|cftc|commission)\s+/, ''),
    norm.replace(/^17\s*cfr\s*/, ''),
    norm.replace(/\s+(rules?|regulations?|requirements?)$/, ''),
    norm.replace(/^(the|sec|cftc|commission)\s+/, '').replace(/\s+(rules?|regulations?|requirements?)$/, ''),
    norm.replace(/^regulation\s+/, 'reg '),
    norm.replace(/^reg\s+/, 'regulation '),
  ];
  for (const v of variants) {
    const hit = NAME_MAP[v.trim()];
    if (hit) return hit;
  }
  return null;
}

// --- citation parsing --------------------------------------------------------
// Forgiving: "240.10b-5", "17 CFR 240.10b-5", "§ 229.303", "Rule 10b-5",
// "Regulation S-K", "230.506(b)", "240.15l-1", "part 240", "275.206(4)-7".
// Title-17 quirk: parentheses are USUALLY paragraphs ("230.506(b)" -> 230.506)
// but are part of the section number in the Advisers Act rules when followed
// by a hyphen-suffix ("275.206(4)-7"). The regex keeps a parenthetical only
// when a "-N" suffix follows it.
function parseCitation(raw: string): { section: string | null; part: string | null; resolved_from: string | null } {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/§+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/, '')
    .trim();

  const named = lookupName(norm);
  if (named) return { section: named.section ?? null, part: named.part, resolved_from: raw.trim() };

  let s = norm;
  s = s.replace(/\b(17\s*cfr|cfr|sec|cftc|parts?|subparts?|sections?|sec\.?|rules?|regulations?|reg\.?)\b/gi, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  // part.sectionbody — sectionbody = alnum head + optional "(x)(y)-N" tail
  // ("10b-5", "10b5-1", "15l-1", "144A", "303", "206(4)-7").
  const secMatch = s.match(/(\d{1,4})\.([0-9A-Za-z]+(?:(?:\([0-9A-Za-z]+\))*-[0-9A-Za-z]+)?)/);
  if (secMatch) return { section: `${secMatch[1]}.${secMatch[2]}`, part: secMatch[1], resolved_from: null };
  const partMatch = s.match(/\b(\d{1,4})\b/);
  if (partMatch) return { section: null, part: partMatch[1], resolved_from: null };
  return { section: null, part: null, resolved_from: null };
}

// Best-effort subpart lookup for a section, via the eCFR search hierarchy.
async function lookupSubpart(section: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ query: section, per_page: '5', order: 'relevance' });
    params.append('hierarchy[title]', String(TITLE));
    const data = await ecfrGet(`/search/v1/results?${params.toString()}`);
    const results = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
    for (const r of results) {
      const h = (r.hierarchy as Record<string, unknown> | undefined) ?? {};
      if (h.section != null && String(h.section) === section && h.subpart != null) {
        return String(h.subpart);
      }
    }
  } catch {
    /* ignore — subpart is optional metadata */
  }
  return null;
}

// --- tools -------------------------------------------------------------------
const tools: McpToolExport['tools'] = [
  {
    name: 'sec_regulation',
    description:
      'Get the full text of one SEC regulation — a US securities regulation codified in 17 CFR (SEC and CFTC) — by its citation or common rule name. Returns the exact regulatory wording currently in force. Answers "what does SEC Rule 10b-5 require", "what is the SEC regulation for X", "read 17 CFR 240.10b-5", "what does Regulation S-K item 303 say", "the SEC disclosure requirement for X". Forgiving input: "240.10b-5", "17 CFR 240.10b-5", "§ 229.303", "230.506(b)" (paragraph stripped to the section), "240.15l-1", "part 240". Common rule names resolve automatically: "Rule 10b-5" -> 240.10b-5, "Rule 10b5-1", "Rule 144", "Rule 506", "Rule 15c3-1" (net capital), "Regulation S-K" -> part 229, "Regulation S-X" -> part 210, "Reg FD" -> 243.100, "Reg NMS" -> part 242, "Reg SHO", "Reg D", "Reg A", "Reg S", "Regulation BI" -> 240.15l-1, "Form ADV" / Investment Advisers Act rules -> part 275, "Rule 206(4)-7". Covers securities regulation across all of Title 17: registration and offerings, disclosure requirements, insider trading, proxy rules, broker-dealer obligations, investment advisers, market structure, and CFTC commodity and derivatives regulation. Pass a whole part (e.g. "229" or "part 240") to get that part\'s section list. Example: sec_regulation({ citation: "240.10b-5" }) -> employment of manipulative and deceptive devices; sec_regulation({ citation: "Rule 10b-5" }) -> same section via the rule name. Keyless. This pack is the SEC RULES text; the separate `edgar` and `sec-xbrl` packs serve SEC filings data (company filings, XBRL financials).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        citation: {
          type: 'string',
          description:
            'Securities-regulation citation or rule name. A section: "240.10b-5", "17 CFR 240.10b-5", "§ 229.303", "230.506(b)", "275.206(4)-7". A rule name: "Rule 10b-5", "Rule 144", "Regulation S-K", "Reg FD", "Regulation BI". Or a whole part: "229", "part 240" -> returns the part\'s section list.',
        },
      },
      required: ['citation'],
    },
  },
  {
    name: 'sec_regulations_search',
    description:
      'Keyword search across the SEC regulations — US securities regulation in 17 CFR (SEC and CFTC). Answers "what SEC regulations cover X", "the SEC rule about X", "find the securities regulation for X", "which disclosure requirement applies to X", "the CFTC regulation on X". Great for topics: insider trading and material nonpublic information, disclosure requirements and MD&A, registration statements and exempt offerings, private placements and accredited investors, proxy solicitations and shareholder proposals, broker-dealer net capital and customer protection, investment adviser fiduciary duty and custody, market structure and short sales, tender offers, beneficial ownership reporting, swaps and commodity futures. Returns matching securities rules with citation (17 CFR), heading, excerpt, and source URL. Example: sec_regulations_search({ query: "insider trading" }); sec_regulations_search({ query: "accredited investor definition", limit: 15 }). Keyless. Searches the SEC RULES text; the separate `edgar` and `sec-xbrl` packs search SEC filings data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Securities-regulation topic or phrase, e.g. "insider trading", "accredited investor definition", "management discussion and analysis", "net capital requirements", "short sale".',
        },
        limit: { type: 'number', description: 'Max results to return, 1-20 (default 10).' },
      },
      required: ['query'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    switch (name) {
      case 'sec_regulation':
        return getRegulation(args);
      case 'sec_regulations_search':
        return searchRegulations(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function getRegulation(args: Record<string, unknown>): Promise<unknown> {
  const raw = typeof args.citation === 'string' ? args.citation : '';
  if (!raw.trim()) return { error: 'provide a citation, e.g. "240.10b-5", "Rule 10b-5" or "Regulation S-K"' };

  const { section, part, resolved_from } = parseCitation(raw);
  if (!part) {
    return {
      error: `Could not parse a securities citation from "${raw}". Use a section like "240.10b-5" or "229.303", a rule name like "Rule 10b-5" or "Regulation S-K", or a part like "240".`,
    };
  }

  const date = await currentDate();

  // ---- whole part requested: return its section list -----------------------
  if (!section) {
    const res = await ecfrFetch(
      `/versioner/v1/full/${date}/title-${TITLE}.xml?part=${encodeURIComponent(part)}`,
      'application/xml',
    );
    if (res.status === 404) return { error: `${CITE} part ${part} not found as of ${date}.`, part, date };
    if (res.status === 503) return { error: 'eCFR temporarily unavailable — retry in a few seconds.', part };
    if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const xml = await res.text();
    const blocks = xml.split(/<DIV8\b/).slice(1);
    const sections = blocks
      .map((b) => {
        const n = b.match(/\bN="([^"]+)"/)?.[1] ?? null;
        const head = b.match(/<HEAD>([\s\S]*?)<\/HEAD>/);
        return { section: n, heading: head ? stripHtml(head[1]) : null };
      })
      .filter((s) => s.section);
    return {
      part,
      citation: `${CITE} Part ${part}`,
      resolved_from: resolved_from ?? null,
      date,
      source: 'eCFR / 17 CFR (SEC and CFTC securities regulations)',
      source_url: `https://www.ecfr.gov/current/title-${TITLE}/part-${part}`,
      section_count: sections.length,
      note: `This is a whole securities-regulation part (${sections.length} sections). Call sec_regulation with a specific citation (e.g. "${sections[0]?.section ?? part + '.1'}") to get full text.`,
      sections,
    };
  }

  // ---- single section ------------------------------------------------------
  const res = await ecfrFetch(
    `/versioner/v1/full/${date}/title-${TITLE}.xml?part=${encodeURIComponent(part)}&section=${encodeURIComponent(section)}`,
    'application/xml',
  );
  if (res.status === 404 || res.status === 400) {
    return {
      error: `SEC regulation ${CITE} ${section} not found as of ${date}. Check the citation, or use sec_regulations_search to find it.`,
      citation: `${CITE} ${section}`,
      part,
      date,
    };
  }
  if (res.status === 503) return { error: 'eCFR temporarily unavailable — retry in a few seconds.', citation: `${CITE} ${section}` };
  if (!res.ok) throw new Error(`eCFR: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.text();
  // eCFR returns JSON {"error":"No matching content found."} for removed/absent sections
  if (body.trim().startsWith('{')) {
    return {
      error: `SEC regulation ${CITE} ${section} not found as of ${date}. Check the citation, or use sec_regulations_search to find it.`,
      citation: `${CITE} ${section}`,
      part,
      date,
    };
  }
  const xml = body;

  const headMatch = xml.match(/<HEAD>([\s\S]*?)<\/HEAD>/);
  const heading = headMatch ? stripHtml(headMatch[1]) : null;
  const full = xmlToText(xml);
  const CAP = 30000;
  const truncated = full.length > CAP;
  const subpart = await lookupSubpart(section);

  return {
    citation: `${CITE} ${section}`,
    part,
    subpart: subpart ?? null,
    resolved_from: resolved_from ?? null,
    heading,
    text: truncated ? full.slice(0, CAP) : full,
    truncated,
    date,
    source: 'eCFR / 17 CFR (SEC and CFTC securities regulations)',
    source_url: `https://www.ecfr.gov/current/title-${TITLE}/section-${section}`,
  };
}

async function searchRegulations(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { error: 'provide a query, e.g. "insider trading" or "accredited investor definition"' };

  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 20);

  // eCFR search returns one row per matching PARAGRAPH, so a single dense
  // section can fill an entire page. Dedupe by citation and walk up to 3 pages
  // (20/page, the API max) until `limit` distinct sections are collected.
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];
  let total: unknown = null;

  for (let page = 1; page <= 3 && results.length < limit; page++) {
    const params = new URLSearchParams({
      query,
      per_page: '20',
      page: String(page),
      order: 'relevance',
    });
    params.append('hierarchy[title]', String(TITLE));

    const data = await ecfrGet(`/search/v1/results?${params.toString()}`);
    const meta = (data.meta as Record<string, unknown> | undefined) ?? {};
    if (total == null) total = meta.total_count ?? null;
    const rawResults = Array.isArray(data.results) ? (data.results as Array<Record<string, unknown>>) : [];
    if (rawResults.length === 0) break;

    for (const r of rawResults) {
      if (results.length >= limit) break;
      const h = (r.hierarchy as Record<string, unknown> | undefined) ?? {};
      const headings = (r.headings as Record<string, unknown> | undefined) ?? {};
      const hHeadings = (r.hierarchy_headings as Record<string, unknown> | undefined) ?? {};
      const part = h.part != null ? String(h.part) : null;
      const section = h.section != null ? String(h.section) : null;
      const subpart = h.subpart != null ? String(h.subpart) : null;
      if (!section && !part) continue;
      const heading =
        (typeof headings.section === 'string' && stripHtml(headings.section)) ||
        (typeof hHeadings.section === 'string' && stripHtml(hHeadings.section)) ||
        null;
      let citation: string;
      let source_url: string;
      if (section) {
        citation = `${CITE} ${section}`;
        source_url = `https://www.ecfr.gov/current/title-${TITLE}/section-${section}`;
      } else {
        citation = `${CITE} Part ${part}`;
        source_url = `https://www.ecfr.gov/current/title-${TITLE}/part-${part}`;
      }
      if (seen.has(citation)) continue;
      seen.add(citation);
      results.push({
        part,
        subpart,
        section,
        citation,
        heading,
        excerpt: stripHtml(r.full_text_excerpt ?? (r as Record<string, unknown>).excerpt).slice(0, 300),
        source_url,
      });
    }
    if (rawResults.length < 20) break;
  }

  return {
    query,
    total_matches: total,
    count: results.length,
    scope: 'SEC regulations — 17 CFR (Commodity and Securities Exchanges: SEC + CFTC)',
    source: 'eCFR / 17 CFR',
    results,
  };
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
