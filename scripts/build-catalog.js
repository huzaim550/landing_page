// Build a showcase catalog of *public-domain* movies (Internet Archive) and
// freely-available live TV channels. This powers the "What's inside" preview on
// the landing page. It does NOT serve streams — the real Xtream server does that.
//
//   node scripts/build-catalog.js
//
// Writes catalog.json next to the project root.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- Public-domain movies: pull the most-downloaded feature films that the
// Internet Archive hosts under its public-domain "feature_films" collection.
const SEARCH_URL =
  'https://archive.org/advancedsearch.php?q=' +
  encodeURIComponent('collection:(feature_films) AND mediatype:(movies)') +
  '&fl[]=identifier&fl[]=title&fl[]=year&fl[]=downloads' +
  '&sort[]=downloads+desc&rows=120&page=1&output=json';

// Skip exploitation / shock / otherwise off-brand items so the showcase stays
// on recognizable public-domain classics.
const DENY = /(sex|reefer|nazi|concentration|bloody|madness|dr\.?\s*sex|porno|nude|nudist|erotic|kinsey|child|molest|syphilis|hygiene|venereal|drug)/i;

// Pick the best playable MP4 from an item's file list.
function pickMp4(files) {
  const mp4s = files.filter(
    (f) => typeof f.name === 'string' && /\.mp4$/i.test(f.name) && f.source !== 'metadata'
  );
  if (!mp4s.length) return null;
  // Prefer h.264 ("512kb"/"h264"), otherwise the largest by size.
  mp4s.sort((a, b) => Number(b.size || 0) - Number(a.size || 0));
  const h264 = mp4s.find((f) => /h\.?264|512kb|mp4/i.test(f.format || ''));
  return h264 || mp4s[0];
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'manzar-catalog/1.0' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function buildMovies() {
  console.log('Searching Internet Archive for public-domain feature films…');
  const search = await getJson(SEARCH_URL);
  const docs = search.response?.docs || [];
  console.log(`  ${docs.length} candidates`);

  const movies = [];
  let streamId = 1000; // VOD ids start at 1000
  for (const doc of docs) {
    if (movies.length >= 18) break;
    const label = `${doc.title || ''} ${doc.identifier}`;
    if (DENY.test(label)) {
      console.log(`  - skip (off-brand): ${doc.title || doc.identifier}`);
      continue;
    }
    try {
      const meta = await getJson(`https://archive.org/metadata/${doc.identifier}`);
      const file = pickMp4(meta.files || []);
      if (!file) continue;
      const title = (meta.metadata?.title || doc.title || doc.identifier).toString().trim();
      const year = Number(doc.year) || Number(meta.metadata?.year) || null;
      movies.push({
        stream_id: streamId++,
        name: year ? `${title} (${year})` : title,
        title,
        year,
        category: 'Public Domain Films',
        poster: `https://archive.org/services/img/${doc.identifier}`,
        // Stable Internet Archive download URL (302-redirects to a mirror).
        url: `https://archive.org/download/${doc.identifier}/${encodeURIComponent(file.name)}`,
        ext: 'mp4',
        source: 'Internet Archive',
      });
      console.log(`  + ${title}`);
    } catch (err) {
      console.log(`  ! skip ${doc.identifier}: ${err.message}`);
    }
  }
  return movies;
}

// ---- Freely-available / free-to-air live channels (public streams).
// These are public, official free live feeds distributed openly (same sources
// the iptv-org project catalogs). Logos come from iptv-org's public logo repo.
const LIVE_CHANNELS = [
  {
    name: 'NASA TV Public',
    category: 'Science & Space',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg',
    url: 'https://ntv1.akamaihd.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
  },
  {
    name: 'Red Bull TV',
    category: 'Sports & Action',
    logo: 'https://upload.wikimedia.org/wikipedia/en/f/f2/Red_Bull_TV_logo.png',
    url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
  },
  {
    name: 'DW English',
    category: 'News',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/f/f7/Deutsche_Welle_symbol_2012.svg',
    url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
  },
  {
    name: 'France 24 English',
    category: 'News',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/8/842/FRANCE_24_logo.svg',
    url: 'https://static.france24.com/live/F24_EN_HI_HLS/live_web.m3u8',
  },
  {
    name: 'Al Jazeera English',
    category: 'News',
    logo: 'https://upload.wikimedia.org/wikipedia/en/f/f2/Aljazeera_eng.svg',
    url: 'https://live-hls-web-aje.getaj.net/AJE/index.m3u8',
  },
  {
    name: 'Bloomberg TV',
    category: 'News',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/5/57/Bloomberg_Television_2016.svg',
    url: 'https://bloomberg-bloombergtv-1-eu.rakuten.wurl.tv/playlist.m3u8',
  },
];

function buildLive() {
  let streamId = 1;
  return LIVE_CHANNELS.map((c) => ({
    stream_id: streamId++,
    name: c.name,
    category: c.category,
    logo: c.logo,
    url: c.url,
    ext: 'm3u8',
    source: 'Free-to-air',
  }));
}

async function main() {
  const [movies, live] = [await buildMovies(), buildLive()];
  const catalog = {
    generated_at: new Date().toISOString(),
    note:
      'Showcase catalog of freely-available / public-domain content. Streams are served by the Xtream server, not this landing page.',
    live,
    movies,
  };
  const out = path.join(ROOT, 'catalog.json');
  fs.writeFileSync(out, JSON.stringify(catalog, null, 2));
  console.log(`\nWrote ${out} — ${live.length} live channels, ${movies.length} movies.`);
}

main().catch((err) => {
  console.error('Catalog build failed:', err);
  process.exit(1);
});
