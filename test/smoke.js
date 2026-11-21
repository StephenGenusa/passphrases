'use strict';

// End-to-end check of the real app: start it, drive the page, and compare what
// it shows against the wordlist files. Run with `npm test`. It exits 0 when
// every check passes. Set SMOKE_SCREENSHOT to a .png path to save a picture of
// the window in every color style.

const { app, shell } = require('electron');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// PASSPHRASES_APP points the test at a built copy of the app instead of src/
const SRC = process.env.PASSPHRASES_APP || path.join(__dirname, '..', 'src');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'passphrases-test-'));
app.setPath('userData', userData);

// record links instead of opening the browser
const opened = [];
shell.openExternal = function (url) {
  opened.push(url);
  return Promise.resolve();
};

const consoleProblems = [];

function words(id) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(SRC, 'wordlists', 'manifest.json'), 'utf8'));
  const entry = manifest.lists.find((list) => list.id === id);
  const lines = fs.readFileSync(path.join(SRC, 'wordlists', entry.file), 'utf8').split('\n');
  lines.pop();
  return { entry: entry, set: new Set(lines), count: manifest.lists.length };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(win) {
  const page = (code) => win.webContents.executeJavaScript(code, true);
  const q = (selector) => 'document.querySelector(' + JSON.stringify(selector) + ')';
  const text = (selector) => page(q(selector) + '.textContent');
  const value = (selector) => page(q(selector) + '.value');
  const visible = (selector) => page(q(selector) + '.offsetParent !== null');
  const click = (selector) => page(q(selector) + '.click(); null');
  // set a field and fire the event the app listens for
  const set = (selector, newValue, event) => page(
    '(function(){ var field = ' + q(selector) + '; field.value = ' + JSON.stringify(newValue) +
    '; field.dispatchEvent(new Event(' + JSON.stringify(event) + ', { bubbles: true })); })(); null');
  const waitFor = async (code, what) => {
    for (let i = 0; i < 100; i++) {
      if (await page(code)) return;
      await sleep(50);
    }
    throw new Error('Timed out waiting for ' + what);
  };
  const waitForText = (selector, start, what) =>
    waitFor(q(selector) + '.textContent.indexOf(' + JSON.stringify(start) + ') == 0', what);

  // the page is sandboxed and loads no library
  assert.strictEqual(await page('typeof require'), 'undefined', 'page has no require');
  assert.strictEqual(await page('typeof process'), 'undefined', 'page has no process');
  assert.strictEqual(await page('typeof jQuery'), 'undefined', 'page has no jQuery');
  assert.deepStrictEqual(
    await page('Object.keys(window.passphrasesApp).sort()'),
    ['focusWindow', 'getWordlists', 'loadPrefs', 'readWordlist', 'savePrefs']);

  // ---- helpers that work out, independently of the app, what it should show
  const length = (s) => Array.from(s).length;
  const isAscii = (w) => /^[\x21-\x7e]+$/.test(w);
  const asciiWords = (list) => new Set(Array.from(list.set).filter(isAscii));
  // words that contain none of the characters in use as separators
  const without = (set, taken) => new Set(Array.from(set).filter((w) => !Array.from(taken).some((ch) => w.includes(ch))));
  const choose = (n, k) => { let r = 1n; for (let i = 1; i <= k; i++) r = r * BigInt(n - k + i) / BigInt(i); return r; };
  // ways to pick `count` words from a set whose letters total at most `letters`
  const waysWithin = (set, count, letters) => {
    const histogram = new Map();
    set.forEach((w) => histogram.set(length(w), (histogram.get(length(w)) || 0n) + 1n));
    let exact = new Map([[0, 1n]]);
    for (let i = 0; i < count; i++) {
      const next = new Map();
      exact.forEach((ways, total) => histogram.forEach((n, len) =>
        next.set(total + len, (next.get(total + len) || 0n) + ways * n)));
      exact = next;
    }
    let fitting = 0n;
    exact.forEach((ways, total) => { if (total <= letters) fitting += ways; });
    return fitting;
  };
  // ways to fill `slots` places with at least two digits and two of `marks` symbols
  const separatorWays = (slots, marks) => {
    let total = 0n;
    for (let d = 2; d <= slots - 2; d++) total += choose(slots, d) * 10n ** BigInt(d) * BigInt(marks) ** BigInt(slots - d);
    return total;
  };
  const bitsOf = (ways) => {
    const digits = ways.toString(2);
    return Math.round((Math.log2(parseInt(digits.slice(0, 53), 2)) + Math.max(0, digits.length - 53)) * 100) / 100;
  };
  const DEFAULT_SYMBOLS = '!@#$%^&*-_+=';
  // split a passphrase made with digits and symbols into words and separators
  const takeApart = (phrase, marks) => {
    const isSeparator = (ch) => /\d/.test(ch) || marks.includes(ch);
    const chars = Array.from(phrase);
    return {
      words: chars.map((ch) => (isSeparator(ch) ? ' ' : ch)).join('').trim().split(/ +/),
      digits: chars.filter((ch) => /\d/.test(ch)).length,
      marks: chars.filter((ch) => marks.includes(ch)).length
    };
  };
  const lower = (w) => w.charAt(0).toLowerCase() + w.substring(1);
  const check = (selector, on) => page('(function(){ var box = ' + q(selector) +
    '; if(box.checked != ' + on + ') box.click(); })(); null');
  const describes = (part, what) =>
    waitFor(q('.wordlist-description') + '.textContent.includes(' + JSON.stringify(part) + ')', what);

  // ---- the app starts on EFF Large
  await waitFor(q('.passphrase') + '.textContent != ""', 'the first passphrase');
  const eff = words('eff-large');
  const effAscii = asciiWords(eff);
  const row = (id) => '.lists-row input[value="' + id + '"]';
  assert.strictEqual(await text('.wordlists-summary'), 'EFF Large');
  assert.strictEqual(await page(q(row('eff-large')) + '.checked'), true);
  // "-" is one of the symbols, so the few hyphenated words of this list are
  // left out: a passphrase can then be read back in only one way
  const effUsable = without(effAscii, '0123456789' + DEFAULT_SYMBOLS);
  assert(effUsable.size < effAscii.size && effUsable.size > effAscii.size - 10);
  assert((await text('.wordlist-description')).includes(effUsable.size + ' words, '));
  for (let i = 0; i < 20; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    const parts = takeApart(sample, DEFAULT_SYMBOLS);
    assert.strictEqual(parts.words.length, 7, sample);
    parts.words.forEach((w) => assert(effUsable.has(lower(w)), w + ' is a usable EFF Large word: ' + sample));
    assert(length(sample) <= 96, sample);
  }
  assert((await text('.wordlist-description')).includes(
    bitsOf(waysWithin(effUsable, 7, 96 - 6) * separatorWays(6, 12) * 120n) + ' bits of entropy with 7 words'));
  // taking "-" out of the symbols brings the hyphenated words back
  await set('input.symbols', '!@#', 'input');
  await describes(effAscii.size + ' words, ', 'the hyphenated words again');
  await set('input.symbols', DEFAULT_SYMBOLS, 'input');
  await describes(effUsable.size + ' words, ', 'the default symbols again');

  // ---- the rest of the option checks use English Wiktionary, whose words
  // are letters only: seven words, capitals, numbers and symbols on, the
  // common symbols, ASCII words only, at most 96 characters
  const english = words('english-wiktionary');
  const englishAscii = asciiWords(english);
  await click(row('english-wiktionary'));
  await click(row('eff-large'));
  await describes(englishAscii.size + ' words, ', 'English Wiktionary');
  assert.strictEqual(await text('.wordlists-summary'), 'English Wiktionary');
  for (const id of ['#use-capitals', '#use-numbers', '#use-symbols', '#ascii-only']) {
    assert.strictEqual(await page(q(id) + '.checked'), true, id + ' is on by default');
  }
  assert.strictEqual(await value('input.symbols'), DEFAULT_SYMBOLS);
  assert.strictEqual(await page(q('input.max-length') + '.type'), 'number');
  assert.strictEqual(await value('input.max-length'), '96');
  assert.strictEqual(await value('select.words'), '7');

  // every passphrase has at least two capitals, two digits and two symbols
  for (let i = 0; i < 40; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    const parts = takeApart(sample, DEFAULT_SYMBOLS);
    assert.strictEqual(parts.words.length, 7, 'seven words: ' + sample);
    parts.words.forEach((w) => assert(englishAscii.has(lower(w)), w + ' is an ASCII word of the list: ' + sample));
    assert(parts.digits >= 2, 'at least two digits: ' + sample);
    assert(parts.marks >= 2, 'at least two symbols: ' + sample);
    assert.strictEqual(parts.digits + parts.marks, 6, 'one separator in each gap: ' + sample);
    assert(parts.words.filter((w) => w != lower(w)).length >= 2, 'at least two capitals: ' + sample);
    assert(length(sample) <= 96, 'fits in 96 characters: ' + sample);
    assert.strictEqual(await text('.passphrase-length'), length(sample) + ' characters');
  }

  // the entropy counts the words, the capitals and the separators
  let description = await text('.wordlist-description');
  assert(description.includes(englishAscii.size + ' words, '), description);
  const defaultWays = waysWithin(englishAscii, 7, 96 - 6) * separatorWays(6, 12) * (2n ** 7n - 7n - 1n);
  assert(description.includes(bitsOf(defaultWays) + ' bits of entropy with 7 words, at most 96 characters'), description);

  // nothing needs a scrollbar at the window's size
  const fitsWindow = () => page('document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth');
  assert.strictEqual(await fitsWindow(), true, 'the Generate tab fits the window');

  // the guess time is plain for a strong passphrase
  const guessTime = () => page('(function(){ var e = ' + q('.guess-time') +
    '; return { weak: e.classList.contains("weak"), weight: getComputedStyle(e).fontWeight,' +
    ' color: getComputedStyle(e).color, text: e.textContent }; })()');
  let time = await guessTime();
  assert.strictEqual(time.weak, false, 'the default is not flagged: ' + time.text);

  // ---- three words need extra separators on the end to reach two of each
  await set('select.words', '3', 'change');
  await describes('with 3 words', 'three words');
  for (let i = 0; i < 20; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    const parts = takeApart(sample, DEFAULT_SYMBOLS);
    assert.strictEqual(parts.words.length, 3, 'three words: ' + sample);
    assert(parts.digits >= 2 && parts.marks >= 2, 'two digits and two symbols: ' + sample);
    assert.strictEqual(parts.digits + parts.marks, 4, 'four separators: ' + sample);
    assert(parts.words.filter((w) => w != lower(w)).length >= 2, 'at least two capitals: ' + sample);
  }
  description = await text('.wordlist-description');
  assert(description.includes(bitsOf(waysWithin(englishAscii, 3, 96 - 4) * separatorWays(4, 12) * 4n) +
    ' bits of entropy with 3 words'), description);

  // ---- spaces are a choice of their own, offered only when neither numbers
  // nor symbols separate the words, and off unless asked for
  assert.strictEqual(await page(q('#use-spaces') + '.checked'), false, 'spaces are off by default');
  assert.strictEqual(await page(q('#use-spaces') + '.disabled'), true, 'spaces wait for numbers and symbols to be off');
  await check('#use-capitals', false);
  await check('#use-numbers', false);
  await check('#use-symbols', false);
  assert.strictEqual(await page(q('#use-spaces') + '.disabled'), false);
  await describes('Up to ' + bitsOf(waysWithin(englishAscii, 3, 96)) + ' bits', 'three words run together');
  let passphrase = await text('.passphrase');
  assert(/^[a-z]+$/.test(passphrase), 'no separators at all: ' + passphrase);
  // with spaces switched on, three plain words can be guessed in hours: that
  // is shown in bold red
  await check('#use-spaces', true);
  await describes(bitsOf(waysWithin(englishAscii, 3, 96 - 2)) + ' bits', 'three plain words');
  passphrase = await text('.passphrase');
  assert.strictEqual(passphrase.split(' ').length, 3, passphrase);
  passphrase.split(' ').forEach((w) => assert(englishAscii.has(w), w));
  time = await guessTime();
  assert(/ (hours|days) average/.test(time.text), time.text);
  assert.strictEqual(time.weak, true, 'three plain words are flagged: ' + time.text);
  assert.strictEqual(time.weight, '700');
  assert.strictEqual(time.color, 'rgb(204, 0, 0)');

  // ---- the symbol field decides which symbols are used
  await set('select.words', '5', 'change');
  await check('#use-symbols', true);
  await set('input.symbols', 'ab1 #!#', 'input');
  await describes(bitsOf(waysWithin(englishAscii, 5, 96 - 4) * 2n ** 4n) + ' bits', 'two symbols only');
  for (let i = 0; i < 10; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    assert.strictEqual(sample.replace(/[a-z]/g, '').replace(/[#!]/g, ''), '', 'only # and ! between words: ' + sample);
    assert.strictEqual(sample.replace(/[^#!]/g, '').length, 4, sample);
  }
  await page(q('input.symbols') + '.focus(); ' + q('input.symbols') + '.blur(); null');
  assert.strictEqual(await value('input.symbols'), '#!', 'letters, digits, spaces and repeats are dropped');
  // numbers only
  await check('#use-symbols', false);
  await check('#use-numbers', true);
  await describes(bitsOf(waysWithin(englishAscii, 5, 96 - 4) * 10n ** 4n) + ' bits', 'numbers only');
  passphrase = await text('.passphrase');
  assert(/^[a-z]+(\d[a-z]+){4}$/.test(passphrase), passphrase);
  // back to the defaults
  assert.strictEqual(await page(q('#use-spaces') + '.disabled'), true);
  await set('input.symbols', DEFAULT_SYMBOLS, 'input');
  await check('#use-symbols', true);
  await check('#use-capitals', true);
  await set('select.words', '7', 'change');
  await describes(bitsOf(defaultWays) + ' bits', 'the defaults again');

  // ---- maximum length: a tight limit is always respected, and the entropy
  // shown drops to match
  await set('input.max-length', '40', 'input');
  await describes('at most 40 characters', 'the 40 character limit');
  for (let i = 0; i < 40; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    assert(length(sample) <= 40, 'fits in 40 characters: ' + sample);
    assert.strictEqual(takeApart(sample, DEFAULT_SYMBOLS).words.length, 7, 'still seven words: ' + sample);
    assert.strictEqual(await text('.passphrase-length'), length(sample) + ' characters');
  }
  description = await text('.wordlist-description');
  const tightWays = waysWithin(englishAscii, 7, 40 - 6) * separatorWays(6, 12) * 120n;
  assert(bitsOf(tightWays) < bitsOf(defaultWays) - 10, 'a 40 character limit costs entropy');
  assert(description.includes(bitsOf(tightWays) + ' bits of entropy with 7 words, at most 40 characters'), description);
  // a limit nothing can meet says so, and there is nothing to memorize
  await set('input.max-length', '12', 'input');
  await waitForText('.wordlist-description', 'No passphrase of 7 words', 'the does-not-fit message');
  assert.strictEqual(await text('.passphrase'), '');
  assert.strictEqual(await text('.passphrase-length'), '');
  await click('.button-memorize');
  assert.strictEqual(await page(q('.content-generate') + '.classList.contains("active")'), true);
  await set('input.max-length', '96', 'input');
  await describes(bitsOf(defaultWays) + ' bits', 'the defaults again');

  // ---- the Word lists tab: every list, grouped by language, English first
  await click('.wordlists-summary');
  assert.strictEqual(await page(q('.content-lists') + '.classList.contains("active")'), true);
  assert.strictEqual(await page('document.querySelectorAll(".lists-row").length'), english.count,
    'one row per manifest entry');
  const languages = await page('Array.from(document.querySelectorAll(".lists-language")).map(function(e){ return e.textContent; })');
  assert.strictEqual(languages[0], 'English');
  assert.deepStrictEqual(languages.slice(1), languages.slice(1).sort((a, b) => a.localeCompare(b)),
    'the other languages are in alphabetical order');
  const englishRows = await page('Array.from(document.querySelectorAll(".lists-group")[0].querySelectorAll(".lists-name")).map(function(e){ return e.textContent; })');
  assert(englishRows.includes('EFF Large') && englishRows.includes('English Wiktionary'), englishRows.join(', '));
  assert.strictEqual(await text('.lists-count'), '1 of ' + english.count + ' selected');
  assert.strictEqual(await fitsWindow(), true, 'the Word lists tab fits the window');
  const visibleRows = () => page('Array.from(document.querySelectorAll(".lists-row")).filter(function(r){ return r.offsetParent !== null; }).map(function(r){ return r.querySelector("input").value; })');

  // typing narrows the lists
  await set('.lists-filter', 'swed', 'input');
  assert.deepStrictEqual((await visibleRows()).sort(),
    ['swedish-diceware', 'swedish-wiktionary', 'swedish-wiktionary-short']);
  await set('.lists-filter', '', 'input');
  assert.strictEqual((await visibleRows()).length, english.count);

  // two lists switched on are combined, with repeats counted once
  await click(row('eff-large'));
  const combined = without(new Set([...englishAscii, ...effAscii]), '0123456789' + DEFAULT_SYMBOLS);
  await describes(combined.size + ' words, ', 'the combined lists');
  assert.strictEqual(await text('.wordlists-summary'), '2 word lists');
  assert.strictEqual(await text('.lists-count'), '2 of ' + english.count + ' selected');
  description = await text('.wordlist-description');
  assert(description.startsWith('2 word lists combined: EFF Large, English Wiktionary'), description);
  // EFF Large on its own
  await click(row('english-wiktionary'));
  await describes(effUsable.size + ' words, ', 'the EFF list alone');
  assert.strictEqual(await text('.wordlists-summary'), 'EFF Large');
  for (let i = 0; i < 10; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    takeApart(sample, DEFAULT_SYMBOLS).words.forEach((w) => assert(effUsable.has(lower(w)), w + ' is a usable EFF Large word: ' + sample));
  }
  // the last list cannot be switched off
  await click(row('eff-large'));
  assert.strictEqual(await page(q(row('eff-large')) + '.checked'), true, 'one list always stays on');

  // ---- ASCII words only: a list in another script has nothing to offer
  // until the option is switched off
  const russian = words('russian-wiktionary');
  await click(row('russian-wiktionary'));
  await click(row('eff-large'));
  await waitForText('.wordlist-description', 'These word lists have no words that can be used', 'the no-usable-words message');
  assert.strictEqual(await text('.passphrase'), '');
  await check('#ascii-only', false);
  await describes(russian.set.size + ' words, ', 'the whole Russian list');
  passphrase = await text('.passphrase');
  assert(/[Ѐ-ӿ]/.test(passphrase), 'Cyrillic words: ' + passphrase);
  await check('#ascii-only', true);
  // back to English Wiktionary, plain settings for the checks below
  await click(row('english-wiktionary'));
  await click(row('russian-wiktionary'));
  await click('.tab-generate');
  await check('#use-capitals', false);
  await check('#use-symbols', false);
  await set('select.words', '4', 'change');
  await describes(bitsOf(waysWithin(englishAscii, 4, 96 - 3) * 10n ** 3n) + ' bits', 'four words and numbers');
  passphrase = await text('.passphrase');
  assert(/^[a-z]+(\d[a-z]+){3}$/.test(passphrase), passphrase);

  // an unknown list id is refused by the main process
  assert.strictEqual(
    await page('window.passphrasesApp.readWordlist("../main.js").then(function(){ return "read"; }, function(){ return "refused"; })'),
    'refused');

  // Memorize takes the passphrase to the memorize tab
  const typePassphrase = () => page(
    q('.passphrase-test') + '.value = ' + q('.hint-show') + '.textContent; ' +
    q('.passphrase-test') + '.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true })); null');
  await click('.button-memorize');
  assert.strictEqual(await page(q('.content-memorize') + '.classList.contains("active")'), true);
  assert.strictEqual(await visible('.memorize-go'), true);
  assert.strictEqual(await visible('.memorize-input'), false);
  assert.strictEqual(await text('.hint-show'), passphrase);
  assert.strictEqual(await visible('.hint-show'), true, 'the hint shows on the first try');
  // a wrong character is marked, the right text clears it
  await set('.passphrase-test', 'zzz', 'keyup');
  assert.strictEqual(await page(q('.passphrase-test') + '.classList.contains("typo")'), true);
  await typePassphrase();
  assert.strictEqual(await text('.memorize-tries'), '1');
  assert.strictEqual(await visible('.hint-show'), false, 'the hint is held back after the first try');

  // Cancel and start again: tries count once per try, not once per session
  await click('.button-cancel');
  assert.strictEqual(await visible('.memorize-input'), true);
  await click('.button-start-memorizing');
  assert.strictEqual(await text('.memorize-tries'), '0');
  await typePassphrase();
  assert.strictEqual(await text('.memorize-tries'), '1', 'a restarted session counts each try once');

  // ten tries without looking lead to the rest countdown
  for (let i = 0; i < 9; i++) await typePassphrase();
  assert.strictEqual(await text('.memorize-tries'), '10');
  assert.strictEqual(await page(q('.passphrase-test') + '.type'), 'password');
  assert.strictEqual(await visible('.memorize-waiting'), true, 'the countdown shows');
  assert.strictEqual(await text('.countdown'), '1:00');
  await sleep(1200);
  assert.strictEqual(await text('.countdown'), '0:59', 'the countdown runs');
  // Cancel stops the countdown
  await click('.button-cancel');
  await sleep(1200);
  assert.strictEqual(await text('.countdown'), '0:59', 'Cancel stops the countdown');
  // a new session starts clean, and Skip then space moves on
  await click('.button-start-memorizing');
  assert.strictEqual(await visible('.memorize-active'), true);
  assert.strictEqual(await visible('.memorize-waiting'), false);
  for (let i = 0; i < 10; i++) await typePassphrase();
  assert.strictEqual(await visible('.memorize-waiting'), true);
  await click('.button-skip-countdown');
  assert.strictEqual(await visible('.memorize-ready'), true);
  await page('window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })); null');
  assert.strictEqual(await visible('.memorize-active'), true, 'space starts the next round');
  await click('.button-cancel');

  // About tab: the sound preference is saved by the main process
  await click('.tab-about');
  assert.strictEqual(await page(q('.enable-sound') + '.checked'), true);
  await click('.enable-sound');
  const prefsFile = path.join(userData, 'passphrases.conf');
  const readPrefs = () => JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
  for (let i = 0; i < 100 && !fs.existsSync(prefsFile); i++) await sleep(50);
  assert.deepStrictEqual(readPrefs(), { sound: false, theme: 'classic' });

  // every color style applies, and the choice is saved
  const styles = await page('Array.from(' + q('.color-style') + '.options).map(function(o){ return o.value; })');
  assert.strictEqual(styles.length, 14);
  const seen = new Set();
  for (const style of styles) {
    await set('.color-style', style, 'change');
    assert.strictEqual(await page('document.documentElement.getAttribute("data-theme")'), style);
    seen.add(await page('getComputedStyle(document.documentElement).getPropertyValue("--secret") + getComputedStyle(document.documentElement).getPropertyValue("--field-bg")'));
    if (process.env.SMOKE_SCREENSHOT) {
      await click('.tab-generate');
      await sleep(150);
      fs.writeFileSync(process.env.SMOKE_SCREENSHOT.replace(/\.png$/, '-' + style + '.png'),
        (await win.webContents.capturePage()).toPNG());
      await click('.tab-about');
    }
  }
  assert.strictEqual(seen.size, styles.length, 'each style has its own passphrase colors');
  for (let i = 0; i < 100 && readPrefs().theme !== 'zenburn-low'; i++) await sleep(50);
  assert.deepStrictEqual(readPrefs(), { sound: false, theme: 'zenburn-low' });
  await set('.color-style', 'classic', 'change');

  // links open in the browser and the window stays on the app
  const url = win.webContents.getURL();
  const links = await page('Array.from(document.querySelectorAll(".content-about a")).map(function(a){ return a.href; })');
  assert(links.length >= 2);
  links.forEach((href) => assert(href.startsWith('https://'), href));
  await click('.content-about a');
  await sleep(300);
  assert.deepStrictEqual(opened, [links[0]], 'the link opened in the browser');
  assert.strictEqual(win.webContents.getURL(), url, 'window did not navigate');

  assert.deepStrictEqual(consoleProblems, [], 'no warnings or errors in the page console');
}

app.on('browser-window-created', function (event, win) {
  win.webContents.on('console-message', function (details) {
    if (details.level === 'warning' || details.level === 'error') {
      consoleProblems.push(details.level + ': ' + details.message);
    }
  });
  win.webContents.once('did-finish-load', function () {
    run(win).then(function () {
      console.log('smoke test passed');
      app.exit(0);
    }, function (err) {
      console.error('smoke test FAILED');
      console.error(err);
      app.exit(1);
    });
  });
});

require(path.join(SRC, 'main.js'));
