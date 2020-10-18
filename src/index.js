const fs = require('fs');
const hash = require('./hash');
const needle = require('needle');
const util = require('util');


const readFile = util.promisify(fs.readFile);
const access = util.promisify(fs.access);
const writeFile = util.promisify(fs.writeFile);
const [from, lang] = process.argv.slice(2);

loadChanges(from, lang);

async function loadChanges(from = 'https://undercards.net/AllCards', lang = 'https://undercards.net/translation/en.json') {
  const language = lang.startsWith('https://') ? needle(lang).then(res => res.body) : readFile(lang).then(JSON.parse);''
  const allCards = from.startsWith('https://') ? needle(from).then(res => res.body) : readFile(from).then(JSON.parse);
  allCards.then(({cards} = {}) => {
    if (typeof cards === 'string') {
      // TODO: compare hash from latest.json, only process if new things
      const now = hash(cards);
      console.log(now);
      return JSON.parse(cards);
    }
    if (Array.isArray(cards)) {
      console.log('Existing Array');
      return cards;
    }
  }).then((cards) => language.then((lang) => ({cards, lang})).catch(() => ({cards}))).then(({
    cards = [],
    lang = {},
  } = {}) => {
    if (!cards.length) return;
    // TODO: get descriptions for description diffs?
    const promises = cards.map((card) => {
      card.description = (lang[`card-${card.id}`] || '').trim();
      const path = `./cards/${card.id}.json`;
      return access(path, fs.constants.F_OK | fs.constants.W_OK)
      .then(() => readFile(path))
      .catch((e) => {
        if (e.code !== 'ENOENT') {
          throw new Error('Not writable'); // Shouldn't ever happen, really.
        }
        return false;
      }).then((old) => {
        const diffs = [];
        if (old) {
          Object.keys(card).forEach((key) => {
            const prev = old[key];
            const now = card[key];
            if (now !== prev) {
              // changes.push(`${key}: ${prev !== undefined ? `${prev} ->` : '(new)'} ${now}`);
              diffs.push({ key, now, prev });
            }
            delete old[key];
          });
          Object.keys(old).forEach((key) => {
            diffs.push({ key, prev: old[key] });
          });
          if (!diffs.length) {
            // diffs.push('None');
          }
        } else {
          diffs.push('New');
        }
        return { card, diffs };
      }).then((data) => writeFile(path, JSON.stringify(data, undefined, 2)).then(() => data));
    });

    return Promise.all(promises).then((data) => {
      const diffs = data.reduce((cur, {card, diffs}) => (cur[card.id] = diffs, cur), {});
      return writeFile('latestDiffs.json', JSON.stringify(diffs, undefined, 2));
    });
  }).catch(console.error);
}