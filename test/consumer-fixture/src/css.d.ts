// What a consumer adds once so TypeScript accepts `import '…/components.css'` (TypeScript 6 checks side-effect
// imports): a stylesheet is esbuild's to bundle, and it exports nothing a script can use. README "Use" says the same.
declare module '*.css';
