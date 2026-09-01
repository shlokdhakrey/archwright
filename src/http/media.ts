import { CompressionMethod } from '../constants/zip.js';
import type { ZipEntry } from '../types/zip.js';
import { contentTypeFromName } from './content-type.js';

/**
 * Media classification for in-browser playback.
 *
 * Playing a file that lives *inside* a remote archive works because a STORED
 * entry is byte-addressable: the player's `Range` request maps straight onto an
 * origin range, so scrubbing to any point costs one small fetch and no
 * decompression. Two things decide how well it will go, and the player page
 * tells the viewer both up front rather than letting them discover it by
 * dragging the scrub bar:
 *
 *  - **Storage.** STORED seeks instantly. DEFLATE has to inflate from the start
 *    of the entry to reach an offset, so seeking deep into a large compressed
 *    entry is slow and eventually exceeds the CPU budget.
 *  - **Container.** Browsers decode a narrow set of containers. Matroska (.mkv)
 *    — the most common container for the files people keep in archives — is not
 *    among them, even when its codecs are H.264/AAC. Those files still stream
 *    perfectly to VLC, mpv, IINA or Infuse, which is what the page offers.
 */

export type MediaKind = 'video' | 'audio' | 'none';

/** Whether an entry is playable media at all, and of which sort. */
export function mediaKind(name: string): MediaKind {
  const type = contentTypeFromName(name);
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  return 'none';
}

/**
 * Containers every current browser decodes. Deliberately conservative: a false
 * "should work" is a black rectangle, while a false "might not" costs a banner.
 */
const NATIVE_CONTAINERS: ReadonlySet<string> = new Set([
  'mp4',
  'm4v',
  'webm',
  'ogv',
  'ogg',
  'mp3',
  'm4a',
  'aac',
  'wav',
  'opus',
  'weba',
  'flac',
]);

export function extensionOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

/** True when the browser is likely to decode this container natively. */
export function isNativeContainer(name: string): boolean {
  return NATIVE_CONTAINERS.has(extensionOf(name));
}

/** How well this entry will seek: instantly, slowly, or not worth trying. */
export function seekability(entry: ZipEntry): 'instant' | 'slow' {
  return entry.method === CompressionMethod.STORED ? 'instant' : 'slow';
}

const SUBTITLE_EXTENSIONS: ReadonlySet<string> = new Set(['srt', 'vtt']);

export interface SubtitleTrack {
  /** Entry path of the subtitle file inside the archive. */
  readonly path: string;
  /** Human label, derived from whatever follows the video's own name. */
  readonly label: string;
  /** BCP-47-ish language guess, when the filename carries one. */
  readonly language?: string;
}

/** Strip the extension, leaving directory + stem. */
function stem(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  return dot > slash ? path.slice(0, dot) : path;
}

const LANGUAGE_HINTS: Readonly<Record<string, string>> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  fr: 'fr',
  fre: 'fr',
  french: 'fr',
  es: 'es',
  spa: 'es',
  spanish: 'es',
  de: 'de',
  ger: 'de',
  german: 'de',
  hi: 'hi',
  hin: 'hi',
  hindi: 'hi',
  ja: 'ja',
  jpn: 'ja',
  japanese: 'ja',
  ar: 'ar',
  ara: 'ar',
  pt: 'pt',
  por: 'pt',
  it: 'it',
  ita: 'it',
  ru: 'ru',
  rus: 'ru',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
};

/**
 * Find subtitle files that belong to `videoPath`: same folder, and a name that
 * begins with the video's stem (so `Movie.mkv` picks up `Movie.srt`,
 * `Movie.en.srt` and `Movie.forced.eng.vtt`). Anything else in the folder is
 * ignored, so unrelated subtitles never attach to the wrong video.
 */
export function findSubtitles(
  entries: readonly ZipEntry[],
  videoPath: string,
): SubtitleTrack[] {
  const videoStem = stem(videoPath);
  const tracks: SubtitleTrack[] = [];

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    if (!SUBTITLE_EXTENSIONS.has(extensionOf(entry.name))) continue;
    if (entry.name === videoPath) continue;
    if (!stem(entry.name).startsWith(videoStem)) continue;

    // Whatever the subtitle adds beyond the video's name describes the track.
    const suffix = stem(entry.name).slice(videoStem.length).replace(/^[.\-_\s]+/, '');
    const parts = suffix.split(/[.\-_\s]+/).filter((part) => part.length > 0);
    const language = parts.map((part) => LANGUAGE_HINTS[part.toLowerCase()]).find(Boolean);

    tracks.push({
      path: entry.name,
      label: parts.length > 0 ? parts.join(' ') : 'Subtitles',
      ...(language ? { language } : {}),
    });
  }

  return tracks.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Convert SubRip to WebVTT — the only subtitle format `<track>` accepts.
 *
 * The formats are near-identical: WebVTT wants a header line and a `.` rather
 * than `,` between seconds and milliseconds. Cue numbers are legal in WebVTT, so
 * they are left alone.
 */
export function srtToVtt(srt: string): string {
  // Strip a UTF-8 BOM by code point: a literal BOM inside a regex is
  // invisible in source and easily lost in transit.
  const text = srt.charCodeAt(0) === 0xfeff ? srt.slice(1) : srt;
  const body = text
    .split('\r\n')
    .join('\n')
    .replace(
      /(\d{2}:\d{2}:\d{2}),(\d{1,3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{1,3})/g,
      '$1.$2 --> $3.$4',
    );
  return `WEBVTT\n\n${body.trimStart()}`;
}
