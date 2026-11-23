export function makeButton(id, text, callback) {
  const el = document.getElementById(id);
  if (el) el.onclick = callback;
}
