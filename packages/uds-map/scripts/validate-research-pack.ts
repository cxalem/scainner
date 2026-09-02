import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatValidationReport, validateResearchPack } from "./research-pack.ts";

export function runValidation(input: string): number {
  const result = validateResearchPack(resolve(input));
  process.stdout.write(`${formatValidationReport(result)}\n`);
  return result.failures.length ? 1 : 0;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  const input = process.argv[2];
  if (!input || input.startsWith("--")) {
    process.stderr.write("usage: research:validate <pack-directory>\n");
    process.exit(2);
  }
  process.exit(runValidation(input));
}
