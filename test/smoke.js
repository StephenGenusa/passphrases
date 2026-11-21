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

  // defaults: English Wiktionary, seven words, digits or punctuation between
  // them, some words capitalized
  await waitFor(q('.passphrase') + '.textContent != ""', 'the first passphrase');
  const english = words('english-wiktionary');
  assert.strictEqual(await page('document.querySelectorAll("#wordlists-options option").length'),
    english.count, 'one suggestion per manifest entry');
  assert.strictEqual(await value('input.wordlists'), 'English Wiktionary');
  assert.strictEqual(await page(q('select.separator') + '.selectedOptions[0].textContent'),
    'numbers + punctuation');
  assert.strictEqual(await page(q('#use-upcase') + '.checked'), true);
  let passphrase = await text('.passphrase');
  // the wordlists hold letters only, so anything else is a separator
  let parts = passphrase.split(/[^\p{L}\p{M}]/u);
  assert.strictEqual(parts.length, 7, 'seven words by default: ' + passphrase);
  parts.forEach((w) => assert(
    english.set.has(w) || english.set.has(w.charAt(0).toLowerCase() + w.substring(1)),
    w + ' is in the English Wiktionary list'));
  let sawUppercase = false;
  let sawDigit = false;
  let sawPunctuation = false;
  for (let i = 0; i < 40 && !(sawUppercase && sawDigit && sawPunctuation); i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    sawUppercase = sawUppercase || /\p{Lu}/u.test(sample);
    sawDigit = sawDigit || /\d/.test(sample);
    sawPunctuation = sawPunctuation || /[^\p{L}\p{M}\d]/u.test(sample);
  }
  assert(sawUppercase, 'capitalized words appear');
  assert(sawDigit && sawPunctuation, 'digits and punctuation both appear as separators');
  let description = await text('.wordlist-description');
  const bits = Math.round(Math.log2(english.entry.count) * 7 * 100) / 100;
  assert(description.includes(english.entry.count + ' words, '), description);

  // maximum length: a number field with a spinner, 96 by default
  assert.strictEqual(await page(q('input.max-length') + '.type'), 'number');
  assert.strictEqual(await value('input.max-length'), '96');
  const length = (s) => Array.from(s).length;
  assert(length(passphrase) <= 96, 'the default passphrase fits in 96 characters');
  // the length of the passphrase on show is stated under it
  assert.strictEqual(await text('.passphrase-length'),
    length(await text('.passphrase')) + ' characters');
  const bitsWithin = (list, count, limit) => {
    // number of ways to pick `count` words whose letters total at most
    // limit - (count - 1), worked out here independently of the app
    const histogram = new Map();
    list.set.forEach((w) => histogram.set(length(w), (histogram.get(length(w)) || 0n) + 1n));
    let exact = new Map([[0, 1n]]);
    for (let i = 0; i < count; i++) {
      const next = new Map();
      exact.forEach((ways, total) => histogram.forEach((n, len) =>
        next.set(total + len, (next.get(total + len) || 0n) + ways * n)));
      exact = next;
    }
    let fitting = 0n;
    exact.forEach((ways, total) => { if (total <= limit - (count - 1)) fitting += ways; });
    const digits = fitting.toString(2);
    return Math.log2(parseInt(digits.slice(0, 53), 2)) + Math.max(0, digits.length - 53);
  };
  assert(description.includes(Math.round(bitsWithin(english, 7, 96) * 100) / 100 +
    ' bits of entropy with 7 words, at most 96 characters'), description);
  // a tight limit is always respected, and the entropy shown drops to match
  await set('input.max-length', '40', 'input');
  await waitFor(q('.wordlist-description') + '.textContent.includes("at most 40 characters")', 'the 40 character limit');
  for (let i = 0; i < 40; i++) {
    await click('.button-generate');
    const sample = await text('.passphrase');
    assert(length(sample) <= 40, 'fits in 40 characters: ' + sample);
    assert.strictEqual(await text('.passphrase-length'), length(sample) + ' characters');
    assert.strictEqual(sample.split(/[^\p{L}\p{M}]/u).length, 7, 'still seven words: ' + sample);
  }
  description = await text('.wordlist-description');
  const tightBits = bitsWithin(english, 7, 40);
  assert(tightBits < bits - 10, 'a 40 character limit costs entropy');
  assert(description.includes(Math.round(tightBits * 100) / 100 + ' bits of entropy with 7 words, at most 40 characters'), description);
  // a limit nothing can meet says so, and there is nothing to memorize
  await set('input.max-length', '12', 'input');
  await waitForText('.wordlist-description', 'No passphrase of 7 words', 'the does-not-fit message');
  assert.strictEqual(await text('.passphrase'), '');
  assert.strictEqual(await text('.passphrase-length'), '');
  await click('.button-memorize');
  assert.strictEqual(await page(q('.content-generate') + '.classList.contains("active")'), true);
  await set('input.max-length', '96', 'input');
  await waitFor(q('.passphrase') + '.textContent != ""', 'a passphrase again');

  // nothing needs a scrollbar at the window's size
  assert.strictEqual(
    await page('document.documentElement.scrollHeight <= window.innerHeight && document.documentElement.scrollWidth <= window.innerWidth'),
    true, 'the page fits the window');

  // plain settings for the checks below
  await click('#use-upcase');
  assert.strictEqual(await page(q('#use-upcase') + '.checked'), false);
  await set('select.separator', '0', 'change');
  await waitFor(q('.passphrase') + '.textContent.split(" ").length == 7', 'space separators');
  passphrase = await text('.passphrase');

  // the Generate button draws a new passphrase
  await click('.button-generate');
  assert.notStrictEqual(await text('.passphrase'), passphrase, 'Generate changes the passphrase');

  // typing part of a name and pressing Enter finds the list
  const typeAndEnter = async (typed) => {
    await page(q('input.wordlists') + '.focus(); null');
    await set('input.wordlists', typed, 'input');
    await page(q('input.wordlists') +
      '.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); null');
  };
  await set('select.words', '4', 'change');
  await typeAndEnter('swed');
  await waitForText('.wordlist-description', 'Swedish', 'the Swedish list');
  assert.strictEqual(await value('input.wordlists'), 'Swedish Wiktionary');
  // text that matches nothing keeps the current list
  await typeAndEnter('no such list');
  await page(q('input.wordlists') + '.blur(); null');
  assert.strictEqual(await value('input.wordlists'), 'Swedish Wiktionary');
  // a full name, as picked from the suggestions, selects without Enter
  const french = words('french-wiktionary');
  await set('input.wordlists', 'French Wiktionary', 'input');
  await waitForText('.wordlist-description', 'French', 'the French list');
  passphrase = await text('.passphrase');
  parts = passphrase.split(' ');
  assert.strictEqual(parts.length, 4, 'four words');
  parts.forEach((w) => assert(french.set.has(w), w + ' is in the French list'));

  // number separators
  await set('select.separator', '1', 'change');
  await waitFor('/\\d/.test(' + q('.passphrase') + '.textContent)', 'number separators');
  passphrase = await text('.passphrase');
  parts = passphrase.split(/\d/);
  assert.strictEqual(parts.length, 4);
  parts.forEach((w) => assert(french.set.has(w), w + ' is in the French list'));

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
