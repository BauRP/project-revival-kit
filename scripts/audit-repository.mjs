// Reproducible line-by-line static survey of EVERY git-tracked file.
// Findings are investigation leads, not automatically proven vulnerabilities.
// Binary files have headers/digests inspected, not fictional source lines.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const paths = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter(Boolean);
const binaryExt = /\.(?:png|jpe?g|webp|gif|ico|jar|woff2?|ttf|otf|pdf|so|apk|p12|jks|keystore|zip)$/i;
const rules = [
  ["embedded-secret", "critical", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[a-zA-Z0-9]{30,}|AIza[0-9A-Za-z_-]{35}|sk-[a-zA-Z0-9_-]{30,}/],
  ["dynamic-code", "high", /\beval\s*\(|\bnew\s+Function\s*\(|\bdocument\.write\s*\(/],
  ["html-injection-sink", "medium", /dangerouslySetInnerHTML|innerHTML\s*=/],
  ["outbound-network", "review", /\bfetch\s*\(|XMLHttpRequest|https?:\/\/|@capacitor\/(http|browser)/],
  ["web-storage", "review", /(?:localStorage|sessionStorage)\.(?:setItem|getItem)\s*\(/],
  ["destructive-storage", "high", /deleteDatabase\s*\(|localStorage\.clear\s*\(/],
  ["swallowed-error", "review", /\.catch\s*\(\s*\(\s*\)\s*=>\s*(?:undefined|false|null|\{\s*\})|catch\s*\{\s*\}/],
  ["large-binary-read", "review", /\.arrayBuffer\s*\(|readAsArrayBuffer\s*\(|decodeAudioData\s*\(/],
  ["async-listener", "review", /\baddEventListener\s*\(|\bsetInterval\s*\(|\bsetTimeout\s*\(/],
  ["unfinished", "review", /\bTODO\b|\bFIXME\b|not implemented|unimplemented/i],
  ["debug-logging", "review", /\bconsole\.(?:log|debug|info)\s*\(|\bLog\.(?:d|i)\s*\(/]
];
const decoder = new TextDecoder("utf-8", {fatal:true});
const files=[], findings=[], folders={};
let lines=0, bytes=0, unreadable=0;
for(const path of paths) {
  let buf;
  try {buf=readFileSync(path);} catch {unreadable++;continue;}
  const dir=path.split("/")[0], hash=createHash("sha256").update(buf).digest("hex");
  folders[dir] ||= {files:0,lines:0,bytes:0};
  folders[dir].files++; folders[dir].bytes+=buf.length; bytes+=buf.length;
  const binary=binaryExt.test(path)||buf.includes(0);
  if(binary) {
    let magic=true;
    if(/\.png$/i.test(path))magic=buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if(/\.jar$/i.test(path))magic=buf.subarray(0,2).toString("ascii")==="PK";
    if(/\.ico$/i.test(path))magic=buf.subarray(0,4).equals(Buffer.from([0,0,1,0]));
    if(!magic)findings.push({path,line:null,rule:"invalid-binary-header",severity:"high"});
    files.push({path,format:"binary",bytes:buf.length,sha256:hash,magic});
    continue;
  }
  let str;
  try {str=decoder.decode(buf);} catch {
    unreadable++;findings.push({path,line:null,rule:"invalid-utf8",severity:"high"});
    files.push({path,format:"unreadable",bytes:buf.length,sha256:hash});continue;
  }
  const rows=str.split(/\r?\n/),flags={};
  lines+=rows.length;folders[dir].lines+=rows.length;
  for(let i=0;i<rows.length;i++) {
    const row=rows[i],trimmed=row.trim();
    const comment=/^(?:\/\/|\/\*|\*|#|<!--|--|>)/.test(trimmed)||/\.(?:md|json|lock)$/.test(path);
    for(const [name,severity,pattern] of rules)if(pattern.test(row)) {
      findings.push({path,line:i+1,rule:name,severity,context:comment?"comment-or-doc":"source"});
      flags[name]=(flags[name]||0)+1;
    }
  }
  files.push({path,format:"text",lines:rows.length,bytes:buf.length,sha256:hash,flags});
}
const coverage={tracked:paths.length,examined:files.length,sourceLines:lines,
  textFiles:files.filter(f=>f.format==="text").length,
  binaryFiles:files.filter(f=>f.format==="binary").length,bytes,unreadable};
const report={timestamp:new Date().toISOString(),sha:process.env.GITHUB_SHA||"",
  coverage,folders,files,findings,note:"Pattern matches need human investigation. No emulator/runtime validation is implied by this scanner."};
const target=join(process.env.RUNNER_TEMP||"/tmp","trivo-repo-audit");
mkdirSync(target,{recursive:true});
writeFileSync(join(target,"repository-audit.json"),JSON.stringify(report,null,2)+"\n");
const grouped={};
for(const v of findings){let k=v.rule+":"+v.context;grouped[k]=(grouped[k]||0)+1;}
console.log("REPOSITORY-AUDIT",JSON.stringify({coverage,flagCounts:grouped}));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  "\n## Complete tracked repository static inventory\n"+files.length+" of "+paths.length+
  " files; "+lines+" textual lines; "+coverage.binaryFiles+
  " binary files; unreadable "+unreadable+
  ". Detailed file/line JSON attached as workflow artifact.\n");
if(unreadable)process.exitCode=1;
