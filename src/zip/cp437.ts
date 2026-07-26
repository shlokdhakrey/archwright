/**
 * IBM Code Page 437 — the historical default for ZIP entry names that predate
 * the UTF-8 flag. Bytes `0x00–0x7f` are ASCII; `0x80–0xff` map to the glyphs
 * below. Correct CP437 decoding is what lets legacy archives with accented or
 * box-drawing characters in names round-trip instead of mojibake.
 */
const HIGH_TABLE =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

/** Decode CP437-encoded bytes to a JavaScript string. */
export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else {
      out += HIGH_TABLE[byte - 0x80] ?? '�';
    }
  }
  return out;
}
