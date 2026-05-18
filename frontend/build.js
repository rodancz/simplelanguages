import * as esbuild from "esbuild";

await esbuild.build({
    entryPoints: ["js/app.js"],
    bundle: true,
    format: "esm",
    outfile: "js/bundle.js",
    minify: true,
    sourcemap: false,
});

console.log("Build complete.");
