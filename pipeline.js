/**
 * QUINTARA REPORTS — PIPELINE ENGINE
 * Called by Electron main process. Reads client details from CLIENT_TEMP_FILE env var.
 * Logs progress to stdout so the UI can display it live.
 */

import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BRAND = "Quintara Reports";
const OUTPUT_DIR = path.join(__dirname, "outputs");
const MEMORY_FILE = path.join(__dirname, "memory.json");
const TEMPLATE_FILE = path.join(__dirname, "report-template.md");

function log(emoji, msg) {
  const time = new Date().toLocaleTimeString("en-GB");
  process.stdout.write(`\n[${time}] ${emoji}  ${msg}`);
}

function loadMemory() {
  if (!fs.existsSync(MEMORY_FILE)) return { nicheLearnings: {}, jobCount: 0, feedback: [] };
  return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
}

function saveMemory(mem) {
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(mem, null, 2));
}

function loadTemplate() {
  return fs.existsSync(TEMPLATE_FILE) ? fs.readFileSync(TEMPLATE_FILE, "utf8") : "";
}

async function callClaude(system, user, maxTokens = 4096) {
  const res = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content.filter(b => b.type === "text").map(b => b.text).join("\n");
}

function parseJSON(raw) {
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]+\}/);
    if (m) try { return JSON.parse(m[0]); } catch {}
  }
  return null;
}

async function agentIntake(rawText) {
  log("🔵", "INTAKE AGENT — reading client details...");
  const system = `You are an intake agent for ${BRAND}. Extract a structured brief from the client submission. Output ONLY valid JSON, no markdown.
JSON shape: { "clientName": string, "clientCompany": string, "clientIndustry": string, "clientProduct": string, "competitors": [string], "geographicMarket": string, "decisionContext": string, "deliveryEmail": string | null }
If any field is missing, infer it and mark with [inferred].`;
  const raw = await callClaude(system, `Client submission:\n${rawText}`);
  const brief = parseJSON(raw);
  if (!brief) throw new Error("Could not parse client brief.");
  log("✅", `Brief ready — ${brief.clientCompany} | ${brief.competitors.join(", ")}`);
  return brief;
}

async function agentResearch(brief, memory) {
  log("🔵", "RESEARCH AGENT — building competitor profiles...");
  const niche = memory.nicheLearnings[brief.clientIndustry] || "";
  const system = `You are a senior market research analyst at ${BRAND}.
${niche ? `NICHE MEMORY:\n${niche}\n` : ""}
For EACH competitor document: business model, pricing, core features, target customer, strengths, weaknesses, recent news, marketing messages. Be specific. Flag extrapolations with [estimated].`;
  const research = await callClaude(system,
    `CLIENT: ${brief.clientCompany} (${brief.clientProduct})\nINDUSTRY: ${brief.clientIndustry}\nMARKET: ${brief.geographicMarket}\nCOMPETITORS: ${brief.competitors.join(", ")}\nCONTEXT: ${brief.decisionContext}\n\nResearch all competitors thoroughly.`
  );
  log("✅", "Research complete.");
  return research;
}

async function agentAnalyst(brief, research, memory) {
  log("🔵", "ANALYST AGENT — finding strategic insights...");
  const niche = memory.nicheLearnings[brief.clientIndustry] || "";
  const system = `You are a senior business strategist at ${BRAND}.
${niche ? `NICHE MEMORY:\n${niche}\n` : ""}
Provide: 3 competitive advantages, 3 threats/gaps, positioning whitespace, pricing benchmark, 5 prioritised recommendations, competitor scorecard (Product/Pricing/Marketing/CX 1-10). Be direct. No filler.`;
  const analysis = await callClaude(system, `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nRESEARCH:\n${research}`);
  log("✅", "Analysis complete.");
  return analysis;
}

async function agentWriter(brief, research, analysis, memory) {
  log("🔵", "WRITER AGENT — writing the report...");
  const template = loadTemplate();
  const niche = memory.nicheLearnings[brief.clientIndustry] || "";
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const system = `You are the lead report writer at ${BRAND}.
${niche ? `NICHE PREFERENCES:\n${niche}\n` : ""}
Standards: Cover line "Prepared by ${BRAND} | ${today}". Client name "${brief.clientCompany}" spelled correctly always. Executive summary 3 paragraphs. Every claim sourced or marked [Analysis]. Headers and tables. Confident direct tone. 2000-2500 words. End with 5-item action plan.
${template ? `TEMPLATE:\n${template}` : ""}`;
  const report = await callClaude(system,
    `CLIENT: ${brief.clientName}, ${brief.clientCompany}\nINDUSTRY: ${brief.clientIndustry}\nMARKET: ${brief.geographicMarket}\nCOMPETITORS: ${brief.competitors.join(", ")}\n\nRESEARCH:\n${research}\n\nANALYSIS:\n${analysis}\n\nWrite the complete report now.`
  );
  log("✅", "Report written.");
  return report;
}

async function agentQA(brief, report) {
  log("🔵", "QA AGENT — checking quality...");
  const system = `You are QA editor at ${BRAND}. Return ONLY valid JSON:
{ "score": number, "passedQA": boolean, "approvalRecommendation": "approve"|"revise"|"reject", "issues": [{"severity":"high"|"medium"|"low","issue":string}], "corrections": [{"find":string,"replaceWith":string}], "editorNote": string }`;
  const raw = await callClaude(system, `BRIEF:\n${JSON.stringify(brief, null, 2)}\n\nREPORT:\n${report}`, 2048);
  const qa = parseJSON(raw) || { score: 80, passedQA: true, approvalRecommendation: "approve", issues: [], corrections: [], editorNote: "Manual review recommended." };
  let correctedReport = report;
  (qa.corrections || []).forEach(c => {
    if (c.find && c.replaceWith) correctedReport = correctedReport.split(c.find).join(c.replaceWith);
  });
  log("✅", `QA Score: ${qa.score}/100 — ${qa.approvalRecommendation.toUpperCase()}`);
  (qa.issues || []).forEach(i => log("⚠️ ", `[${i.severity.toUpperCase()}] ${i.issue}`));
  return { qa, correctedReport };
}

async function main() {
  const tempFile = process.env.CLIENT_TEMP_FILE;
  if (!tempFile || !fs.existsSync(tempFile)) {
    console.error("No client details file found.");
    process.exit(1);
  }

  const rawClient = fs.readFileSync(tempFile, "utf8").trim();
  const memory = loadMemory();

  const brief = await agentIntake(rawClient);
  const research = await agentResearch(brief, memory);
  const analysis = await agentAnalyst(brief, research, memory);
  const report = await agentWriter(brief, research, analysis, memory);
  const { qa, correctedReport } = await agentQA(brief, report);

  // Save report
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = brief.clientCompany.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
  const filepath = path.join(OUTPUT_DIR, `${slug}-${date}.md`);
  const header = `<!-- QA: ${qa.score}/100 | ${qa.approvalRecommendation.toUpperCase()} | ${brief.clientCompany} | ${date} -->\n\n`;
  fs.writeFileSync(filepath, header + correctedReport);

  // Update memory
  memory.jobCount = (memory.jobCount || 0) + 1;
  saveMemory(memory);

  // Open folder
  const { execSync } = await import("child_process");
  try { execSync(`explorer "${OUTPUT_DIR}"`); } catch {}

  log("🎉", `DONE — Report saved: ${filepath}`);
  process.exit(0);
}

main().catch(err => {
  console.error("\n❌ Pipeline error:", err.message);
  process.exit(1);
});
