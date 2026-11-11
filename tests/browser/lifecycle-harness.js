// Loaded only by the local audit via Vite; never imported by the application.
import Gyos from "gyosjs/csp";

const source = await (await fetch("/")).text();
const template = new DOMParser()
  .parseFromString(source, "text/html")
  .getElementById("game");
export const retiredRoots = [];
export function remount() {
  const current = document.getElementById("game");
  retiredRoots.push(new WeakRef(current));
  Gyos.cleanup(current);
  current.replaceWith(template.cloneNode(true));
  Gyos.mountAll();
}
