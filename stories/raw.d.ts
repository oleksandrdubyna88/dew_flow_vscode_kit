// Vite's `?raw` import: a file's text as a string. Used by the stories to hand the theme fixture to a framed page.
declare module '*?raw' {
  const text: string;
  export default text;
}
