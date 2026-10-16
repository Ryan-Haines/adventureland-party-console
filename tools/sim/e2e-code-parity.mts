import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
type Attachment = { name: string; path: string };
type Outcome = { title: string; attachments: Attachment[] };
export function verifyCodeParity(directory: string, gameplay: string[]) {
  const generations: Record<string, string[]> = {};
  for (const backend of ["native", "accelerated"]) {
    const archive = path.join(directory, backend),
      manifest = JSON.parse(
        readFileSync(path.join(archive, ".build/e2e-report/manifest.json"), "utf8"),
      ) as { tests: Outcome[] };
    generations[backend] = manifest.tests
      .filter((test) => gameplay.includes(test.title.split(" > ").at(-1)!))
      .map((test) => {
        const name = backend === "native" ? "live-build-manifest" : "report.json",
          file = test.attachments.find((attachment) => attachment.name === name);
        if (!file) throw Error(`Missing ${backend} CODE generation: ${test.title}`);
        const report = JSON.parse(
          readFileSync(path.join(archive, file.path.replaceAll("\\", "/")), "utf8"),
        );
        const generation = backend === "native" ? report.generation : report.codeGeneration;
        if (!/^[a-f0-9]{64}$/.test(generation)) throw Error("Invalid CODE generation");
        return generation;
      });
    if (generations[backend].length !== gameplay.length)
      throw Error("Incomplete CODE parity evidence");
  }
  if (new Set(Object.values(generations).flat()).size !== 1)
    throw Error("Benchmark ran different character CODE generations");
  const result = { pass: true, generation: generations.native[0], generations };
  writeFileSync(path.join(directory, "code-parity.json"), JSON.stringify(result, null, 2));
  return result;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const gameplay: string[] = JSON.parse(
    readFileSync(path.join(root, "e2e/gameplay-titles.json"), "utf8"),
  );
  console.log(JSON.stringify(verifyCodeParity(path.resolve(process.argv[2]), gameplay)));
}
