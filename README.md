# mcp-sec-regulations

SEC Regulations MCP — US securities regulations (17 CFR).

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1476+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `sec_regulation` | Get the full text of one SEC regulation — a US securities regulation codified in 17 CFR (SEC and CFTC) — by its citation or common rule name. Returns the exact regulatory wording currently in force. Answers "what does SEC Rule 10b-5 require", "what is the SEC regulation for X", "read 17 CFR 240.10b-5", "what does Regulation S-K item 303 say", "the SEC disclosure requirement for X". Forgiving input: "240.10b-5", "17 CFR 240.10b-5", "§ 229.303", "230.506(b)" (paragraph stripped to the section), "240.15l-1", "part 240". Common rule names resolve automatically: "Rule 10b-5" -> 240.10b-5, "Rule 10b5-1", "Rule 144", "Rule 506", "Rule 15c3-1" (net capital), "Regulation S-K" -> part 229, "Regulation S-X" -> part 210, "Reg FD" -> 243.100, "Reg NMS" -> part 242, "Reg SHO", "Reg D", "Reg A", "Reg S", "Regulation BI" -> 240.15l-1, "Form ADV" / Investment Advisers Act rules -> part 275, "Rule 206(4)-7". Covers securities regulation across all of Title 17: registration and offerings, disclosure requirements, insider trading, proxy rules, broker-dealer obligations, investment advisers, market structure, and CFTC commodity and derivatives regulation. Pass a whole part (e.g. "229" or "part 240") to get that part's section list. Example: sec_regulation({ citation: "240.10b-5" }) -> employment of manipulative and deceptive devices; sec_regulation({ citation: "Rule 10b-5" }) -> same section via the rule name. Keyless. This pack is the SEC RULES text; the separate `edgar` and `sec-xbrl` packs serve SEC filings data (company filings, XBRL financials). |
| `sec_regulations_search` | Keyword search across the SEC regulations — US securities regulation in 17 CFR (SEC and CFTC). Answers "what SEC regulations cover X", "the SEC rule about X", "find the securities regulation for X", "which disclosure requirement applies to X", "the CFTC regulation on X". Great for topics: insider trading and material nonpublic information, disclosure requirements and MD&A, registration statements and exempt offerings, private placements and accredited investors, proxy solicitations and shareholder proposals, broker-dealer net capital and customer protection, investment adviser fiduciary duty and custody, market structure and short sales, tender offers, beneficial ownership reporting, swaps and commodity futures. Returns matching securities rules with citation (17 CFR), heading, excerpt, and source URL. Example: sec_regulations_search({ query: "insider trading" }); sec_regulations_search({ query: "accredited investor definition", limit: 15 }). Keyless. Searches the SEC RULES text; the separate `edgar` and `sec-xbrl` packs search SEC filings data. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "sec-regulations": {
      "url": "https://gateway.pipeworx.io/sec-regulations/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/sec-regulations/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1476+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Sec Regulations data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
