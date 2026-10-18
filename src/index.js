const fs = require('fs');
const hash = require('./hash');
const needle = require('needle');
const util = require('util');

const commit = true;

const readFile = util.promisify(fs.readFile);
const access = util.promisify(fs.access);
const writeFile = util.promisify(fs.writeFile);
const origin = 'https://undercards.net';
const [from, lang] = process.argv.slice(2);

loadChanges(from, lang).catch((e) => {
  console.error(e);
  process.exit(1);
});

async function loadChanges(from = `${origin}/card-data/latest.json`, lang = `${origin}/translation/en.json`) {
  const language = lang.startsWith('https://') ? needle(lang).then(res => res.body) : readFile(lang);
  const allCards = fetchCards(from);
  return allCards.then(({cards} = {}) => {
    // TODO: compare hash from latest.json, only process if new things
    // const now = hash(cards);
    // console.log(now);
    if (typeof cards === 'string') return JSON.parse(cards);
    if (Array.isArray(cards)) return cards;
  }).then((cards) => language.then(parseJson).then((lang) => ({cards, lang})).catch((e) => {
    console.error(e);
    return {cards};
  })).then(({
    cards = [],
    lang = {},
  } = {}) => {
    if (!cards.length) {
      throw new Error('Cards not found');
    }
    if (!Object.keys(lang).length) {
      console.warn('Translations not found');
    }
    const promises = cards.map((card) => {
      sortTribes(card);
      card.description = (lang[`card-${card.id}`] || '').trim();
      const path = `./cards/${card.id}.json`;
      return access(path, fs.constants.F_OK | fs.constants.W_OK)
      .then(() => readFile(path).then(JSON.parse))
      .catch((e) => {
        if (e.code !== 'ENOENT') {
          throw new Error('Not writable'); // Shouldn't ever happen, really.
        }
        return false;
      }).then(({card: old} = {}) => {
        const diffs = [];
        if (old) {
          sortTribes(old);
          Object.keys(card).forEach((key) => {
            const prev = old[key];
            const now = card[key];
            if (!equality(prev, now)) {
              // changes.push(`${key}: ${prev !== undefined ? `${prev} ->` : '(new)'} ${now}`);
              diffs.push({ key, now, prev });
            }
            delete old[key];
          });
          Object.keys(old).forEach((key) => {
            diffs.push({ key, prev: old[key] });
          });
        } else {
          diffs.push({ key: 'new', now: true });
        }
        return { 
          card,
          diffs: {
            added: diffs.filter(d => d.prev === undefined).reduce((cur, {key, now}) => (cur[key] = now, cur), {}),
            removed: diffs.filter(d => d.now === undefined).reduce((cur, {key, prev}) => (cur[key] = prev, cur), {}),
            changed: diffs.filter(d => ![d.prev, d.now].includes(undefined)).reduce((cur, {key, now, prev}) => (cur[key] = {now, prev}, cur), {}),
          },
          changes: diffs.length,
        };
      }).then((data) => commit ? writeFile(path, JSON.stringify(data, replacer, 2)).then(() => data) : data);
    });

    return Promise.all(promises).then((data) => {
      const diffs = data.reduce((cur, {card, diffs}) => (cur[card.id] = diffs, cur), {});
      const count = data.reduce((cur, {changes}) => cur + changes, 0);
      console.log(count, 'changes.');
      return writeFile('latestDiffs.json', JSON.stringify(diffs, replacer, 2));
    });
  });
}

function parseJson(data) {
  return typeof data === 'object' && !Buffer.isBuffer(data) ? data : JSON.parse(data);
}

async function fetchCards(from) {
  if (!from.startsWith('https://')) return readFile(from).then(JSON.parse);
  const { body } = await needle('get', from);
  if (!body.url) return body;
  return needle('get', `${origin}${body.url}`).then(res => res.body);
}

function sortTribes(card) {
  if (Array.isArray(card.tribes)) card.tribes.sort();
}

function equality(a, b) {
  return a === b || arrayEquals(a, b) || objectEquals(a, b);
}

function arrayEquals(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length &&
    a.every((val, i) => equality(val, b[i]));
}

function objectEquals(a, b) {
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((key) => equality(a[key], b[key]));
}

function replacer(key, value) {
  if (key === 'changes') return undefined;
  return value;
}
