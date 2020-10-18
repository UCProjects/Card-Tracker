const fs = require('fs');
const hash = require('./hash');
const needle = require('needle');
const util = require('util');

const commit = true;

const readFile = util.promisify(fs.readFile);
const access = util.promisify(fs.access);
const writeFile = util.promisify(fs.writeFile);
const [from, lang] = process.argv.slice(2);

loadChanges(from, lang);

async function loadChanges(from = 'https://undercards.net/AllCards', lang = 'https://undercards.net/translation/en.json') {
  const language = lang.startsWith('https://') ? needle(lang).then(res => res.body) : readFile(lang).then(JSON.parse);''
  const allCards = from.startsWith('https://') ? needle(from).then(res => res.body) : readFile(from).then(JSON.parse);
  allCards.then(({cards} = {}) => {
    // TODO: compare hash from latest.json, only process if new things
    // const now = hash(cards);
    // console.log(now);
    if (typeof cards === 'string') return JSON.parse(cards);
    if (Array.isArray(cards)) return cards;
  }).then((cards) => language.then((lang) => ({cards, lang})).catch(() => ({cards}))).then(({
    cards = [],
    lang = {},
  } = {}) => {
    if (!cards.length) {
      console.log('Cards not found');
      return;
    }
    const promises = cards.map((card) => {
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
          Object.keys(card).forEach((key) => {
            const prev = old[key];
            const now = card[key];
            if (now !== prev && (!Array.isArray(now) || prev === undefined || now.length !== prev.length)) {
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
  }).catch(console.error);
}

function replacer(key, value) {
  if (key === 'changes') return undefined;
  return value;
}
