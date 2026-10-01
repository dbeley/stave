#!/usr/bin/env node
/**
 * mock-subsonic — a zero-dependency mock Subsonic / Navidrome server.
 *
 * Emulates the subset of the Subsonic REST API v1.16.1 that stave uses,
 * reading a real (or generated) music library from disk — ID3v2 tags for MP3,
 * Vorbis comments for FLAC — so the app can be developed and end-to-end tested
 * without a real Navidrome.
 *
 * Run:
 *   node tools/mock-subsonic/server.mjs --music testdata/music --port 4534
 *
 * Endpoints: ping, getAlbumList2, getAlbum, getArtists, getArtist,
 * getArtistInfo2, getTopSongs, getSimilarSongs(2), getRandomSongs, search3,
 * getPlaylists, getPlaylist, getStarred2, star, unstar, scrobble,
 * getCoverArt, stream, download, getGenres.
 *
 * Everything is in-process and in-memory: no npm packages, no external tools.
 * See README.md for flags and fault-injection environment variables.
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const API_VERSION = '1.16.1';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI / config
// ---------------------------------------------------------------------------

function usage() {
  return `mock-subsonic — mock Subsonic/Navidrome server

Usage: node tools/mock-subsonic/server.mjs [options]

Options:
  -m, --music <dir>       Music library root            (env MOCK_MUSIC, default testdata/music)
  -p, --port <n>          Listen port                   (env MOCK_PORT, default 4534)
      --host <addr>       Listen address                (env MOCK_HOST, default 127.0.0.1)
  -u, --user <name>       Accepted username             (env MOCK_USER, default admin)
  -w, --password <pass>   Accepted password             (env MOCK_PASSWORD, default admin)
      --state <file>      Persist stars/scrobbles here  (env MOCK_STATE_FILE, default: memory only)
      --seed <n>          PRNG seed for "random" lists  (env MOCK_SEED, default 1337)
      --no-auth           Accept any credentials
      --no-playlists      Return no playlists
      --quiet             Silence request logging
      --verbose           Log every request + auth result
  -h, --help              Show this help

Fault injection is configured through environment variables — see README.md.
`;
}

function parseArgs(argv) {
  const opts = {
    music: process.env.MOCK_MUSIC || 'testdata/music',
    port: Number(process.env.MOCK_PORT || 4534),
    host: process.env.MOCK_HOST || '127.0.0.1',
    user: process.env.MOCK_USER || 'admin',
    password: process.env.MOCK_PASSWORD || 'admin',
    state: process.env.MOCK_STATE_FILE || '',
    seed: Number(process.env.MOCK_SEED || 1337),
    auth: true,
    playlists: !/^(0|false|no)$/i.test(process.env.MOCK_PLAYLISTS || ''),
    quiet: false,
    verbose: false,
    help: false,
  };

  const args = argv.slice();
  const next = (name) => {
    const v = args.shift();
    if (v === undefined) {
      process.stderr.write(`error: ${name} requires a value\n`);
      process.exit(2);
    }
    return v;
  };

  while (args.length) {
    const arg = args.shift();
    switch (arg) {
      case '-m':
      case '--music':
        opts.music = next(arg);
        break;
      case '-p':
      case '--port':
        opts.port = Number(next(arg));
        break;
      case '--host':
        opts.host = next(arg);
        break;
      case '-u':
      case '--user':
        opts.user = next(arg);
        break;
      case '-w':
      case '--password':
        opts.password = next(arg);
        break;
      case '--state':
        opts.state = next(arg);
        break;
      case '--seed':
        opts.seed = Number(next(arg));
        break;
      case '--no-auth':
        opts.auth = false;
        break;
      case '--no-playlists':
        opts.playlists = false;
        break;
      case '--quiet':
        opts.quiet = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        process.stderr.write(`error: unknown option ${arg}\n`);
        process.exit(2);
    }
  }
  if (!Number.isFinite(opts.port) || opts.port <= 0) {
    process.stderr.write('error: invalid port\n');
    process.exit(2);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// Small binary helpers
// ---------------------------------------------------------------------------

function readU16BE(buf, off) {
  return buf.readUInt16BE(off);
}
function readU24BE(buf, off) {
  return (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
}
function readU32BE(buf, off) {
  return buf.readUInt32BE(off);
}
function readU32LE(buf, off) {
  return buf.readUInt32LE(off);
}
function syncsafe(buf, off) {
  return (
    ((buf[off] & 0x7f) << 21) |
    ((buf[off + 1] & 0x7f) << 14) |
    ((buf[off + 2] & 0x7f) << 7) |
    (buf[off + 3] & 0x7f)
  );
}

function decodeText(buf, encoding) {
  let enc = 'utf-8';
  let start = 0;
  if (encoding === 0) {
    enc = 'latin1';
  } else if (encoding === 3) {
    enc = 'utf-8';
  } else if (encoding === 1) {
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
      enc = 'utf-16le';
      start = 2;
    } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
      enc = 'utf-16be';
      start = 2;
    } else {
      enc = 'utf-16le';
    }
  } else if (encoding === 2) {
    enc = 'utf-16be';
  }
  try {
    const text = new TextDecoder(enc).decode(buf.subarray(start));
    return text.replace(/\u0000+$/g, '').replace(/^\u0000+/, '').trim();
  } catch {
    return buf.toString('latin1', start).replace(/\u0000+$/g, '').trim();
  }
}

/** Read a null-terminated string in the frame's encoding; return [text, nextOffset]. */
function readEncodedString(buf, off, encoding) {
  if (encoding === 0 || encoding === 3) {
    let end = off;
    while (end < buf.length && buf[end] !== 0) end += 1;
    return [decodeText(buf.subarray(off, end), encoding), end + 1];
  }
  // UTF-16: terminator is two zero bytes on an even boundary.
  let end = off;
  while (end + 1 < buf.length && !(buf[end] === 0 && buf[end + 1] === 0)) end += 2;
  return [decodeText(buf.subarray(off, end), encoding), end + 2];
}

const ID3_GENRES = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop',
  'Jazz', 'Metal', 'New Age', 'Oldies', 'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock',
  'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks', 'Soundtrack',
  'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance',
  'Classical', 'Instrumental', 'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise',
];

function cleanGenre(raw) {
  if (!raw) return '';
  const num = /^\((\d+)\)$/.exec(raw);
  if (num) return ID3_GENRES[Number(num[1])] || raw;
  return raw.replace(/^\((\d+)\)\s*/, (_, n) => `${ID3_GENRES[Number(n)] || n} `).trim();
}

// ---------------------------------------------------------------------------
// ID3v2 (MP3) tag parser
// ---------------------------------------------------------------------------

function parseId3v2(buf) {
  const result = { tags: {}, picture: null, audioStart: 0 };
  if (buf.length < 10 || buf[0] !== 0x49 || buf[1] !== 0x44 || buf[2] !== 0x33) {
    return result;
  }
  const major = buf[3];
  const flags = buf[5];
  const tagSize = syncsafe(buf, 6);
  result.audioStart = 10 + tagSize + (flags & 0x10 ? 10 : 0);
  const end = Math.min(10 + tagSize, buf.length);

  let pos = 10;
  if (flags & 0x40) {
    // Extended header — skip it.
    const extSize = major >= 4 ? syncsafe(buf, 10) : readU32BE(buf, 10) + 4;
    pos = 10 + Math.max(extSize, 6);
  }

  const txxx = {};
  while (pos + 10 <= end) {
    const id = buf.toString('latin1', pos, pos + 4);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = major >= 4 ? syncsafe(buf, pos + 4) : readU32BE(buf, pos + 4);
    if (size <= 0) {
      pos += 10;
      continue;
    }
    const frameFlags = readU16BE(buf, pos + 8);
    let data = buf.subarray(pos + 10, Math.min(pos + 10 + size, end));
    if (major >= 4 && frameFlags & 0x01 && data.length >= 4) data = data.subarray(4);

    if (id === 'APIC' || id === 'PIC') {
      try {
        const enc = data[0];
        let o = 1;
        let mime;
        if (id === 'APIC') {
          let m = o;
          while (m < data.length && data[m] !== 0) m += 1;
          mime = data.toString('latin1', o, m);
          o = m + 1;
        } else {
          mime = mapImageFormat(data.toString('latin1', o, o + 3));
          o += 3;
        }
        o += 1; // picture type
        const [, next] = readEncodedString(data, o, enc);
        const picture = data.subarray(next);
        if (!result.picture && picture.length) result.picture = { mime: mime || 'image/jpeg', data: picture };
      } catch {
        /* ignore malformed picture */
      }
    } else if (id === 'COMM') {
      try {
        const enc = data[0];
        const [, afterLang] = [0, 4];
        const [description, next] = readEncodedString(data, afterLang, enc);
        const value = decodeText(data.subarray(next), enc);
        if (!txxx.comment) txxx.comment = { description, value };
      } catch {
        /* ignore */
      }
    } else if (id === 'TXXX') {
      try {
        const enc = data[0];
        const [description, next] = readEncodedString(data, 1, enc);
        const value = decodeText(data.subarray(next), enc);
        const key = description.toLowerCase().replace(/\s+/g, '');
        if (key && !(key in txxx)) txxx[key] = value;
      } catch {
        /* ignore */
      }
    } else if (id[0] === 'T' && id !== 'TXXX') {
      try {
        const value = decodeText(data.subarray(1), data[0]);
        if (value) result.tags[id] = value;
      } catch {
        /* ignore */
      }
    }
    pos += 10 + size;
  }

  return { ...result, txxx };
}

function mapImageFormat(fmt) {
  const f = fmt.toUpperCase();
  if (f === 'PNG') return 'image/png';
  if (f === 'GIF') return 'image/gif';
  if (f === 'BMP') return 'image/bmp';
  return 'image/jpeg';
}

/** Normalise raw ID3 frames + TXXX entries into a tag record. */
function tagsFromId3(parsed) {
  const t = parsed.tags;
  const x = parsed.txxx || {};
  const tags = {
    title: t.TIT2 || t.TT2 || '',
    artist: t.TPE1 || t.TP1 || '',
    album: t.TALB || t.TAL || '',
    albumArtist: t.TPE2 || t.TP2 || x.albumartist || x.album_artist || '',
    track: t.TRCK || t.TRK || '',
    disc: t.TPOS || t.TPA || '',
    date: t.TDRC || t.TYER || t.TDAT || '',
    genre: cleanGenre(t.TCON || t.TCO || ''),
    comment: x.comment?.value || t.COMM || '',
    lyrics: t.USLT || t.ULT || '',
  };
  return tags;
}

// ---------------------------------------------------------------------------
// FLAC parser (STREAMINFO + VORBIS_COMMENT + PICTURE)
// ---------------------------------------------------------------------------

function parseFlac(buf) {
  if (buf.toString('latin1', 0, 4) !== 'fLaC') return null;
  const tags = {};
  let picture = null;
  let sampleRate = 0;
  let totalSamples = 0n;
  let pos = 4;
  let last = false;

  while (!last && pos + 4 <= buf.length) {
    const header = buf[pos];
    last = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const len = readU24BE(buf, pos + 1);
    const data = buf.subarray(pos + 4, Math.min(pos + 4 + len, buf.length));

    if (type === 0 && data.length >= 18) {
      sampleRate = (data[10] << 12) | (data[11] << 4) | (data[12] >> 4);
      totalSamples =
        (BigInt(data[13] & 0x0f) << 32n) |
        (BigInt(data[14]) << 24n) |
        (BigInt(data[15]) << 16n) |
        (BigInt(data[16]) << 8n) |
        BigInt(data[17]);
    } else if (type === 4 && data.length >= 8) {
      try {
        let o = 0;
        const vendorLen = readU32LE(data, o);
        o += 4 + vendorLen;
        const count = readU32LE(data, o);
        o += 4;
        for (let i = 0; i < count && o + 4 <= data.length; i += 1) {
          const clen = readU32LE(data, o);
          o += 4;
          const entry = data.toString('utf8', o, o + clen);
          o += clen;
          const eq = entry.indexOf('=');
          if (eq < 0) continue;
          const key = entry.slice(0, eq).toUpperCase();
          const value = entry.slice(eq + 1).trim();
          if (value && !(key in tags)) tags[key] = value;
        }
      } catch {
        /* ignore */
      }
    } else if (type === 6 && data.length > 32 && !picture) {
      try {
        let o = 4; // picture type
        const mimeLen = readU32BE(data, o);
        o += 4;
        const mime = data.toString('latin1', o, o + mimeLen) || 'image/jpeg';
        o += mimeLen;
        const descLen = readU32BE(data, o);
        o += 4 + descLen + 16; // width,height,depth,colors
        const picLen = readU32BE(data, o);
        o += 4;
        const pictureData = data.subarray(o, o + picLen);
        if (pictureData.length) picture = { mime, data: pictureData };
      } catch {
        /* ignore */
      }
    }
    pos += 4 + len;
    if (len === 0 && type === 0) last = true;
  }

  const duration = sampleRate > 0 && totalSamples > 0n ? Number(totalSamples) / sampleRate : 0;
  return {
    tags: {
      title: tags.TITLE || '',
      artist: tags.ARTIST || '',
      album: tags.ALBUM || '',
      albumArtist: tags.ALBUMARTIST || tags.ALBUM_ARTIST || tags.ARTISTSORT || '',
      track: tags.TRACKNUMBER || '',
      disc: tags.DISCNUMBER || tags.DISC || '',
      date: tags.DATE || tags.YEAR || '',
      genre: cleanGenre(tags.GENRE || ''),
      comment: tags.COMMENT || tags.DESCRIPTION || '',
      lyrics: tags.LYRICS || tags.UNSYNCEDLYRICS || '',
    },
    picture,
    duration,
    sampleRate,
  };
}

// ---------------------------------------------------------------------------
// MP3 frame scanning → duration
// ---------------------------------------------------------------------------

const MPEG_BITRATES = {
  // [mpegVersion][layer]
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MPEG_SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  25: [11025, 12000, 8000],
};

function parseMpegHeader(buf, i) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return null;
  const verBits = (buf[i + 1] >> 3) & 0x3;
  const layerBits = (buf[i + 1] >> 1) & 0x3;
  const brIdx = (buf[i + 2] >> 4) & 0xf;
  const srIdx = (buf[i + 2] >> 2) & 0x3;
  const padding = (buf[i + 2] >> 1) & 0x1;
  if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const version = verBits === 3 ? 1 : verBits === 2 ? 2 : 25;
  const layer = 4 - layerBits; // 1 = Layer I, 3 = Layer III
  const table = MPEG_BITRATES[`${version === 25 ? 2 : version}-${layer}`];
  const bitrate = table[brIdx] * 1000;
  const sampleRate = MPEG_SAMPLE_RATES[version][srIdx];
  if (!bitrate || !sampleRate) return null;
  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : version === 1 ? 1152 : 576;
  let frameLength;
  if (layer === 1) {
    frameLength = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
  } else {
    frameLength = Math.floor(((samplesPerFrame / 8) * bitrate) / sampleRate) + padding;
  }
  if (frameLength < 24) return null;
  return { version, layer, bitrate, sampleRate, samplesPerFrame, frameLength };
}

function mp3Duration(buf, audioStart) {
  // Find the first valid frame within the first 64 KiB after the tag.
  const limit = Math.min(buf.length - 4, audioStart + 65536);
  let first = -1;
  let header = null;
  for (let i = audioStart; i < limit; i += 1) {
    const h = parseMpegHeader(buf, i);
    if (h) {
      first = i;
      header = h;
      break;
    }
  }
  if (first < 0 || !header) return 0;

  // Xing / Info VBR header → frame count is exact.
  const searchEnd = Math.min(buf.length, first + 512);
  const window = buf.toString('latin1', first, searchEnd);
  const xingAt = window.indexOf('Xing') >= 0 ? window.indexOf('Xing') : window.indexOf('Info');
  if (xingAt >= 0) {
    const abs = first + xingAt + 4;
    if (abs + 8 <= buf.length) {
      const flags = readU32BE(buf, abs);
      if (flags & 0x1) {
        const frames = readU32BE(buf, abs + 4);
        if (frames > 0) return (frames * header.samplesPerFrame) / header.sampleRate;
      }
    }
  }

  // Otherwise walk every frame (CBR or raw VBR).
  let pos = first;
  let frames = 0;
  while (pos + 4 <= buf.length && frames < 2_000_000) {
    const h = parseMpegHeader(buf, pos);
    if (!h) break;
    pos += h.frameLength;
    frames += 1;
  }
  return frames > 0 ? (frames * header.samplesPerFrame) / header.sampleRate : 0;
}

// ---------------------------------------------------------------------------
// Library scanning → in-memory model
// ---------------------------------------------------------------------------

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.mp4', '.ogg', '.oga', '.opus', '.wav']);
const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
};
const COVER_NAMES = ['folder.png', 'cover.png', 'folder.jpg', 'cover.jpg', 'album.png', 'albumart.png', 'folder.jpeg', 'cover.jpeg'];

function hashInt(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, seed) {
  const out = list.slice();
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseTrackNumber(raw) {
  const m = String(raw).match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
}
function parseYear(raw) {
  const m = String(raw).match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

function walkAudioFiles(root) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && AUDIO_EXT.has(extname(entry.name).toLowerCase())) files.push(full);
    }
  };
  walk(root);
  return files;
}

function findCoverFile(dir) {
  for (const name of COVER_NAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function buildLibrary(musicRoot, options) {
  const root = resolve(musicRoot);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`music directory not found: ${root}`);
  }

  const files = walkAudioFiles(root);
  const parsedTracks = [];

  for (const file of files) {
    const buf = readFileSync(file);
    const ext = extname(file).toLowerCase();
    const relPath = relative(root, file);
    const segments = relPath.split('/');
    const parentDir = dirname(file);
    const folderName = segments.length >= 2 ? segments[segments.length - 2] : '';
    const mtime = statSync(file).mtime;
    let tags = {};
    let picture = null;
    let duration = 0;
    let sampleRate = 0;

    if (ext === '.mp3') {
      const id3 = parseId3v2(buf);
      tags = tagsFromId3(id3);
      picture = id3.picture;
      duration = mp3Duration(buf, id3.audioStart);
    } else if (ext === '.flac') {
      const flac = parseFlac(buf);
      if (flac) {
        tags = flac.tags;
        picture = flac.picture;
        duration = flac.duration;
        sampleRate = flac.sampleRate;
      }
    } else {
      tags = { title: '', artist: '', album: '', albumArtist: '', track: '', disc: '', date: '', genre: '', comment: '', lyrics: '' };
    }

    const title = tags.title || segments[segments.length - 1].replace(/\.[^.]+$/, '');
    const artist = tags.artist || '';
    const albumArtist = tags.albumArtist || artist || '';
    const album = tags.album || folderName || 'Unknown Album';
    const year = parseYear(tags.date);

    parsedTracks.push({
      path: file,
      relPath,
      dir: parentDir,
      folderName,
      title,
      artist,
      albumArtist,
      album,
      trackNo: parseTrackNumber(tags.track),
      discNo: parseTrackNumber(tags.disc) ?? 1,
      year,
      genre: tags.genre || '',
      comment: tags.comment || '',
      lyrics: tags.lyrics || '',
      duration,
      sampleRate,
      suffix: ext.replace('.', ''),
      contentType: CONTENT_TYPES[ext] || 'application/octet-stream',
      size: buf.length,
      mtime,
      embeddedPicture: picture,
      coverFile: null,
    });
  }

  // Group tracks into albums; group albums by album artist.
  const albumMap = new Map();
  for (const track of parsedTracks) {
    const key = `${track.albumArtist}\u0000${track.album}`;
    if (!albumMap.has(key)) {
      albumMap.set(key, {
        key,
        name: track.album,
        albumArtist: track.albumArtist,
        dir: track.dir,
        tracks: [],
        year: track.year,
        genre: track.genre,
        coverFile: findCoverFile(track.dir),
      });
    }
    const album = albumMap.get(key);
    album.tracks.push(track);
    if (!album.coverFile && track.embeddedPicture) album.embeddedPicture = track.embeddedPicture;
    if (!album.year && track.year) album.year = track.year;
    if (!album.genre && track.genre) album.genre = track.genre;
  }

  const albums = [...albumMap.values()].sort(
    (a, b) => a.albumArtist.localeCompare(b.albumArtist) || a.name.localeCompare(b.name),
  );

  albumMap.clear();
  albums.forEach((album, index) => {
    album.id = `al_${String(index + 1).padStart(4, '0')}`;
    album.hasCover = Boolean(
      album.coverFile || album.embeddedPicture || album.tracks.some((t) => t.embeddedPicture),
    );
    // Only advertise cover art when something can actually be served.
    album.coverArt = album.hasCover ? album.id : undefined;
  });

  const artistMap = new Map();
  for (const album of albums) {
    const name = album.albumArtist || 'Unknown Artist';
    if (!artistMap.has(name)) artistMap.set(name, { name, albums: [] });
    artistMap.get(name).albums.push(album);
  }
  const artists = [...artistMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  artists.forEach((artist, index) => {
    artist.id = `ar_${String(index + 1).padStart(4, '0')}`;
    artist.coverArt = artist.albums[0]?.coverArt;
  });
  const artistByName = new Map(artists.map((a) => [a.name, a]));
  const albumById = new Map(albums.map((a) => [a.id, a]));

  // Finalise tracks: ids, links, deterministic play counts.
  const tracks = [];
  let trackCounter = 0;
  for (const album of albums) {
    album.tracks.sort(
      (a, b) =>
        (a.discNo ?? 1) - (b.discNo ?? 1) ||
        (a.trackNo ?? Number.MAX_SAFE_INTEGER) - (b.trackNo ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    );
    for (const track of album.tracks) {
      trackCounter += 1;
      track.id = `tr_${String(trackCounter).padStart(4, '0')}`;
      track.albumId = album.id;
      track.albumName = album.name;
      track.artistName = track.artist || album.albumArtist || 'Unknown Artist';
      track.artistId = artistByName.get(album.albumArtist)?.id;
      track.coverArt = album.coverArt;
      track.album = album.name;
      track.playCount = hashInt(track.relPath) % 7;
      track.starredAt = null;
      track.playedAt = null;
      tracks.push(track);
    }
  }
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  // Synthetic "created" timestamps, year-dominant so `newest` is meaningful.
  for (const album of albums) {
    const year = album.year || 2000;
    const month = hashInt(album.key) % 12;
    const day = 1 + (hashInt(`${album.key}#d`) % 27);
    album.created = new Date(Date.UTC(year, month, day)).toISOString();
  }

  return {
    root,
    albums,
    artists,
    tracks,
    albumById,
    artistByName,
    trackById,
    generatedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Library state (stars, scrobbles) — mutable, optionally persisted
// ---------------------------------------------------------------------------

function createState(library, options, log) {
  const state = {
    starredTracks: new Map(),
    starredAlbums: new Map(),
    starredArtists: new Map(),
    playCounts: new Map(),
    playedAt: new Map(),
    playlists: [],
    empty: /^(1|true|yes)$/i.test(process.env.MOCK_EMPTY || ''),
    seedBase: options.seed || 1337,
    randomCounter: 0,
    log,
  };

  if (options.state && existsSync(options.state)) {
    try {
      const raw = JSON.parse(readFileSync(options.state, 'utf8'));
      for (const [id, at] of Object.entries(raw.starredTracks || {})) state.starredTracks.set(id, at);
      for (const [id, at] of Object.entries(raw.starredAlbums || {})) state.starredAlbums.set(id, at);
      for (const [id, at] of Object.entries(raw.starredArtists || {})) state.starredArtists.set(id, at);
      for (const [id, n] of Object.entries(raw.playCounts || {})) state.playCounts.set(id, n);
      for (const [id, at] of Object.entries(raw.playedAt || {})) state.playedAt.set(id, at);
      log(`restored state from ${options.state}`);
    } catch (error) {
      process.stderr.write(`warning: could not read state file: ${error.message}\n`);
    }
  }

  state.persist = () => {
    if (!options.state) return;
    try {
      writeFileSync(
        options.state,
        JSON.stringify(
          {
            starredTracks: Object.fromEntries(state.starredTracks),
            starredAlbums: Object.fromEntries(state.starredAlbums),
            starredArtists: Object.fromEntries(state.starredArtists),
            playCounts: Object.fromEntries(state.playCounts),
            playedAt: Object.fromEntries(state.playedAt),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      process.stderr.write(`warning: could not write state file: ${error.message}\n`);
    }
  };

  if (options.playlists) state.playlists = buildPlaylists(library, options);
  return state;
}

function buildPlaylists(library, options) {
  const byGenre = (genre) =>
    library.tracks.filter((t) => (t.genre || '').toLowerCase() === genre.toLowerCase());
  const newest = [...library.tracks]
    .sort((a, b) => (library.albumById.get(b.albumId)?.created || '').localeCompare(library.albumById.get(a.albumId)?.created || ''))
    .slice(0, 12);

  const specs = [
    { name: 'Mock: Recently Added', comment: 'Newest tracks in the demo library', tracks: newest },
    { name: 'Mock: Ambient Focus', comment: 'Ambient tracks', tracks: byGenre('Ambient') },
    { name: 'Mock: Jazz Night', comment: 'Jazz tracks', tracks: byGenre('Jazz') },
    { name: 'Mock: Everything', comment: 'The whole library, in catalogue order', tracks: library.tracks },
  ].filter((spec) => spec.tracks.length > 0);

  const created = library.albums[0]?.created || new Date().toISOString();
  return specs.map((spec, index) => ({
    id: `pl_${String(index + 1).padStart(4, '0')}`,
    name: spec.name,
    comment: spec.comment,
    owner: options.user,
    public: true,
    created,
    changed: created,
    coverArt: spec.tracks[0]?.coverArt,
    entry: spec.tracks.map((t) => t.id),
  }));
}

// ---------------------------------------------------------------------------
// Response serialisation
// ---------------------------------------------------------------------------

function dropUndefined(obj) {
  for (const key of Object.keys(obj)) if (obj[key] === undefined || obj[key] === null) delete obj[key];
  return obj;
}

function trackPlayCount(state, track) {
  return track.playCount + (state.playCounts.get(track.id) || 0);
}

function serialiseTrack(state, track) {
  if (!track) return null;
  const starredAt = state.starredTracks.get(track.id);
  return dropUndefined({
    id: track.id,
    parent: track.albumId,
    isDir: false,
    title: track.title,
    album: track.albumName,
    artist: track.artistName,
    track: track.trackNo,
    discNumber: track.discNo,
    year: track.year,
    genre: track.genre || undefined,
    coverArt: state.artwork === false ? undefined : track.coverArt,
    size: track.size,
    contentType: track.contentType,
    suffix: track.suffix,
    duration: Math.round(track.duration),
    bitRate: track.duration > 0 ? Math.round((track.size * 8) / track.duration / 1000) : undefined,
    path: track.relPath,
    albumId: track.albumId,
    artistId: track.artistId,
    created: state.library?.albumById?.get(track.albumId)?.created,
    starred: starredAt || undefined,
    playCount: trackPlayCount(state, track),
    played: state.playedAt.get(track.id) || track.playedAt || undefined,
  });
}

function albumPlayCount(state, album) {
  return album.tracks.reduce((sum, t) => sum + trackPlayCount(state, t), 0);
}
function albumPlayed(state, album) {
  const dates = album.tracks.map((t) => state.playedAt.get(t.id)).filter(Boolean).sort();
  return dates.length ? dates[dates.length - 1] : undefined;
}

function serialiseAlbumSummary(state, album) {
  const starredAt = state.starredAlbums.get(album.id);
  return dropUndefined({
    id: album.id,
    name: album.name,
    artist: album.albumArtist || 'Unknown Artist',
    artistId: state.library?.artistByName?.get(album.albumArtist)?.id,
    coverArt: state.artwork === false ? undefined : album.coverArt,
    songCount: album.tracks.length,
    duration: Math.round(album.tracks.reduce((sum, t) => sum + t.duration, 0)),
    playCount: albumPlayCount(state, album),
    created: album.created,
    year: album.year,
    genre: album.genre || undefined,
    starred: starredAt || undefined,
  });
}

function serialiseAlbumFull(state, album) {
  return {
    ...serialiseAlbumSummary(state, album),
    song: album.tracks.map((t) => serialiseTrack(state, t)),
  };
}

function serialiseArtist(state, artist) {
  const starredAt = state.starredArtists.get(artist.id);
  return dropUndefined({
    id: artist.id,
    name: artist.name,
    coverArt: state.artwork === false ? undefined : artist.coverArt,
    albumCount: artist.albums.length,
    starred: starredAt || undefined,
  });
}

function serialisePlaylist(state, playlist, withEntries) {
  const entries = playlist.entry.map((id) => state.library.trackById.get(id)).filter(Boolean);
  return dropUndefined({
    id: playlist.id,
    name: playlist.name,
    comment: playlist.comment,
    owner: playlist.owner,
    public: playlist.public,
    songCount: entries.length,
    duration: Math.round(entries.reduce((sum, t) => sum + t.duration, 0)),
    created: playlist.created,
    changed: playlist.changed,
    coverArt: state.artwork === false ? undefined : playlist.coverArt,
    entry: withEntries ? entries.map((t) => serialiseTrack(state, t)) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Fault injection
// ---------------------------------------------------------------------------

function envList(name) {
  const raw = process.env[name];
  if (!raw) return null;
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function endpointMatches(list, endpoint) {
  if (!list || list.length === 0) return true; // no list => applies to every endpoint
  return list.includes('*') || list.includes(endpoint.toLowerCase());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Accept, Content-Type, Range',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
};

function sendJson(res, payload, { status = 200, headers = {} } = {}) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
    ...CORS_HEADERS,
    ...headers,
  });
  if (res.req && res.req.method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

function envelope(opts, payload = {}) {
  return {
    'subsonic-response': {
      status: 'ok',
      version: process.env.MOCK_VERSION || API_VERSION,
      type: process.env.MOCK_TYPE || 'navidrome',
      serverVersion: process.env.MOCK_SERVER_VERSION || '0.54.0-mock',
      openSubsonic: process.env.MOCK_OPENSUBSONIC !== '0',
      ...payload,
    },
  };
}

function failure(opts, code, message) {
  return {
    'subsonic-response': {
      status: 'failed',
      version: process.env.MOCK_VERSION || API_VERSION,
      type: process.env.MOCK_TYPE || 'navidrome',
      serverVersion: process.env.MOCK_SERVER_VERSION || '0.54.0-mock',
      openSubsonic: process.env.MOCK_OPENSUBSONIC !== '0',
      error: { code, message },
    },
  };
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function md5hex(input) {
  return createHash('md5').update(input, 'utf8').digest('hex');
}

function checkAuth(opts, params) {
  const user = params.get('u');
  const token = params.get('t');
  const salt = params.get('s');
  const password = params.get('p');

  if (process.env.MOCK_REJECT_AUTH && /^(1|true|yes)$/i.test(process.env.MOCK_REJECT_AUTH)) {
    return { ok: false, code: 40, message: 'Wrong username or password (forced)' };
  }
  if (!opts.auth) return { ok: true };
  if (!user) return { ok: false, code: 10, message: 'Missing required parameter u' };
  if (user !== opts.user) return { ok: false, code: 40, message: 'Wrong username or password' };
  if (token && salt) {
    if (token === md5hex(opts.password + salt)) return { ok: true };
    return { ok: false, code: 40, message: 'Wrong username or password' };
  }
  if (password !== null && password !== undefined && password !== '') {
    let value = password;
    if (value.startsWith('enc:')) {
      value = Buffer.from(value.slice(4), 'hex').toString('utf8');
    }
    if (value === opts.password) return { ok: true };
    return { ok: false, code: 40, message: 'Wrong username or password' };
  }
  return { ok: false, code: 10, message: 'Missing authentication (t+s or p required)' };
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

function startServer(opts) {
  const log = (msg) => {
    if (!opts.quiet) process.stdout.write(`[mock-subsonic] ${msg}\n`);
  };

  const library = buildLibrary(opts.music, opts);
  const state = createState(library, opts, log);
  state.library = library;
  state.artwork = !/^(0|false|no)$/i.test(process.env.MOCK_ARTWORK || '');
  let requestCounter = 0;
  let randomCounter = 0;
  const coverCache = new Map();

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      process.stderr.write(`[mock-subsonic] handler error: ${error.stack || error}\n`);
      if (!res.headersSent) sendJson(res, failure(opts, 0, 'Internal mock error'), { status: 500 });
      else res.end();
    });
  });

  async function handle(req, res) {
    const started = Date.now();
    const url = new URL(req.url, `http://${req.headers.host || `${opts.host}:${opts.port}`}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, failure(opts, 0, 'Only GET is supported'), { status: 405 });
      return;
    }

    // Normalise "/rest/ping.view" | "/ping" | "rest/ping" -> "ping".
    let pathname = decodeURIComponent(url.pathname);
    pathname = pathname.replace(/^\/+/, '');
    if (pathname.startsWith('rest/')) pathname = pathname.slice('rest/'.length);
    pathname = pathname.replace(/\.(view|jsp|json|xml)$/i, '');
    const endpoint = pathname;

    if (endpoint === '' || endpoint === 'index') {
      sendJson(res, {
        server: 'mock-subsonic',
        description: 'Mock Subsonic API v1.16.1 server',
        music: library.root,
        tracks: library.tracks.length,
        albums: library.albums.length,
        artists: library.artists.length,
        rest: '/rest/<endpoint>',
      });
      return;
    }

    requestCounter += 1;
    const isApi = true;
    const q = url.searchParams;

    // --- transport-level faults -------------------------------------------
    const dropList = envList('MOCK_DROP_ENDPOINTS');
    if (q.get('mock_drop') === '1' || (dropList && endpointMatches(dropList, endpoint))) {
      if (opts.verbose) log(`${endpoint}: dropping connection`);
      res.destroy();
      return;
    }

    const hangList = envList('MOCK_HANG_ENDPOINTS');
    if (endpointMatches(hangList, endpoint) && (hangList || q.get('mock_hang') === '1')) {
      const hangMs = Number(process.env.MOCK_HANG_MS || 0);
      if (hangMs > 0) await sleep(hangMs);
      else return; // never respond
    }

    let latency = Number(process.env.MOCK_LATENCY_MS || 0);
    if (q.get('mock_latency_ms')) latency = Number(q.get('mock_latency_ms'));
    const latencyList = envList('MOCK_LATENCY_ENDPOINTS');
    if (latency > 0 && endpointMatches(latencyList, endpoint)) await sleep(latency);

    const failFirst = Number(process.env.MOCK_FAIL_FIRST_N || 0);
    if (failFirst > 0 && requestCounter <= failFirst) {
      log(`${endpoint}: failing request ${requestCounter} <= MOCK_FAIL_FIRST_N`);
      sendJson(res, failure(opts, Number(process.env.MOCK_FAIL_CODE || 0), process.env.MOCK_FAIL_MESSAGE || 'Injected failure'));
      return;
    }

    let httpStatus = Number(process.env.MOCK_HTTP_STATUS || 0);
    if (q.get('mock_http_status')) httpStatus = Number(q.get('mock_http_status'));
    const statusList = envList('MOCK_HTTP_STATUS_ENDPOINTS');
    if (httpStatus > 0 && endpointMatches(statusList, endpoint)) {
      sendJson(
        res,
        failure(opts, Number(process.env.MOCK_FAIL_CODE || 0), process.env.MOCK_FAIL_MESSAGE || `Injected HTTP ${httpStatus}`),
        { status: httpStatus },
      );
      return;
    }

    const malformedList = envList('MOCK_MALFORMED_ENDPOINTS');
    if (q.get('mock_malformed') === '1' || (malformedList && endpointMatches(malformedList, endpoint))) {
      const body = Buffer.from('<html><body>this is not json</body></html>');
      res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': body.length, ...CORS_HEADERS });
      res.end(body);
      return;
    }

    const failList = envList('MOCK_FAIL_ENDPOINTS');
    if (failList && endpointMatches(failList, endpoint)) {
      sendJson(res, failure(opts, Number(process.env.MOCK_FAIL_CODE || 0), process.env.MOCK_FAIL_MESSAGE || `Injected failure for ${endpoint}`));
      return;
    }
    if (q.get('mock_fail') === '1') {
      sendJson(
        res,
        failure(opts, Number(q.get('mock_error_code') || process.env.MOCK_FAIL_CODE || 0), q.get('mock_error_message') || 'Injected failure'),
      );
      return;
    }

    // --- authentication ----------------------------------------------------
    if (!Object.hasOwn(HANDLERS, endpoint)) {
      sendJson(res, failure(opts, 70, `Endpoint not found: ${endpoint}`), { status: 404 });
      return;
    }

    const auth = checkAuth(opts, q);
    if (!auth.ok) {
      if (opts.verbose) log(`${endpoint}: auth rejected (${auth.code})`);
      sendJson(res, failure(opts, auth.code, auth.message));
      return;
    }

    // --- route -------------------------------------------------------------
    const requestState = q.get('mock_empty') === '1' ? { ...state, empty: true } : state;
    const ctx = { opts, library, state: requestState, req, url, params: q, endpoint, log, coverCache };
    try {
      await HANDLERS[endpoint](ctx, res);
    } finally {
      if (opts.verbose) log(`${req.method} ${endpoint} -> ${res.statusCode} (${Date.now() - started}ms)`);
    }
  }

  // Readiness health check used by dev scripts, outside the /rest space.
  server.on('listening', () => {
    log(`listening on http://${opts.host}:${opts.port}`);
    log(`music:   ${library.root} (${library.tracks.length} tracks, ${library.albums.length} albums, ${library.artists.length} artists)`);
    log(`auth:    ${opts.auth ? `${opts.user} / ${opts.password} (token md5)` : 'disabled'}`);
    log(`state:   ${opts.state || 'in-memory (not persisted)'}`);
    log(`try:     curl 'http://${opts.host}:${opts.port}/rest/ping?u=${opts.user}&t=x&s=y&v=1.16.1&c=curl&f=json'`);
  });

  server.listen(opts.port, opts.host);
  return { server, library, state };
}

// ---------------------------------------------------------------------------
// Endpoint handlers
// ---------------------------------------------------------------------------

function albumListFor(state, type, params) {
  const albums = state.empty ? [] : state.library.albums.slice();
  const size = Math.max(0, Number(params.get('size') ?? 20));
  const offset = Math.max(0, Number(params.get('offset') ?? 0));
  const fromYear = params.get('fromYear') ? Number(params.get('fromYear')) : undefined;
  const toYear = params.get('toYear') ? Number(params.get('toYear')) : undefined;
  const genre = params.get('genre') || undefined;

  let list;
  switch (type) {
    case 'random':
      list = shuffled(albums, (state.seedBase || 1337) + (state.randomCounter = (state.randomCounter || 0) + 1));
      break;
    case 'newest':
      list = albums.sort((a, b) => (b.created || '').localeCompare(a.created || '') || a.name.localeCompare(b.name));
      break;
    case 'alphabeticalByName':
      list = albums.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case 'alphabeticalByArtist':
      list = albums.sort((a, b) => a.albumArtist.localeCompare(b.albumArtist) || a.name.localeCompare(b.name));
      break;
    case 'frequent':
      list = albums.sort((a, b) => albumPlayCount(state, b) - albumPlayCount(state, a));
      break;
    case 'recent':
      list = albums.sort(
        (a, b) =>
          (albumPlayed(state, b) || b.created || '').localeCompare(albumPlayed(state, a) || a.created || '') ||
          a.name.localeCompare(b.name),
      );
      break;
    case 'starred':
      list = albums.filter((a) => state.starredAlbums.has(a.id));
      break;
    case 'byYear':
      list = albums
        .filter((a) => (fromYear === undefined || (a.year ?? 0) >= fromYear) && (toYear === undefined || (a.year ?? 0) <= toYear))
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || a.name.localeCompare(b.name));
      break;
    case 'byGenre':
      list = albums
        .filter((a) => !genre || (a.genre || '').toLowerCase() === genre.toLowerCase())
        .sort((a, b) => a.name.localeCompare(b.name));
      break;
    default:
      list = albums;
  }
  return list.slice(offset, offset + size);
}

const HANDLERS = {
  ping(ctx, res) {
    sendJson(res, envelope(ctx.opts));
  },

  getAlbumList2(ctx, res) {
    const { state, params } = ctx;
    const type = params.get('type') || 'alphabeticalByName';
    const list = albumListFor(state, type, params);
    const payload = {};
    if (list.length) payload.albumList2 = { album: list.map((a) => serialiseAlbumSummary(state, a)) };
    else payload.albumList2 = {};
    sendJson(res, envelope(ctx.opts, payload));
  },

  getAlbum(ctx, res) {
    const id = ctx.params.get('id');
    const album = ctx.library.albumById.get(id);
    if (!album || ctx.state.empty) {
      sendJson(res, failure(ctx.opts, 70, `Album not found: ${id}`));
      return;
    }
    sendJson(res, envelope(ctx.opts, { album: serialiseAlbumFull(ctx.state, album) }));
  },

  getArtists(ctx, res) {
    const { state } = ctx;
    const artists = state.empty ? [] : ctx.library.artists;
    const buckets = new Map();
    for (const artist of artists) {
      const first = artist.name.trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : '#';
      if (!buckets.has(letter)) buckets.set(letter, []);
      buckets.get(letter).push(artist);
    }
    const index = [...buckets.entries()]
      .sort(([a], [b]) => (a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b)))
      .map(([name, list]) => ({ name, artist: list.map((a) => serialiseArtist(state, a)) }));
    sendJson(res, envelope(ctx.opts, { artists: { ignoredArticles: 'The El La Los Las Le Les', index } }));
  },

  getArtist(ctx, res) {
    const id = ctx.params.get('id');
    const artist = ctx.library.artists.find((a) => a.id === id);
    if (!artist || ctx.state.empty) {
      sendJson(res, failure(ctx.opts, 70, `Artist not found: ${id}`));
      return;
    }
    sendJson(
      res,
      envelope(ctx.opts, {
        artist: {
          ...serialiseArtist(ctx.state, artist),
          album: artist.albums.map((a) => serialiseAlbumSummary(ctx.state, a)),
        },
      }),
    );
  },

  getArtistInfo2(ctx, res) {
    const id = ctx.params.get('id');
    const count = Math.max(0, Number(ctx.params.get('count') ?? 20));
    const artist = ctx.library.artists.find((a) => a.id === id);
    if (!artist) {
      sendJson(res, failure(ctx.opts, 70, `Artist not found: ${id}`));
      return;
    }
    const similar = ctx.library.artists
      .filter((a) => a.id !== id)
      .slice(0, count)
      .map((a) => serialiseArtist(ctx.state, a));
    const bio =
      `${artist.name} is a fictional artist in the mock-subsonic demo library. ` +
      `This biography is generated locally by the mock server; no Last.fm data is used.`;
    sendJson(
      res,
      envelope(ctx.opts, {
        artistInfo2: {
          biography: bio,
          musicBrainzId: `mock-${artist.id}`,
          similarArtist: similar,
        },
      }),
    );
  },

  getTopSongs(ctx, res) {
    const artistName = (ctx.params.get('artist') || '').toLowerCase();
    const count = Math.max(0, Number(ctx.params.get('count') ?? 20));
    const songs = ctx.state.empty
      ? []
      : ctx.library.tracks
          .filter((t) => t.artistName.toLowerCase() === artistName || t.albumArtist.toLowerCase() === artistName)
          .sort((a, b) => trackPlayCount(ctx.state, b) - trackPlayCount(ctx.state, a) || a.title.localeCompare(b.title))
          .slice(0, count);
    sendJson(res, envelope(ctx.opts, songs.length ? { topSongs: { song: songs.map((t) => serialiseTrack(ctx.state, t)) } } : { topSongs: {} }));
  },

  getSimilarSongs2(ctx, res) {
    const { songs, key } = similarSongs(ctx);
    sendJson(res, envelope(ctx.opts, songs.length ? { [key]: { song: songs } } : { [key]: {} }));
  },

  getSimilarSongs(ctx, res) {
    const { songs } = similarSongs(ctx);
    sendJson(res, envelope(ctx.opts, songs.length ? { similarSongs: { song: songs } } : { similarSongs: {} }));
  },

  getRandomSongs(ctx, res) {
    const { state, params } = ctx;
    const size = Math.max(0, Number(params.get('size') ?? 50));
    const genre = params.get('genre');
    const fromYear = params.get('fromYear') ? Number(params.get('fromYear')) : undefined;
    const toYear = params.get('toYear') ? Number(params.get('toYear')) : undefined;
    let pool = state.empty ? [] : state.library.tracks.slice();
    if (genre) pool = pool.filter((t) => (t.genre || '').toLowerCase() === genre.toLowerCase());
    if (fromYear !== undefined) pool = pool.filter((t) => (t.year ?? 0) >= fromYear);
    if (toYear !== undefined) pool = pool.filter((t) => (t.year ?? 0) <= toYear);
    const seed = (ctx.opts.seed || 1337) + (ctx.randomCounter || 0);
    ctx.randomCounter = (ctx.randomCounter || 0) + 1;
    const songs = shuffled(pool, seed).slice(0, size);
    sendJson(res, envelope(ctx.opts, songs.length ? { randomSongs: { song: songs.map((t) => serialiseTrack(state, t)) } } : { randomSongs: {} }));
  },

  search3(ctx, res) {
    const { state, params } = ctx;
    const query = (params.get('query') || '').trim();
    const artistCount = Math.max(0, Number(params.get('artistCount') ?? 20));
    const albumCount = Math.max(0, Number(params.get('albumCount') ?? 20));
    const songCount = Math.max(0, Number(params.get('songCount') ?? 40));

    if (state.empty || !query) {
      sendJson(res, envelope(ctx.opts, { searchResult3: {} }));
      return;
    }
    const matchAll = query === '*' || query === '""';
    const needle = query.toLowerCase().replace(/^\*|\*$/g, '');
    const matches = (value) => matchAll || (value || '').toLowerCase().includes(needle);

    const artists = ctx.library.artists.filter((a) => matches(a.name)).slice(0, artistCount);
    const albums = ctx.library.albums
      .filter((a) => matches(a.name) || matches(a.albumArtist))
      .slice(0, albumCount);
    const songs = ctx.library.tracks
      .filter((t) => matches(t.title) || matches(t.artistName) || matches(t.albumName))
      .slice(0, songCount);

    const searchResult3 = {};
    if (artists.length) searchResult3.artist = artists.map((a) => serialiseArtist(state, a));
    if (albums.length) searchResult3.album = albums.map((a) => serialiseAlbumSummary(state, a));
    if (songs.length) searchResult3.song = songs.map((t) => serialiseTrack(state, t));
    sendJson(res, envelope(ctx.opts, { searchResult3 }));
  },

  getPlaylists(ctx, res) {
    const playlists = ctx.state.empty ? [] : ctx.state.playlists;
    const payload = playlists.length
      ? { playlists: { playlist: playlists.map((p) => serialisePlaylist(ctx.state, p, false)) } }
      : { playlists: {} };
    sendJson(res, envelope(ctx.opts, payload));
  },

  getPlaylist(ctx, res) {
    const id = ctx.params.get('id');
    const playlist = ctx.state.playlists.find((p) => p.id === id);
    if (!playlist || ctx.state.empty) {
      sendJson(res, failure(ctx.opts, 70, `Playlist not found: ${id}`));
      return;
    }
    sendJson(res, envelope(ctx.opts, { playlist: serialisePlaylist(ctx.state, playlist, true) }));
  },

  getStarred2(ctx, res) {
    const { state } = ctx;
    const payload = {};
    const tracks = state.empty ? [] : state.library.tracks.filter((t) => state.starredTracks.has(t.id));
    const albums = state.empty ? [] : state.library.albums.filter((a) => state.starredAlbums.has(a.id));
    const artists = state.empty ? [] : state.library.artists.filter((a) => state.starredArtists.has(a.id));
    const starred = {};
    if (artists.length) starred.artist = artists.map((a) => serialiseArtist(state, a));
    if (albums.length) starred.album = albums.map((a) => serialiseAlbumSummary(state, a));
    if (tracks.length) starred.song = tracks.map((t) => serialiseTrack(state, t));
    payload.starred2 = starred;
    sendJson(res, envelope(ctx.opts, payload));
  },

  star(ctx, res) {
    mutateStar(ctx, true);
    sendJson(res, envelope(ctx.opts));
  },

  unstar(ctx, res) {
    mutateStar(ctx, false);
    sendJson(res, envelope(ctx.opts));
  },

  scrobble(ctx, res) {
    const { state, params } = ctx;
    const id = params.get('id');
    const time = params.get('time');
    if (!id) {
      sendJson(res, failure(ctx.opts, 10, 'Missing required parameter id'));
      return;
    }
    const track = state.library.trackById.get(id);
    if (!track) {
      sendJson(res, failure(ctx.opts, 70, `Song not found: ${id}`));
      return;
    }
    const submission = params.get('submission') !== 'false';
    const when = time ? new Date(Number(time) * 1000).toISOString() : new Date().toISOString();
    if (submission) {
      state.playCounts.set(id, (state.playCounts.get(id) || 0) + 1);
      state.playedAt.set(id, when);
      state.persist();
    }
    sendJson(res, envelope(ctx.opts));
  },

  getGenres(ctx, res) {
    const { state } = ctx;
    const map = new Map();
    if (!state.empty) {
      for (const track of ctx.library.tracks) {
        const value = track.genre || 'Unknown';
        if (!map.has(value)) map.set(value, { songCount: 0, albumIds: new Set() });
        const entry = map.get(value);
        entry.songCount += 1;
        entry.albumIds.add(track.albumId);
      }
    }
    const genres = [...map.entries()].map(([value, e]) => ({
      value,
      songCount: e.songCount,
      albumCount: e.albumIds.size,
    }));
    sendJson(res, envelope(ctx.opts, genres.length ? { genres: { genre: genres } } : { genres: {} }));
  },

  getCoverArt(ctx, res) {
    const id = ctx.params.get('id');
    const picture = resolveCover(ctx, id);
    if (!picture) {
      sendJson(res, failure(ctx.opts, 70, `Cover art not found: ${id}`));
      return;
    }
    res.writeHead(200, {
      'Content-Type': picture.mime,
      'Content-Length': picture.data.length,
      'Cache-Control': 'public, max-age=86400',
      ...CORS_HEADERS,
    });
    if (ctx.req.method === 'HEAD') res.end();
    else res.end(picture.data);
  },

  stream(ctx, res) {
    serveAudio(ctx, res, 'inline');
  },

  download(ctx, res) {
    serveAudio(ctx, res, 'attachment');
  },
};

function similarSongs(ctx) {
  const id = ctx.params.get('id');
  const count = Math.max(0, Number(ctx.params.get('count') ?? 50));
  const seed = ctx.library.trackById.get(id);
  if (!seed || ctx.state.empty) return { songs: [], key: 'similarSongs2' };
  const ranked = ctx.library.tracks
    .filter((t) => t.id !== seed.id)
    .map((t) => {
      let score = 0;
      if (t.genre && seed.genre && t.genre.toLowerCase() === seed.genre.toLowerCase()) score += 3;
      if (t.artistId && seed.artistId && t.artistId === seed.artistId) score += 2;
      if (t.albumId === seed.albumId) score += 1;
      score += (hashInt(`${seed.id}:${t.id}`) % 1000) / 1000;
      return { t, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ t }) => serialiseTrack(ctx.state, t));
  return { songs: ranked, key: 'similarSongs2' };
}

function mutateStar(ctx, value) {
  const { state, params } = ctx;
  const at = value ? new Date().toISOString() : null;
  const apply = (map, id) => {
    if (!id) return;
    if (value) map.set(id, at);
    else map.delete(id);
  };
  apply(state.starredTracks, params.get('id'));
  apply(state.starredAlbums, params.get('albumId'));
  apply(state.starredArtists, params.get('artistId'));
  state.persist();
}

function resolveCover(ctx, id) {
  if (!id) return null;
  if (ctx.coverCache.has(id)) return ctx.coverCache.get(id);
  let file = null;
  let embedded = null;

  const album = ctx.library.albumById.get(id);
  if (album) {
    file = album.coverFile;
    embedded = album.embeddedPicture;
    if (!file && !embedded) {
      const first = album.tracks.find((t) => t.embeddedPicture);
      embedded = first?.embeddedPicture || null;
    }
  } else {
    const track = ctx.library.trackById.get(id);
    if (track) {
      const trackAlbum = ctx.library.albumById.get(track.albumId);
      file = trackAlbum?.coverFile || findCoverFile(track.dir);
      embedded = track.embeddedPicture || trackAlbum?.embeddedPicture || null;
    }
  }

  let picture = null;
  if (file && existsSync(file)) {
    const ext = extname(file).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg';
    picture = { mime, data: readFileSync(file) };
  } else if (embedded) {
    picture = embedded;
  }
  if (picture) ctx.coverCache.set(id, picture);
  return picture;
}

function serveAudio(ctx, res, disposition) {
  const { state, params } = ctx;
  const id = params.get('id');
  const track = state.empty ? null : state.library.trackById.get(id);
  if (!track) {
    sendJson(res, failure(ctx.opts, 70, `Song not found: ${id}`));
    return;
  }

  if (/^(1|true|yes)$/i.test(process.env.MOCK_STREAM_GARBAGE || '')) {
    const body = Buffer.from('not really audio\n');
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': body.length, ...CORS_HEADERS });
    res.end(body);
    return;
  }

  const size = track.size;
  const range = parseRange(ctx.req.headers.range, size);
  const headers = {
    'Content-Type': track.contentType,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `${disposition}; filename="${encodeURIComponent(
      `${track.trackNo ? String(track.trackNo).padStart(2, '0') + ' - ' : ''}${track.title}.${track.suffix}`,
    )}"`,
    'Cache-Control': 'public, max-age=3600',
    ...CORS_HEADERS,
  };

  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range) {
    start = range.start;
    end = range.end;
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  const truncate = Number(process.env.MOCK_TRUNCATE_STREAM_BYTES || params.get('mock_truncate') || 0);
  let length = end - start + 1;
  if (truncate > 0 && truncate < length) length = truncate;
  headers['Content-Length'] = length;

  res.writeHead(status, headers);
  if (ctx.opts && ctx.opts.verbose) ctx.log(`${ctx.endpoint}: ${track.relPath} bytes ${start}-${start + length - 1}/${size}`);
  if (ctx.req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(track.path, { start, end: start + length - 1 })
    .on('error', () => res.end())
    .pipe(res);
}

function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  let start;
  let end;
  if (m[1] === '' && m[2] !== '') {
    const suffix = Number(m[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    process.stdout.write(usage());
    process.exit(0);
  }

  try {
    const { server } = startServer(opts);
    const shutdown = () => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    process.stderr.write(`[mock-subsonic] ${error.message}\n`);
    process.exit(1);
  }
}

// Exported for programmatic use (tests can import buildLibrary / startServer).
export { buildLibrary, startServer, parseId3v2, parseFlac, mp3Duration, tagsFromId3 };
export { SCRIPT_DIR };
