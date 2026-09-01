import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  findSubtitles,
  isNativeContainer,
  mediaKind,
  srtToVtt,
} from '../../src/http/media.js';
import type { ZipEntry } from '../../src/types/zip.js';

function entry(name: string): ZipEntry {
  return {
    name,
    rawName: new TextEncoder().encode(name),
    method: 0,
    compressedSize: 10,
    uncompressedSize: 10,
    crc32: 0,
    localHeaderOffset: 0,
    flags: 0,
    isDirectory: name.endsWith('/'),
    isEncrypted: false,
    hasDataDescriptor: false,
    lastModified: 0,
  };
}

describe('media classification', () => {
  it('recognises video and audio, and ignores everything else', () => {
    expect(mediaKind('a/movie.mkv')).toBe('video');
    expect(mediaKind('clip.mp4')).toBe('video');
    expect(mediaKind('song.flac')).toBe('audio');
    expect(mediaKind('notes.txt')).toBe('none');
    expect(mediaKind('archive.zip')).toBe('none');
  });

  it('extracts extensions, including from paths and dotfiles', () => {
    expect(extensionOf('dir/Movie.Name.2160p.MKV')).toBe('mkv');
    expect(extensionOf('noextension')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });

  it('is conservative about which containers browsers decode', () => {
    expect(isNativeContainer('a.mp4')).toBe(true);
    expect(isNativeContainer('a.webm')).toBe(true);
    expect(isNativeContainer('a.mp3')).toBe(true);
    // Matroska and friends stream fine but do not decode in-browser.
    expect(isNativeContainer('a.mkv')).toBe(false);
    expect(isNativeContainer('a.avi')).toBe(false);
    expect(isNativeContainer('a.wmv')).toBe(false);
  });
});

describe('subtitle discovery', () => {
  const entries = [
    entry('Show/S01E01.mkv'),
    entry('Show/S01E01.srt'),
    entry('Show/S01E01.en.srt'),
    entry('Show/S01E01.forced.hindi.vtt'),
    entry('Show/S01E02.mkv'),
    entry('Show/S01E02.srt'),
    entry('Show/readme.txt'),
    entry('Show/'),
  ];

  it('attaches only the subtitles belonging to the chosen video', () => {
    const tracks = findSubtitles(entries, 'Show/S01E01.mkv');
    expect(tracks.map((t) => t.path)).toEqual([
      'Show/S01E01.en.srt',
      'Show/S01E01.forced.hindi.vtt',
      'Show/S01E01.srt',
    ]);
    // The neighbouring episode's subtitle never leaks in.
    expect(tracks.some((t) => t.path.includes('S01E02'))).toBe(false);
  });

  it('derives labels and language codes from the filename', () => {
    const tracks = findSubtitles(entries, 'Show/S01E01.mkv');
    const english = tracks.find((t) => t.path.endsWith('.en.srt'));
    expect(english?.label).toBe('en');
    expect(english?.language).toBe('en');

    const hindi = tracks.find((t) => t.path.includes('forced'));
    expect(hindi?.label).toBe('forced hindi');
    expect(hindi?.language).toBe('hi');

    const plain = tracks.find((t) => t.path.endsWith('S01E01.srt'));
    expect(plain?.label).toBe('Subtitles');
  });

  it('returns nothing when there are no matching subtitles', () => {
    expect(findSubtitles(entries, 'Show/missing.mkv')).toEqual([]);
  });
});

describe('SubRip → WebVTT', () => {
  it('adds the header and converts comma timestamps', () => {
    const srt = '1\n00:00:01,000 --> 00:00:04,500\nHello\n\n2\n00:01:02,250 --> 00:01:03,000\nWorld\n';
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.500');
    expect(vtt).toContain('00:01:02.250 --> 00:01:03.000');
    expect(vtt).not.toContain(',000 -->');
    // Cue text and numbering survive untouched.
    expect(vtt).toContain('Hello');
    expect(vtt).toContain('World');
  });

  it('normalises CRLF and strips a byte-order mark', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
    const vtt = srtToVtt(srt);
    expect(vtt.charCodeAt(0)).toBe(0x57); // 'W' — no BOM left
    expect(vtt).not.toContain('\r');
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
  });

  it('leaves already-valid WebVTT timing alone', () => {
    const vtt = srtToVtt('00:00:01.000 --> 00:00:02.000\nAlready fine\n');
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000');
  });
});
