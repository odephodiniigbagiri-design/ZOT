/** Nigerian "0803..." -> "234803..."; keeps other international numbers. */
export function normalizeWhatsapp(raw) {
  let d = String(raw).replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = "234" + d.slice(1);
  else if (/^[789]\d{9}$/.test(d)) d = "234" + d;
  return d;
}
