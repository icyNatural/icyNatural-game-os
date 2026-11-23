#!/usr/bin/env node
/**
 * Builds the Game OS seed graph from a terse, reviewable source:
 *   - assets/data/seed-graph.json        (validated by branch-schema)
 *   - assets/js/data/seed-graph.js       (window.GOS_SEED_GRAPH for file://)
 *
 * Honesty rules baked into the defaults:
 *   - well-documented facts  -> high / confirmed / verified
 *   - softer lineage/influence claims -> moderate|speculative / unreviewed + evidence text
 *   - every influence / analogous-design / mechanical-similarity edge carries evidence
 *
 * Run: node tools/build-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------- entities -------------------------------- */

/** [id, name, year, modes, playability, aliases?] */
const games = [
  ['game:virtua-fighter-5', 'Virtua Fighter 5', 2006, 'single,multiplayer,pvp', 'current', ['VF5']],
  ['game:virtua-fighter-4', 'Virtua Fighter 4', 2001, 'single,multiplayer,pvp', 'legacy', ['VF4']],
  ['game:virtua-fighter-2', 'Virtua Fighter 2', 1994, 'single,multiplayer,pvp', 'legacy', ['VF2']],
  ['game:tekken-8', 'Tekken 8', 2024, 'single,multiplayer,pvp', 'current'],
  ['game:tekken-7', 'Tekken 7', 2015, 'single,multiplayer,pvp', 'current'],
  ['game:tekken-3', 'Tekken 3', 1998, 'single,multiplayer,pvp', 'legacy'],
  ['game:street-fighter-6', 'Street Fighter 6', 2023, 'single,multiplayer,pvp', 'current', ['SF6']],
  ['game:street-fighter-4', 'Street Fighter IV', 2008, 'single,multiplayer,pvp', 'legacy', ['SF4']],
  ['game:street-fighter-ii', 'Street Fighter II', 1991, 'single,multiplayer,pvp', 'legacy', ['SF2']],
  ['game:dead-or-alive-5', 'Dead or Alive 5', 2012, 'single,multiplayer,pvp', 'legacy', ['DOA5']],
  ['game:mortal-kombat-11', 'Mortal Kombat 11', 2019, 'single,multiplayer,pvp', 'current', ['MK11']],
  ['game:mortal-kombat-ii', 'Mortal Kombat II', 1993, 'single,multiplayer,pvp', 'legacy', ['MK2']],
  ['game:guilty-gear-xrd', 'Guilty Gear Xrd', 2014, 'single,multiplayer,pvp', 'legacy'],
  ['game:smash-ultimate', 'Super Smash Bros. Ultimate', 2018, 'single,multiplayer,coop,pvp', 'current'],
  ['game:smash-melee', 'Super Smash Bros. Melee', 2001, 'single,multiplayer,coop,pvp', 'legacy'],
  ['game:halo-ce', 'Halo: Combat Evolved', 2001, 'single,multiplayer,coop', 'legacy', ['Halo']],
  ['game:halo-3', 'Halo 3', 2007, 'single,multiplayer,coop', 'current'],
  ['game:halo-infinite', 'Halo Infinite', 2021, 'single,multiplayer,coop', 'current'],
  ['game:destiny', 'Destiny', 2014, 'single,multiplayer,coop', 'legacy'],
  ['game:gears-of-war', 'Gears of War', 2006, 'single,multiplayer,coop', 'legacy'],
  ['game:gears-of-war-3', 'Gears of War 3', 2011, 'single,multiplayer,coop', 'legacy'],
  ['game:gears-5', 'Gears 5', 2019, 'single,multiplayer,coop', 'current'],
  ['game:gears-of-war-e-day', 'Gears of War: E-Day', 2026, 'single,multiplayer,coop', 'current', ['E-Day', 'Gears E-Day']],
  ['game:doom-2016', 'DOOM', 2016, 'single', 'legacy', ['DOOM 2016']],
  ['game:doom-eternal', 'DOOM Eternal', 2020, 'single', 'current'],
  ['game:quake', 'Quake', 1996, 'single,multiplayer,coop', 'legacy'],
  ['game:quake-iii-arena', 'Quake III Arena', 1999, 'single,multiplayer,pvp', 'legacy', ['Q3A']],
  ['game:unreal-tournament', 'Unreal Tournament', 1999, 'single,multiplayer,pvp', 'legacy', ['UT99']],
  ['game:left-4-dead', 'Left 4 Dead', 2008, 'single,multiplayer,coop', 'legacy', ['L4D']],
  ['game:left-4-dead-2', 'Left 4 Dead 2', 2009, 'single,multiplayer,coop', 'current', ['L4D2']],
  ['game:team-fortress-2', 'Team Fortress 2', 2007, 'multiplayer,pvp', 'current', ['TF2']],
  ['game:overwatch-2', 'Overwatch 2', 2022, 'multiplayer,pvp', 'current'],
  ['game:valorant', 'VALORANT', 2020, 'multiplayer,pvp', 'current'],
  ['game:counter-strike-2', 'Counter-Strike 2', 2023, 'multiplayer,pvp', 'current', ['CS2']],
  ['game:call-of-duty-4', 'Call of Duty 4: Modern Warfare', 2007, 'single,multiplayer,pvp', 'legacy', ['CoD4']],
  ['game:battlefield-1942', 'Battlefield 1942', 2002, 'single,multiplayer,pvp', 'legacy', ['BF1942']],
  ['game:demon-souls', "Demon's Souls", 2009, 'single,multiplayer', 'legacy'],
  ['game:dark-souls', 'Dark Souls', 2011, 'single,multiplayer', 'current'],
  ['game:dark-souls-2', 'Dark Souls II', 2014, 'single,multiplayer', 'current', ['DS2']],
  ['game:dark-souls-3', 'Dark Souls III', 2016, 'single,multiplayer', 'current', ['DS3']],
  ['game:elden-ring', 'Elden Ring', 2022, 'single,multiplayer', 'current'],
  ['game:bloodborne', 'Bloodborne', 2015, 'single,multiplayer', 'current'],
  ['game:sekiro', 'Sekiro: Shadows Die Twice', 2019, 'single', 'current'],
  ['game:zelda-botw', 'The Legend of Zelda: Breath of the Wild', 2017, 'single', 'current', ['Breath of the Wild', 'BotW']],
  ['game:witcher-3', 'The Witcher 3: Wild Hunt', 2015, 'single', 'current'],
  ['game:skyrim', 'The Elder Scrolls V: Skyrim', 2011, 'single', 'current'],
  ['game:fallout-new-vegas', 'Fallout: New Vegas', 2010, 'single', 'current', ['FNV']],
  ['game:baldurs-gate-3', "Baldur's Gate 3", 2023, 'single,multiplayer,coop', 'current', ['BG3']],
  ['game:persona-5', 'Persona 5', 2016, 'single', 'legacy', ['P5']],
  ['game:starcraft', 'StarCraft', 1998, 'single,multiplayer,pvp', 'current'],
  ['game:age-of-empires-ii', 'Age of Empires II', 1999, 'single,multiplayer,pvp', 'current', ['AoE2']],
  ['game:civilization-6', 'Civilization VI', 2016, 'single,multiplayer', 'current', ['Civ VI']],
  ['game:xcom-enemy-unknown', 'XCOM: Enemy Unknown', 2012, 'single,multiplayer', 'current'],
  ['game:hades', 'Hades', 2020, 'single', 'current'],
  ['game:slay-the-spire', 'Slay the Spire', 2019, 'single', 'current'],
  ['game:thief-the-dark-project', 'Thief: The Dark Project', 1998, 'single', 'legacy', ['Thief']],
  ['game:system-shock-2', 'System Shock 2', 1999, 'single,multiplayer', 'current', ['SS2']],
  ['game:deus-ex', 'Deus Ex', 2000, 'single', 'current'],
  ['game:dishonored', 'Dishonored', 2012, 'single', 'current'],
  ['game:dishonored-2', 'Dishonored 2', 2016, 'single', 'current'],
  ['game:prey-2017', 'Prey', 2017, 'single', 'current', ['Prey (2017)']],
  ['game:hitman-blood-money', 'Hitman: Blood Money', 2006, 'single', 'legacy'],
  ['game:hitman-2016', 'Hitman', 2016, 'single,multiplayer', 'current', ['Hitman (2016)']],
  ['game:metal-gear-solid-v', 'Metal Gear Solid V: The Phantom Pain', 2015, 'single,multiplayer', 'current', ['MGSV']],
  ['game:alien-isolation', 'Alien: Isolation', 2014, 'single', 'current'],
  ['game:hollow-knight', 'Hollow Knight', 2017, 'single', 'current'],
  ['game:celeste', 'Celeste', 2018, 'single', 'current'],
  ['game:dead-cells', 'Dead Cells', 2018, 'single', 'current'],
  ['game:gta-v', 'Grand Theft Auto V', 2013, 'single,multiplayer', 'current', ['GTA V']],
  ['game:red-dead-redemption-2', 'Red Dead Redemption 2', 2018, 'single,multiplayer', 'current', ['RDR2']],
  ['game:minecraft', 'Minecraft', 2011, 'single,multiplayer,coop', 'current']
];

/** [id, name, aliases?] */
const studios = [
  ['studio:sega', 'Sega'],
  ['studio:seg-am2', 'Sega AM2'],
  ['studio:bandai-namco', 'Bandai Namco'],
  ['studio:namco', 'Namco'],
  ['studio:capcom', 'Capcom'],
  ['studio:team-ninja', 'Team Ninja'],
  ['studio:koei-tecmo', 'Koei Tecmo'],
  ['studio:midway', 'Midway'],
  ['studio:netherrealm', 'NetherRealm Studios'],
  ['studio:arc-system-works', 'Arc System Works'],
  ['studio:nintendo', 'Nintendo'],
  ['studio:hal-laboratory', 'HAL Laboratory'],
  ['studio:sora', 'Sora Ltd.'],
  ['studio:nintendo-epd', 'Nintendo EPD'],
  ['studio:bungie', 'Bungie'],
  ['studio:epic-games', 'Epic Games'],
  ['studio:the-coalition', 'The Coalition'],
  ['studio:people-can-fly', 'People Can Fly'],
  ['studio:id-software', 'id Software'],
  ['studio:valve', 'Valve'],
  ['studio:blizzard', 'Blizzard Entertainment'],
  ['studio:riot-games', 'Riot Games'],
  ['studio:infinity-ward', 'Infinity Ward'],
  ['studio:activision', 'Activision'],
  ['studio:dice', 'DICE'],
  ['studio:electronic-arts', 'Electronic Arts'],
  ['studio:from-software', 'FromSoftware'],
  ['studio:cd-projekt-red', 'CD Projekt Red'],
  ['studio:bethesda-game-studios', 'Bethesda Game Studios'],
  ['studio:bethesda-softworks', 'Bethesda Softworks'],
  ['studio:obsidian', 'Obsidian Entertainment'],
  ['studio:black-isle', 'Black Isle Studios'],
  ['studio:larian', 'Larian Studios'],
  ['studio:atlus', 'Atlus'],
  ['studio:ensemble-studios', 'Ensemble Studios'],
  ['studio:firaxis', 'Firaxis Games'],
  ['studio:supergiant', 'Supergiant Games'],
  ['studio:mega-crit', 'Mega Crit'],
  ['studio:looking-glass', 'Looking Glass Studios'],
  ['studio:irrational', 'Irrational Games'],
  ['studio:ion-storm', 'Ion Storm'],
  ['studio:arkane', 'Arkane Studios'],
  ['studio:io-interactive', 'IO Interactive'],
  ['studio:eidos', 'Eidos', ['Eidos Interactive']],
  ['studio:square-enix', 'Square Enix'],
  ['studio:konami', 'Konami'],
  ['studio:kojima-productions', 'Kojima Productions'],
  ['studio:creative-assembly', 'Creative Assembly'],
  ['studio:team-cherry', 'Team Cherry'],
  ['studio:matt-makes-games', 'Matt Makes Games', ['Maddy Makes Games']],
  ['studio:motion-twin', 'Motion Twin'],
  ['studio:rockstar-north', 'Rockstar North', ['DMA Design']],
  ['studio:rockstar-games', 'Rockstar Games'],
  ['studio:rockstar-studios', 'Rockstar Studios'],
  ['studio:mojang', 'Mojang Studios', ['Mojang']],
  ['studio:halo-studios', 'Halo Studios', ['343 Industries']],
  ['studio:xbox-game-studios', 'Xbox Game Studios', ['Microsoft Game Studios']],
  ['studio:warner-bros-games', 'Warner Bros. Games', ['Warner Bros. Interactive Entertainment']],
  ['studio:sony', 'Sony Interactive Entertainment'],
  ['studio:2k-games', '2K Games', ['2K']]
];

/** [id, name, role] */
const people = [
  ['person:yu-suzuki', 'Yu Suzuki', 'director / creator'],
  ['person:katsuhiro-harada', 'Katsuhiro Harada', 'director / series producer'],
  ['person:ed-boon', 'Ed Boon', 'co-creator / creative director'],
  ['person:john-tobias', 'John Tobias', 'co-creator'],
  ['person:john-carmack', 'John Carmack', 'programmer / co-founder'],
  ['person:john-romero', 'John Romero', 'designer / co-founder'],
  ['person:hidetaka-miyazaki', 'Hidetaka Miyazaki', 'director / president'],
  ['person:ken-levine', 'Ken Levine', 'designer / founder'],
  ['person:warren-spector', 'Warren Spector', 'director'],
  ['person:harvey-smith', 'Harvey Smith', 'director / designer'],
  ['person:todd-howard', 'Todd Howard', 'director / executive producer'],
  ['person:josh-sawyer', 'Josh Sawyer', 'director'],
  ['person:feargus-urquhart', 'Feargus Urquhart', 'studio head / founder'],
  ['person:swen-vincke', 'Swen Vincke', 'founder / CEO'],
  ['person:sid-meier', 'Sid Meier', 'creator / founder'],
  ['person:hidemaro-fujibayashi', 'Hidemaro Fujibayashi', 'director'],
  ['person:matt-thorson', 'Matt Thorson', 'co-creator'],
  ['person:noel-berry', 'Noel Berry', 'co-creator'],
  ['person:hideo-kojima', 'Hideo Kojima', 'director'],
  ['person:markus-persson', 'Markus Persson', 'founder']
];

/** [id, name, aliases?] */
const franchises = [
  ['franchise:virtua-fighter', 'Virtua Fighter'],
  ['franchise:tekken', 'Tekken'],
  ['franchise:street-fighter', 'Street Fighter'],
  ['franchise:mortal-kombat', 'Mortal Kombat'],
  ['franchise:dead-or-alive', 'Dead or Alive'],
  ['franchise:guilty-gear', 'Guilty Gear'],
  ['franchise:super-smash-bros', 'Super Smash Bros.'],
  ['franchise:halo', 'Halo'],
  ['franchise:gears-of-war', 'Gears of War'],
  ['franchise:doom', 'DOOM'],
  ['franchise:quake', 'Quake'],
  ['franchise:unreal', 'Unreal'],
  ['franchise:left-4-dead', 'Left 4 Dead'],
  ['franchise:counter-strike', 'Counter-Strike'],
  ['franchise:call-of-duty', 'Call of Duty'],
  ['franchise:battlefield', 'Battlefield'],
  ['franchise:destiny', 'Destiny'],
  ['franchise:dark-souls', 'Dark Souls'],
  ['franchise:demons-souls', "Demon's Souls"],
  ['franchise:elden-ring', 'Elden Ring'],
  ['franchise:zelda', 'The Legend of Zelda'],
  ['franchise:the-witcher', 'The Witcher'],
  ['franchise:the-elder-scrolls', 'The Elder Scrolls'],
  ['franchise:fallout', 'Fallout'],
  ['franchise:baldurs-gate', "Baldur's Gate"],
  ['franchise:persona', 'Persona'],
  ['franchise:shin-megami-tensei', 'Shin Megami Tensei'],
  ['franchise:starcraft', 'StarCraft'],
  ['franchise:age-of-empires', 'Age of Empires'],
  ['franchise:civilization', 'Civilization'],
  ['franchise:xcom', 'XCOM'],
  ['franchise:metal-gear', 'Metal Gear'],
  ['franchise:hitman', 'Hitman'],
  ['franchise:thief', 'Thief'],
  ['franchise:dishonored', 'Dishonored'],
  ['franchise:deus-ex', 'Deus Ex'],
  ['franchise:grand-theft-auto', 'Grand Theft Auto'],
  ['franchise:red-dead', 'Red Dead'],
  ['franchise:minecraft', 'Minecraft']
];

/** [id, name] — names match the taste engine's signal mechanics exactly. */
const mechanics = [
  ['mechanic:combat', 'combat'],
  ['mechanic:movement', 'movement'],
  ['mechanic:active-defense', 'active defense'],
  ['mechanic:parry', 'parry'],
  ['mechanic:reversal', 'reversal'],
  ['mechanic:spacing', 'spacing'],
  ['mechanic:counterplay', 'counterplay'],
  ['mechanic:exploration', 'exploration'],
  ['mechanic:atmosphere', 'atmosphere'],
  ['mechanic:build-variety', 'build variety'],
  ['mechanic:class-based-play', 'class-based play'],
  ['mechanic:ability-synergy', 'ability synergy'],
  ['mechanic:cooldown-combat', 'cooldown combat'],
  ['mechanic:role-identity', 'role identity'],
  ['mechanic:loot', 'loot'],
  ['mechanic:progression', 'progression'],
  ['mechanic:difficulty', 'difficulty'],
  ['mechanic:boss-encounters', 'boss encounters'],
  ['mechanic:co-op', 'co-op'],
  ['mechanic:pvp', 'pvp'],
  ['mechanic:team-coordination', 'team coordination'],
  ['mechanic:experimentation', 'experimentation'],
  ['mechanic:destructibility', 'destructibility'],
  ['mechanic:traversal', 'traversal'],
  ['mechanic:arena-combat', 'arena combat'],
  ['mechanic:deck-building', 'deck building'],
  ['mechanic:pacing', 'pacing'],
  ['mechanic:stealth', 'stealth'],
  ['mechanic:soulslike', 'soulslike'],
  ['mechanic:roguelike', 'roguelike'],
  ['mechanic:possession', 'possession']
];

const platforms = [
  ['platform:pc', 'PC'],
  ['platform:playstation', 'PlayStation'],
  ['platform:playstation-2', 'PlayStation 2'],
  ['platform:playstation-3', 'PlayStation 3'],
  ['platform:playstation-4', 'PlayStation 4'],
  ['platform:playstation-5', 'PlayStation 5'],
  ['platform:xbox-360', 'Xbox 360'],
  ['platform:xbox-one', 'Xbox One'],
  ['platform:xbox-series', 'Xbox Series X|S'],
  ['platform:nintendo-switch', 'Nintendo Switch'],
  ['platform:gamecube', 'Nintendo GameCube'],
  ['platform:arcade', 'Arcade']
];

/* --------------------------------- nodes --------------------------------- */

/** Verified per-game metadata overlays (exact release dates, etc.). */
const GAME_METADATA = {
  'game:gears-of-war-e-day': {
    released: '2026-10-06',
    releaseStatus: 'released',
    earlyAccess: '2026-10-01',
    engine: 'Unreal Engine 5'
  }
};

const nodes = [];
function add(list, type, make) { list.forEach((row) => nodes.push(make(row))); }

add(games, 'game', ([id, name, year, modes, playability, aliases]) => ({
  id, type: 'game', name,
  ...(aliases ? { aliases } : {}),
  metadata: { year, modes: modes.split(','), playability, ...(GAME_METADATA[id] || {}) }
}));
add(studios, 'studio', ([id, name, aliases]) => ({
  id, type: 'studio', name, ...(aliases ? { aliases } : {})
}));
add(people, 'person', ([id, name, role]) => ({ id, type: 'person', name, metadata: { role } }));
add(franchises, 'franchise', ([id, name, aliases]) => ({
  id, type: 'franchise', name, ...(aliases ? { aliases } : {})
}));
add(mechanics, 'mechanic', ([id, name]) => ({ id, type: 'mechanic', name }));
add(platforms, 'platform', ([id, name]) => ({ id, type: 'platform', name }));

/* --------------------------------- edges --------------------------------- */

const edges = [];
const GAP = 'intermediate series entries are not included in the seed graph';

function ed(source, relationship_type, target, o = {}) {
  const edge = {
    id: `e${String(edges.length + 1).padStart(4, '0')}`,
    source,
    relationship_type,
    target,
    confidence_band: o.band || 'high',
    confidence_native: o.native || 'confirmed',
    review_status: o.status || 'verified'
  };
  if (o.ev) edge.evidence = [{ text: o.ev, kind: o.kind || 'direct' }];
  else if (edge.confidence_band !== 'high') edge.evidence = [{ text: 'Seed entry: ' + edge.confidence_band + ' confidence, pending source review.', kind: 'inferred' }];
  if (o.notes) edge.notes = o.notes;
  edges.push(edge);
}
function soft(source, type, target, ev, o = {}) {
  ed(source, type, target, { band: o.band || 'moderate', native: o.native || 'probable', status: 'unreviewed', ev, kind: o.kind || 'inferred', notes: o.notes });
}
function pairs(spec, type, o = {}) {
  const list = Array.isArray(spec) ? spec : Object.entries(spec).flatMap(([s, ts]) => ts.map((t) => [s, t]));
  list.forEach(([s, t]) => ed(s, type, t, o));
}

/* credits: developed / published */
pairs({
  'game:virtua-fighter-5': ['studio:seg-am2'], 'game:virtua-fighter-4': ['studio:seg-am2'],
  'game:virtua-fighter-2': ['studio:seg-am2'],
  'game:tekken-8': ['studio:bandai-namco'], 'game:tekken-7': ['studio:bandai-namco'],
  'game:tekken-3': ['studio:namco'],
  'game:street-fighter-6': ['studio:capcom'], 'game:street-fighter-4': ['studio:capcom'],
  'game:street-fighter-ii': ['studio:capcom'],
  'game:dead-or-alive-5': ['studio:team-ninja'],
  'game:mortal-kombat-11': ['studio:netherrealm'], 'game:mortal-kombat-ii': ['studio:midway'],
  'game:guilty-gear-xrd': ['studio:arc-system-works'],
  'game:smash-ultimate': ['studio:sora', 'studio:bandai-namco'],
  'game:smash-melee': ['studio:hal-laboratory'],
  'game:halo-ce': ['studio:bungie'], 'game:halo-3': ['studio:bungie'],
  'game:halo-infinite': ['studio:halo-studios'],
  'game:destiny': ['studio:bungie'],
  'game:gears-of-war': ['studio:epic-games'], 'game:gears-of-war-3': ['studio:epic-games'],
  'game:gears-5': ['studio:the-coalition'],
  'game:gears-of-war-e-day': ['studio:the-coalition', 'studio:people-can-fly'],
  'game:doom-2016': ['studio:id-software'], 'game:doom-eternal': ['studio:id-software'],
  'game:quake': ['studio:id-software'], 'game:quake-iii-arena': ['studio:id-software'],
  'game:unreal-tournament': ['studio:epic-games'],
  'game:left-4-dead': ['studio:valve'], 'game:left-4-dead-2': ['studio:valve'],
  'game:team-fortress-2': ['studio:valve'], 'game:counter-strike-2': ['studio:valve'],
  'game:overwatch-2': ['studio:blizzard'], 'game:starcraft': ['studio:blizzard'],
  'game:valorant': ['studio:riot-games'],
  'game:call-of-duty-4': ['studio:infinity-ward'],
  'game:battlefield-1942': ['studio:dice'],
  'game:demon-souls': ['studio:from-software'], 'game:dark-souls': ['studio:from-software'],
  'game:dark-souls-2': ['studio:from-software'], 'game:dark-souls-3': ['studio:from-software'],
  'game:elden-ring': ['studio:from-software'], 'game:bloodborne': ['studio:from-software'],
  'game:sekiro': ['studio:from-software'],
  'game:zelda-botw': ['studio:nintendo-epd'],
  'game:witcher-3': ['studio:cd-projekt-red'],
  'game:skyrim': ['studio:bethesda-game-studios'],
  'game:fallout-new-vegas': ['studio:obsidian'],
  'game:baldurs-gate-3': ['studio:larian'],
  'game:persona-5': ['studio:atlus'],
  'game:age-of-empires-ii': ['studio:ensemble-studios'],
  'game:civilization-6': ['studio:firaxis'], 'game:xcom-enemy-unknown': ['studio:firaxis'],
  'game:hades': ['studio:supergiant'],
  'game:slay-the-spire': ['studio:mega-crit'],
  'game:thief-the-dark-project': ['studio:looking-glass'],
  'game:system-shock-2': ['studio:looking-glass', 'studio:irrational'],
  'game:deus-ex': ['studio:ion-storm'],
  'game:dishonored': ['studio:arkane'], 'game:dishonored-2': ['studio:arkane'],
  'game:prey-2017': ['studio:arkane'],
  'game:hitman-blood-money': ['studio:io-interactive'], 'game:hitman-2016': ['studio:io-interactive'],
  'game:metal-gear-solid-v': ['studio:kojima-productions'],
  'game:alien-isolation': ['studio:creative-assembly'],
  'game:hollow-knight': ['studio:team-cherry'],
  'game:celeste': ['studio:matt-makes-games'],
  'game:dead-cells': ['studio:motion-twin'],
  'game:gta-v': ['studio:rockstar-north'],
  'game:red-dead-redemption-2': ['studio:rockstar-studios'],
  'game:minecraft': ['studio:mojang']
}, 'DEVELOPED_BY');

pairs({
  'game:virtua-fighter-5': ['studio:sega'], 'game:virtua-fighter-4': ['studio:sega'],
  'game:virtua-fighter-2': ['studio:sega'],
  'game:tekken-8': ['studio:bandai-namco'], 'game:tekken-7': ['studio:bandai-namco'],
  'game:tekken-3': ['studio:namco'],
  'game:street-fighter-6': ['studio:capcom'], 'game:street-fighter-4': ['studio:capcom'],
  'game:street-fighter-ii': ['studio:capcom'],
  'game:dead-or-alive-5': ['studio:koei-tecmo'],
  'game:mortal-kombat-11': ['studio:warner-bros-games'], 'game:mortal-kombat-ii': ['studio:midway'],
  'game:guilty-gear-xrd': ['studio:arc-system-works'],
  'game:smash-ultimate': ['studio:nintendo'], 'game:smash-melee': ['studio:nintendo'],
  'game:halo-ce': ['studio:xbox-game-studios'], 'game:halo-3': ['studio:xbox-game-studios'],
  'game:halo-infinite': ['studio:xbox-game-studios'],
  'game:destiny': ['studio:activision'],
  'game:gears-of-war': ['studio:xbox-game-studios'],
  'game:gears-of-war-3': ['studio:xbox-game-studios'],
  'game:gears-5': ['studio:xbox-game-studios'],
  'game:gears-of-war-e-day': ['studio:xbox-game-studios'],
  'game:doom-2016': ['studio:bethesda-softworks'], 'game:doom-eternal': ['studio:bethesda-softworks'],
  'game:quake-iii-arena': ['studio:activision'],
  'game:left-4-dead': ['studio:valve'], 'game:left-4-dead-2': ['studio:valve'],
  'game:team-fortress-2': ['studio:valve'], 'game:counter-strike-2': ['studio:valve'],
  'game:overwatch-2': ['studio:blizzard'], 'game:starcraft': ['studio:blizzard'],
  'game:valorant': ['studio:riot-games'],
  'game:call-of-duty-4': ['studio:activision'],
  'game:battlefield-1942': ['studio:electronic-arts'],
  'game:demon-souls': ['studio:atlus'],
  'game:dark-souls': ['studio:bandai-namco'], 'game:dark-souls-2': ['studio:bandai-namco'],
  'game:dark-souls-3': ['studio:bandai-namco'], 'game:elden-ring': ['studio:bandai-namco'],
  'game:bloodborne': ['studio:sony'], 'game:sekiro': ['studio:activision'],
  'game:zelda-botw': ['studio:nintendo'],
  'game:witcher-3': ['studio:cd-projekt-red'],
  'game:skyrim': ['studio:bethesda-softworks'],
  'game:fallout-new-vegas': ['studio:bethesda-softworks'],
  'game:baldurs-gate-3': ['studio:larian'],
  'game:persona-5': ['studio:atlus'],
  'game:age-of-empires-ii': ['studio:xbox-game-studios'],
  'game:civilization-6': ['studio:2k-games'], 'game:xcom-enemy-unknown': ['studio:2k-games'],
  'game:hades': ['studio:supergiant'],
  'game:slay-the-spire': ['studio:mega-crit'],
  'game:thief-the-dark-project': ['studio:eidos'],
  'game:system-shock-2': ['studio:electronic-arts'],
  'game:deus-ex': ['studio:eidos'],
  'game:dishonored': ['studio:bethesda-softworks'],
  'game:dishonored-2': ['studio:bethesda-softworks'],
  'game:prey-2017': ['studio:bethesda-softworks'],
  'game:hitman-blood-money': ['studio:eidos'],
  'game:hitman-2016': ['studio:square-enix'],
  'game:metal-gear-solid-v': ['studio:konami'],
  'game:alien-isolation': ['studio:sega'],
  'game:hollow-knight': ['studio:team-cherry'],
  'game:celeste': ['studio:matt-makes-games'],
  'game:dead-cells': ['studio:motion-twin'],
  'game:gta-v': ['studio:rockstar-games'],
  'game:red-dead-redemption-2': ['studio:rockstar-games'],
  'game:minecraft': ['studio:mojang']
}, 'PUBLISHED_BY');

/* credits: people */
pairs({
  'game:virtua-fighter-4': ['person:yu-suzuki'],
  'game:deus-ex': ['person:warren-spector'],
  'game:dishonored-2': ['person:harvey-smith'],
  'game:demon-souls': ['person:hidetaka-miyazaki'],
  'game:dark-souls': ['person:hidetaka-miyazaki'],
  'game:bloodborne': ['person:hidetaka-miyazaki'],
  'game:sekiro': ['person:hidetaka-miyazaki'],
  'game:elden-ring': ['person:hidetaka-miyazaki'],
  'game:skyrim': ['person:todd-howard'],
  'game:fallout-new-vegas': ['person:josh-sawyer'],
  'game:zelda-botw': ['person:hidemaro-fujibayashi'],
  'game:metal-gear-solid-v': ['person:hideo-kojima']
}, 'DIRECTED_BY');

pairs({
  'game:deus-ex': ['person:harvey-smith'],
  'game:dishonored': ['person:harvey-smith'],
  'game:celeste': ['person:matt-thorson', 'person:noel-berry']
}, 'DESIGNED_BY');

pairs({
  'person:katsuhiro-harada': ['game:tekken-7', 'game:tekken-8'],
  'person:ed-boon': ['game:mortal-kombat-ii', 'game:mortal-kombat-11'],
  'person:john-tobias': ['game:mortal-kombat-ii'],
  'person:john-carmack': ['game:quake', 'game:quake-iii-arena'],
  'person:ken-levine': ['game:system-shock-2']
}, 'WORKED_ON');
ed('person:yu-suzuki', 'WORKED_ON', 'game:virtua-fighter-5', {
  band: 'moderate', native: 'probable', status: 'unreviewed'
});

/* affiliations / lineage between people and studios */
pairs({
  'person:john-romero': ['studio:id-software'],
  'person:john-carmack': ['studio:id-software'],
  'person:swen-vincke': ['studio:larian'],
  'person:sid-meier': ['studio:firaxis'],
  'person:markus-persson': ['studio:mojang'],
  'person:matt-thorson': ['studio:matt-makes-games']
}, 'FOUNDED');

ed('person:john-romero', 'LEFT_TO_FOUND', 'studio:ion-storm', {
  ev: 'John Romero left id Software in 1997 to co-found Ion Storm'
});
ed('person:ken-levine', 'LEFT_TO_FOUND', 'studio:irrational', {
  ev: 'Ken Levine founded Irrational Games in 1997 after working at Looking Glass Studios'
});
ed('person:feargus-urquhart', 'LEFT_TO_FOUND', 'studio:obsidian', {
  ev: 'Feargus Urquhart co-founded Obsidian Entertainment in 2003 after Interplay / Black Isle'
});
ed('person:hideo-kojima', 'LEFT_TO_FOUND', 'studio:kojima-productions', {
  ev: 'Hideo Kojima established Kojima Productions as an independent studio in 2015 after leaving Konami'
});

pairs({
  'person:yu-suzuki': ['studio:seg-am2'],
  'person:katsuhiro-harada': ['studio:bandai-namco'],
  'person:ed-boon': ['studio:netherrealm'],
  'person:hidetaka-miyazaki': ['studio:from-software'],
  'person:warren-spector': ['studio:ion-storm'],
  'person:harvey-smith': ['studio:arkane'],
  'person:todd-howard': ['studio:bethesda-game-studios'],
  'person:josh-sawyer': ['studio:obsidian'],
  'person:hideo-kojima': ['studio:konami']
}, 'MEMBER_OF');
ed('person:feargus-urquhart', 'MEMBER_OF', 'studio:black-isle', {
  band: 'moderate', native: 'probable', status: 'unreviewed',
  ev: 'Led Black Isle Studios at Interplay before co-founding Obsidian', kind: 'direct'
});
ed('person:ken-levine', 'MEMBER_OF', 'studio:looking-glass', {
  band: 'moderate', native: 'probable', status: 'unreviewed',
  ev: 'Worked on System Shock at Looking Glass before founding Irrational', kind: 'direct'
});
edges[edges.length - 1].notes = 'tenure ended in 1997';

/* studio + franchise lineage */
ed('studio:bandai-namco', 'STUDIO_DESCENDANT', 'studio:namco', {
  ev: 'Namco and Bandai merged in 2005 to form Bandai Namco'
});
ed('studio:netherrealm', 'STUDIO_DESCENDANT', 'studio:midway', {
  ev: 'NetherRealm Studios grew out of the former Midway Games team after Warner Bros. acquired the studio in 2009'
});
ed('franchise:persona', 'FRANCHISE_DESCENDANT', 'franchise:shin-megami-tensei', {
  ev: 'Persona began as a Shin Megami Tensei spin-off series'
});

/* franchise membership */
pairs({
  'game:virtua-fighter-5': ['franchise:virtua-fighter'],
  'game:virtua-fighter-4': ['franchise:virtua-fighter'],
  'game:virtua-fighter-2': ['franchise:virtua-fighter'],
  'game:tekken-8': ['franchise:tekken'], 'game:tekken-7': ['franchise:tekken'],
  'game:tekken-3': ['franchise:tekken'],
  'game:street-fighter-6': ['franchise:street-fighter'],
  'game:street-fighter-4': ['franchise:street-fighter'],
  'game:street-fighter-ii': ['franchise:street-fighter'],
  'game:mortal-kombat-11': ['franchise:mortal-kombat'],
  'game:mortal-kombat-ii': ['franchise:mortal-kombat'],
  'game:dead-or-alive-5': ['franchise:dead-or-alive'],
  'game:guilty-gear-xrd': ['franchise:guilty-gear'],
  'game:smash-ultimate': ['franchise:super-smash-bros'],
  'game:smash-melee': ['franchise:super-smash-bros'],
  'game:halo-ce': ['franchise:halo'], 'game:halo-3': ['franchise:halo'],
  'game:halo-infinite': ['franchise:halo'],
  'game:gears-of-war': ['franchise:gears-of-war'],
  'game:gears-of-war-3': ['franchise:gears-of-war'],
  'game:gears-5': ['franchise:gears-of-war'],
  'game:gears-of-war-e-day': ['franchise:gears-of-war'],
  'game:doom-2016': ['franchise:doom'], 'game:doom-eternal': ['franchise:doom'],
  'game:quake': ['franchise:quake'], 'game:quake-iii-arena': ['franchise:quake'],
  'game:unreal-tournament': ['franchise:unreal'],
  'game:left-4-dead': ['franchise:left-4-dead'], 'game:left-4-dead-2': ['franchise:left-4-dead'],
  'game:counter-strike-2': ['franchise:counter-strike'],
  'game:call-of-duty-4': ['franchise:call-of-duty'],
  'game:battlefield-1942': ['franchise:battlefield'],
  'game:destiny': ['franchise:destiny'],
  'game:dark-souls': ['franchise:dark-souls'], 'game:dark-souls-2': ['franchise:dark-souls'],
  'game:dark-souls-3': ['franchise:dark-souls'],
  'game:demon-souls': ['franchise:demons-souls'],
  'game:elden-ring': ['franchise:elden-ring'],
  'game:zelda-botw': ['franchise:zelda'],
  'game:witcher-3': ['franchise:the-witcher'],
  'game:skyrim': ['franchise:the-elder-scrolls'],
  'game:fallout-new-vegas': ['franchise:fallout'],
  'game:baldurs-gate-3': ['franchise:baldurs-gate'],
  'game:persona-5': ['franchise:persona'],
  'game:starcraft': ['franchise:starcraft'],
  'game:age-of-empires-ii': ['franchise:age-of-empires'],
  'game:civilization-6': ['franchise:civilization'],
  'game:xcom-enemy-unknown': ['franchise:xcom'],
  'game:metal-gear-solid-v': ['franchise:metal-gear'],
  'game:hitman-blood-money': ['franchise:hitman'],
  'game:hitman-2016': ['franchise:hitman'],
  'game:thief-the-dark-project': ['franchise:thief'],
  'game:dishonored': ['franchise:dishonored'],
  'game:dishonored-2': ['franchise:dishonored'],
  'game:deus-ex': ['franchise:deus-ex'],
  'game:gta-v': ['franchise:grand-theft-auto'],
  'game:red-dead-redemption-2': ['franchise:red-dead'],
  'game:minecraft': ['franchise:minecraft']
}, 'MEMBER_OF');

/* franchise lineage between games (later -> earlier) */
pairs([
  ['game:tekken-8', 'game:tekken-7'],
  ['game:tekken-7', 'game:tekken-3'],
  ['game:street-fighter-6', 'game:street-fighter-4'],
  ['game:street-fighter-4', 'game:street-fighter-ii'],
  ['game:mortal-kombat-11', 'game:mortal-kombat-ii'],
  ['game:halo-3', 'game:halo-ce'],
  ['game:halo-infinite', 'game:halo-3'],
  ['game:gears-of-war-3', 'game:gears-of-war'],
  ['game:gears-5', 'game:gears-of-war-3'],
  ['game:left-4-dead-2', 'game:left-4-dead'],
  ['game:dark-souls-2', 'game:dark-souls'],
  ['game:dark-souls-3', 'game:dark-souls-2'],
  ['game:dishonored-2', 'game:dishonored'],
  ['game:doom-eternal', 'game:doom-2016'],
  ['game:quake-iii-arena', 'game:quake'],
  ['game:virtua-fighter-5', 'game:virtua-fighter-4'],
  ['game:virtua-fighter-4', 'game:virtua-fighter-2'],
  ['game:smash-ultimate', 'game:smash-melee']
], 'SEQUEL_OF');
edges.filter((e) => e.relationship_type === 'SEQUEL_OF').forEach((e) => {
  const gapped = [
    'game:tekken-7>game:tekken-3', 'game:street-fighter-6>game:street-fighter-4',
    'game:street-fighter-4>game:street-fighter-ii', 'game:mortal-kombat-11>game:mortal-kombat-ii',
    'game:halo-3>game:halo-ce', 'game:halo-infinite>game:halo-3',
    'game:gears-5>game:gears-of-war-3', 'game:quake-iii-arena>game:quake',
    'game:virtua-fighter-4>game:virtua-fighter-2', 'game:smash-ultimate>game:smash-melee'
  ];
  if (gapped.includes(`${e.source}>${e.target}`)) e.notes = GAP;
});

/* verified prequel — story chronology, not release order */
ed('game:gears-of-war-e-day', 'PREQUEL_OF', 'game:gears-of-war', {
  ev: 'E-Day is set 14 years before the first Gears of War, during the Locust emergence on Sera (The Coalition / Xbox, announced release date October 6, 2026)',
  kind: 'direct'
});

/* analogous design — documented spiritual successors (never shown as lineage) */
ed('game:dark-souls', 'SPIRITUAL_SUCCESSOR', 'game:demon-souls', {
  ev: 'FromSoftware documented Dark Souls as continuing the design of Demon\u2019s Souls', kind: 'direct'
});
ed('game:dishonored', 'SPIRITUAL_SUCCESSOR', 'game:thief-the-dark-project', {
  ev: 'Arkane cited the Thief series as a touchstone for Dishonored; co-director Harvey Smith worked on immersive sims at Looking Glass / Ion Storm', kind: 'direct'
});
ed('game:prey-2017', 'SPIRITUAL_SUCCESSOR', 'game:system-shock-2', {
  ev: 'Arkane\u2019s Prey is widely documented as continuing System Shock 2\u2019s immersive-sim design', kind: 'direct'
});
soft('game:prey-2017', 'SPIRITUAL_SUCCESSOR', 'game:deus-ex',
  'Prey shares Deus Ex\u2019s player-driven problem solving; both sit in the immersive-sim lineage (Harvey Smith worked on Deus Ex and later directed Prey)', { band: 'moderate' });

/* documented influence */
ed('game:street-fighter-4', 'INFLUENCED_BY', 'game:street-fighter-ii', {
  ev: 'Street Fighter IV was documented as a deliberate return to Street Fighter II\u2019s foundations', kind: 'direct'
});
ed('game:quake-iii-arena', 'INFLUENCED_BY', 'game:quake', {
  ev: 'id Software built Quake III Arena on the arena-deathmatch design and tech established by Quake', kind: 'direct'
});
soft('game:unreal-tournament', 'INFLUENCED_BY', 'game:quake',
  'Unreal Tournament followed the arena-FPS conventions Quake established', { band: 'moderate' });
soft('game:elden-ring', 'INFLUENCED_BY', 'game:zelda-botw',
  'Elden Ring\u2019s open-world structure is widely compared to Breath of the Wild; FromSoftware has discussed the game\u2019s impact', { band: 'moderate' });

/* mechanical similarity — explicitly NOT lineage */
soft('game:virtua-fighter-5', 'MECHANICALLY_RELATED', 'game:tekken-7',
  '3D one-on-one fighters built around spacing, guard and punishment');
soft('game:mortal-kombat-ii', 'MECHANICALLY_RELATED', 'game:street-fighter-ii',
  '2D one-on-one fighting games that defined the versus-fighter template');
soft('game:valorant', 'MECHANICALLY_RELATED', 'game:counter-strike-2',
  'Round-based tactical shooters with an economy, lethal headshots and utility usage');
soft('game:overwatch-2', 'MECHANICALLY_RELATED', 'game:team-fortress-2',
  'Class-based team shooters built around roles and coordinated pushes');
soft('game:dead-cells', 'MECHANICALLY_RELATED', 'game:hollow-knight',
  'Side-scrolling action-platformers with exploration, permanent upgrades and demanding combat');
soft('game:deus-ex', 'MECHANICALLY_RELATED', 'game:system-shock-2',
  'First-person immersive sims built on player-driven problem solving');

/* mechanics used — names must match the taste signal vocabulary */
const uses = {
  'game:virtua-fighter-5': ['spacing', 'counterplay', 'pvp', 'movement'],
  'game:virtua-fighter-4': ['spacing', 'counterplay', 'pvp'],
  'game:virtua-fighter-2': ['spacing', 'pvp', 'combat'],
  'game:tekken-8': ['combat', 'spacing', 'counterplay', 'pvp', 'progression'],
  'game:tekken-7': ['spacing', 'counterplay', 'pvp'],
  'game:tekken-3': ['pvp', 'combat', 'movement'],
  'game:street-fighter-6': ['spacing', 'parry', 'counterplay', 'pvp'],
  'game:street-fighter-4': ['spacing', 'reversal', 'pvp'],
  'game:street-fighter-ii': ['spacing', 'pvp', 'combat'],
  'game:dead-or-alive-5': ['pvp', 'counterplay', 'parry'],
  'game:mortal-kombat-11': ['combat', 'pvp', 'progression'],
  'game:mortal-kombat-ii': ['pvp', 'combat'],
  'game:guilty-gear-xrd': ['pvp', 'combat'],
  'game:smash-ultimate': ['pvp', 'movement', 'co-op'],
  'game:smash-melee': ['pvp', 'movement', 'counterplay'],
  'game:halo-ce': ['combat', 'movement', 'co-op'],
  'game:halo-3': ['combat', 'co-op', 'pvp'],
  'game:halo-infinite': ['combat', 'movement', 'pvp'],
  'game:destiny': ['progression', 'loot', 'co-op', 'combat'],
  'game:gears-of-war': ['combat', 'co-op', 'pvp'],
  'game:gears-of-war-3': ['combat', 'co-op', 'progression'],
  'game:gears-5': ['combat', 'co-op', 'progression'],
  'game:gears-of-war-e-day': ['combat', 'co-op', 'progression'],
  'game:doom-2016': ['combat', 'movement', 'boss-encounters'],
  'game:doom-eternal': ['combat', 'movement', 'boss-encounters', 'progression'],
  'game:quake': ['movement', 'pvp', 'arena-combat'],
  'game:quake-iii-arena': ['movement', 'pvp', 'arena-combat'],
  'game:unreal-tournament': ['pvp', 'arena-combat', 'movement'],
  'game:left-4-dead': ['co-op', 'combat', 'pacing'],
  'game:left-4-dead-2': ['co-op', 'combat', 'pacing'],
  'game:team-fortress-2': ['class-based-play', 'role-identity', 'pvp', 'team-coordination'],
  'game:overwatch-2': ['class-based-play', 'role-identity', 'team-coordination', 'ability-synergy', 'cooldown-combat'],
  'game:valorant': ['class-based-play', 'team-coordination', 'pvp', 'counterplay'],
  'game:counter-strike-2': ['pvp', 'team-coordination', 'counterplay'],
  'game:call-of-duty-4': ['pvp', 'combat', 'progression'],
  'game:battlefield-1942': ['pvp', 'team-coordination', 'combat'],
  'game:demon-souls': ['difficulty', 'boss-encounters', 'combat', 'exploration', 'soulslike'],
  'game:dark-souls': ['difficulty', 'boss-encounters', 'combat', 'exploration', 'atmosphere', 'soulslike'],
  'game:dark-souls-2': ['difficulty', 'boss-encounters', 'combat', 'build-variety', 'soulslike'],
  'game:dark-souls-3': ['difficulty', 'boss-encounters', 'combat', 'counterplay', 'soulslike'],
  'game:elden-ring': ['difficulty', 'boss-encounters', 'exploration', 'build-variety', 'atmosphere', 'soulslike'],
  'game:bloodborne': ['difficulty', 'boss-encounters', 'combat', 'atmosphere', 'soulslike'],
  'game:sekiro': ['difficulty', 'boss-encounters', 'parry', 'counterplay'],
  'game:zelda-botw': ['exploration', 'traversal', 'atmosphere', 'experimentation'],
  'game:witcher-3': ['exploration', 'atmosphere', 'progression'],
  'game:skyrim': ['exploration', 'build-variety', 'atmosphere', 'progression'],
  'game:fallout-new-vegas': ['exploration', 'build-variety', 'experimentation', 'progression'],
  'game:baldurs-gate-3': ['build-variety', 'class-based-play', 'experimentation', 'role-identity'],
  'game:persona-5': ['progression', 'boss-encounters', 'atmosphere'],
  'game:starcraft': ['pvp', 'team-coordination', 'progression'],
  'game:age-of-empires-ii': ['pvp', 'team-coordination'],
  'game:civilization-6': ['pacing', 'experimentation', 'progression'],
  'game:xcom-enemy-unknown': ['difficulty', 'build-variety', 'counterplay'],
  'game:hades': ['ability-synergy', 'progression', 'combat', 'roguelike'],
  'game:slay-the-spire': ['deck-building', 'roguelike', 'experimentation'],
  'game:thief-the-dark-project': ['stealth', 'atmosphere', 'exploration', 'possession'],
  'game:system-shock-2': ['stealth', 'atmosphere', 'experimentation', 'build-variety'],
  'game:deus-ex': ['experimentation', 'build-variety', 'stealth', 'counterplay'],
  'game:dishonored': ['stealth', 'traversal', 'experimentation', 'build-variety'],
  'game:dishonored-2': ['stealth', 'traversal', 'experimentation', 'build-variety'],
  'game:prey-2017': ['experimentation', 'atmosphere', 'possession', 'build-variety'],
  'game:hitman-blood-money': ['stealth', 'experimentation', 'exploration'],
  'game:hitman-2016': ['stealth', 'experimentation', 'exploration'],
  'game:metal-gear-solid-v': ['stealth', 'experimentation', 'exploration'],
  'game:alien-isolation': ['stealth', 'atmosphere', 'pacing'],
  'game:hollow-knight': ['exploration', 'atmosphere', 'difficulty', 'traversal'],
  'game:celeste': ['movement', 'difficulty'],
  'game:dead-cells': ['roguelike', 'combat', 'movement'],
  'game:gta-v': ['exploration', 'combat', 'pvp'],
  'game:red-dead-redemption-2': ['exploration', 'atmosphere'],
  'game:minecraft': ['experimentation', 'exploration', 'co-op', 'destructibility']
};
const mechanicId = Object.fromEntries(mechanics.map(([id, name]) => [name, id]));
mechanics.forEach(([id, name]) => { mechanicId[id.replace(/^mechanic:/, '')] = id; });
Object.entries(uses).forEach(([gameId, names]) => {
  names.forEach((name) => {
    if (!mechanicId[name]) throw new Error(`unknown mechanic name "${name}" for ${gameId}`);
    ed(gameId, 'USES_MECHANIC', mechanicId[name], { status: 'unreviewed', band: 'moderate', native: 'probable' });
  });
});

/* availability — only confident platform claims */
const on = {
  'game:virtua-fighter-5': ['arcade', 'playstation-3', 'xbox-360'],
  'game:virtua-fighter-4': ['arcade', 'playstation-2'],
  'game:virtua-fighter-2': ['arcade'],
  'game:tekken-8': ['pc', 'playstation-5', 'xbox-series'],
  'game:tekken-7': ['pc', 'playstation-4', 'xbox-one'],
  'game:tekken-3': ['playstation', 'arcade'],
  'game:street-fighter-6': ['pc', 'playstation-5', 'xbox-series'],
  'game:street-fighter-4': ['pc', 'playstation-3', 'xbox-360'],
  'game:street-fighter-ii': ['arcade'],
  'game:dead-or-alive-5': ['playstation-3', 'xbox-360'],
  'game:mortal-kombat-11': ['pc', 'playstation-4', 'xbox-one', 'nintendo-switch'],
  'game:mortal-kombat-ii': ['arcade'],
  'game:guilty-gear-xrd': ['playstation-4', 'pc'],
  'game:smash-ultimate': ['nintendo-switch'],
  'game:smash-melee': ['gamecube'],
  'game:halo-ce': ['pc', 'xbox-one'],
  'game:halo-3': ['pc', 'xbox-one'],
  'game:halo-infinite': ['pc', 'xbox-one', 'xbox-series'],
  'game:destiny': ['playstation-4', 'xbox-one'],
  'game:gears-of-war': ['pc', 'xbox-360'],
  'game:gears-of-war-3': ['xbox-360'],
  'game:gears-5': ['pc', 'xbox-one', 'xbox-series'],
  'game:gears-of-war-e-day': ['pc', 'xbox-series'],
  'game:doom-2016': ['pc', 'playstation-4', 'xbox-one'],
  'game:doom-eternal': ['pc', 'playstation-4', 'xbox-one'],
  'game:quake': ['pc'],
  'game:quake-iii-arena': ['pc'],
  'game:unreal-tournament': ['pc'],
  'game:left-4-dead': ['pc', 'xbox-360'],
  'game:left-4-dead-2': ['pc', 'xbox-360'],
  'game:team-fortress-2': ['pc'],
  'game:overwatch-2': ['pc', 'playstation-4', 'xbox-one', 'nintendo-switch'],
  'game:valorant': ['pc'],
  'game:counter-strike-2': ['pc'],
  'game:call-of-duty-4': ['pc', 'playstation-3', 'xbox-360'],
  'game:battlefield-1942': ['pc'],
  'game:demon-souls': ['playstation-3'],
  'game:dark-souls': ['pc', 'playstation-3', 'xbox-360'],
  'game:dark-souls-2': ['pc', 'playstation-3', 'xbox-360', 'playstation-4'],
  'game:dark-souls-3': ['pc', 'playstation-4', 'xbox-one'],
  'game:elden-ring': ['pc', 'playstation-4', 'playstation-5', 'xbox-one', 'xbox-series'],
  'game:bloodborne': ['playstation-4'],
  'game:sekiro': ['pc', 'playstation-4', 'xbox-one'],
  'game:zelda-botw': ['nintendo-switch'],
  'game:witcher-3': ['pc', 'playstation-4', 'xbox-one', 'nintendo-switch'],
  'game:skyrim': ['pc', 'playstation-4', 'xbox-one'],
  'game:fallout-new-vegas': ['pc', 'playstation-3', 'xbox-360'],
  'game:baldurs-gate-3': ['pc', 'playstation-5', 'xbox-series'],
  'game:persona-5': ['playstation-3', 'playstation-4'],
  'game:starcraft': ['pc'],
  'game:age-of-empires-ii': ['pc'],
  'game:civilization-6': ['pc', 'nintendo-switch'],
  'game:xcom-enemy-unknown': ['pc', 'playstation-3', 'xbox-360'],
  'game:hades': ['pc', 'nintendo-switch', 'playstation-5'],
  'game:slay-the-spire': ['pc', 'playstation-4', 'nintendo-switch'],
  'game:thief-the-dark-project': ['pc'],
  'game:system-shock-2': ['pc'],
  'game:deus-ex': ['pc'],
  'game:dishonored': ['pc', 'playstation-3', 'xbox-360'],
  'game:dishonored-2': ['pc', 'playstation-4', 'xbox-one'],
  'game:prey-2017': ['pc', 'playstation-4', 'xbox-one'],
  'game:hitman-blood-money': ['pc', 'playstation-3', 'xbox-360'],
  'game:hitman-2016': ['pc', 'playstation-4', 'xbox-one'],
  'game:metal-gear-solid-v': ['pc', 'playstation-4', 'xbox-one'],
  'game:alien-isolation': ['pc', 'playstation-4', 'xbox-one'],
  'game:hollow-knight': ['pc', 'nintendo-switch', 'playstation-4'],
  'game:celeste': ['pc', 'nintendo-switch', 'playstation-4'],
  'game:dead-cells': ['pc', 'nintendo-switch', 'playstation-4'],
  'game:gta-v': ['pc', 'playstation-4', 'xbox-one'],
  'game:red-dead-redemption-2': ['pc', 'playstation-4', 'xbox-one'],
  'game:minecraft': ['pc', 'nintendo-switch', 'playstation-4', 'xbox-one']
};
const platformId = Object.fromEntries(platforms.map(([id, name]) => [name, id]));
platforms.forEach(([id, name]) => { platformId[id.replace(/^platform:/, '')] = id; });
Object.entries(on).forEach(([gameId, names]) => {
  names.forEach((name) => {
    if (!platformId[name]) throw new Error(`unknown platform "${name}" for ${gameId}`);
    ed(gameId, 'AVAILABLE_ON', platformId[name]);
  });
});

/* -------------------------------- output --------------------------------- */

const graph = { nodes, edges };
const json = JSON.stringify(graph, null, 2) + '\n';

mkdirSync(join(root, 'assets', 'data'), { recursive: true });
mkdirSync(join(root, 'assets', 'js', 'data'), { recursive: true });
writeFileSync(join(root, 'assets', 'data', 'seed-graph.json'), json);
writeFileSync(
  join(root, 'assets', 'js', 'data', 'seed-graph.js'),
  '/* GENERATED FILE — do not edit by hand.\n' +
  ' * Source: tools/build-data.mjs  (regenerate: node tools/build-data.mjs)\n' +
  ' * Validated by branch-schema: npm run validate-game */\n' +
  '(function (root) { root.GOS_SEED_GRAPH = ' + JSON.stringify(graph) + ';\n' +
  '})(typeof window !== "undefined" ? window : globalThis);\n'
);

const counts = {};
nodes.forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
edges.forEach((e) => { counts[e.relationship_type] = (counts[e.relationship_type] || 0) + 1; });
console.log('seed graph:', nodes.length, 'nodes,', edges.length, 'edges');
console.log(Object.entries(counts).sort().map(([k, v]) => `${k}=${v}`).join('  '));
