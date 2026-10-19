import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
await build({
  entryPoints: [path.join(root, "tools/sim/browser-clock.cjs")],
  outfile: path.join(root, ".build/sim/browser-clock.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  plugins: [
    {
      name: "chronal-browser-clock",
      setup(builder) {
        builder.onResolve({ filter: /^chronal-clock$/ }, () => ({
          path: path.join(root, ".build/sim/chronal/sim/vclock.js"),
        }));
        builder.onResolve({ filter: /^(node:vm|node:v8)$/ }, (args) => ({
          path: args.path,
          namespace: "clock-shim",
        }));
        builder.onLoad({ filter: /.*/, namespace: "clock-shim" }, (args) => ({
          contents:
            args.path === "node:vm"
              ? "exports.runInContext=(source)=>globalThis.eval(source);"
              : "exports.promiseHooks={onInit(){},onSettled(){}};",
        }));
        builder.onLoad({ filter: /vclock\.js$/ }, async (args) => {
          const { readFile } = await import("node:fs/promises");
          return {
            contents:
              `const process={_tickCallback(){}};const {postTask:setImmediate}=require(${JSON.stringify(path.join(root,"tools/sim/browser-task-queue.cjs"))});\n` +
              (await readFile(args.path, "utf8")).replace(
                "if (each || promiseActivity) return true;",
                "return true; // Browser shim: drain microtasks after every timer.",
              ),
            loader: "js",
          };
        });
      },
    },
  ],
});
