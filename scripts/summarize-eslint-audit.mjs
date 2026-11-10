// This is an audit summary, not an attempt to hide lint errors or change code.
import { readFileSync, appendFileSync } from "node:fs";
const path=process.argv[2];
let rows;
try {rows=JSON.parse(readFileSync(path,"utf8"));}catch(error){
  console.error("ESLint audit could not parse its output",error);
  process.exitCode=1;
}
if(rows) {
  const summary={scanned:rows.length,filesWithErrors:0,errors:0,warnings:0,ruleCounts:{}};
  for(const file of rows) {
    summary.errors+=file.errorCount||0;
    summary.warnings+=file.warningCount||0;
    if(file.errorCount)summary.filesWithErrors++;
    for(const msg of file.messages||[]) {
      const rule=msg.ruleId||"parse-or-config-error";
      summary.ruleCounts[rule]=(summary.ruleCounts[rule]||0)+1;
    }
  }
  console.log("ESLINT-FULL-REPOSITORY-AUDIT",JSON.stringify(summary));
  if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    "\n### ESLint full source audit\nScanned "+summary.scanned+
    " files; "+summary.errors+" errors; "+summary.warnings+
    " warnings; "+summary.filesWithErrors+" files with errors."+
    " Original JSON retained in full repository audit artifact.\n");
}
