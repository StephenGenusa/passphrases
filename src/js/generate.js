/* Passphrases | https://github.com/micahflee/passphrases
   Copyright (C) 2015 Micah Lee <micah@micahflee.com>

   Permission is hereby granted, free of charge, to any person obtaining a
   copy of this software and associated documentation files (the
   "Software"), to deal in the Software without restriction, including
   without limitation the rights to use, copy, modify, merge, publish,
   distribute, sublicense, and/or sell copies of the Software, and to
   permit persons to whom the Software is furnished to do so, subject to
   the following conditions:

   The above copyright notice and this permission notice shall be included
   in all copies or substantial portions of the Software.

   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
   OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
   MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
   IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
   CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
   TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
   SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

// Return an integer from min to max inclusive, each equally likely, drawn from
// the operating system's cryptographic random number generator.
function randomInteger(min, max) {
  var range = max - min + 1;
  // A 32-bit value modulo range favours the low results unless values past
  // the last whole multiple of range are thrown away and drawn again.
  var limit = 4294967296 - (4294967296 % range);
  var buffer = new Uint32Array(1);
  do {
    window.crypto.getRandomValues(buffer);
  } while(buffer[0] >= limit);
  return min + (buffer[0] % range);
}

// Return a BigInt from 0 up to but not including bound, each equally likely.
function randomBigIntBelow(bound) {
  var bits = bound.toString(2).length;
  var bytes = new Uint8Array(Math.ceil(bits / 8));
  var excess = BigInt(bytes.length * 8 - bits);
  while(true) {
    window.crypto.getRandomValues(bytes);
    var value = 0n;
    for(var i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]);
    value >>= excess;
    if(value < bound) return value;
  }
}

// Base-2 logarithm of a positive BigInt of any size.
function log2BigInt(value) {
  var digits = value.toString(2);
  var top = digits.slice(0, 53);
  return Math.log2(parseInt(top, 2)) + (digits.length - top.length);
}

// length of a word in characters (code points), as a length limit counts them
function wordLength(word) {
  return Array.from(word).length;
}

function capitalize(word) {
  return word.charAt(0).toUpperCase() + word.substring(1);
}

// n choose k, as a BigInt
function choose(n, k) {
  var result = 1n;
  for(var i = 1; i <= k; i++) result = result * BigInt(n - k + i) / BigInt(i);
  return result;
}

var DEFAULT_WORDLISTS = ['eff-large'];
var DEFAULT_MAX_LENGTH = 96;
var DIGITS = '0123456789';
// each kind of character that is switched on appears at least this many times
var MINIMUM_OF_EACH = 2;

document.addEventListener('DOMContentLoaded', function(){
  var summaryButton = el('.wordlists-summary'),
    wordsSelect = el('select.words'),
    maxLengthBox = el('input.max-length'),
    useCapitals = el('#use-capitals'),
    useNumbers = el('#use-numbers'),
    useSymbols = el('#use-symbols'),
    useSpaces = el('#use-spaces'),
    symbolsBox = el('input.symbols'),
    asciiOnly = el('#ascii-only'),
    listsBox = el('.lists-box'),
    listsFilter = el('.lists-filter');

  // every wordlist in wordlists/manifest.json, by id; the words of a list are
  // read from the main process the first time it is used
  var wordlists = {};

  // ids of the lists that are switched on
  var selected = {};

  // The words passphrases are drawn from: the lists that are switched on,
  // combined, with repeats removed. null until the first one is ready.
  var pool = null;
  var poolKey = null;

  function loadWordlist(id) {
    var list = wordlists[id];
    if(list.wordlist) return Promise.resolve(list);

    return window.passphrasesApp.readWordlist(id).then(function(data){
      list.wordlist = data.split('\n');
      // remove the trailing blank item
      if(list.wordlist[list.wordlist.length - 1] == '') list.wordlist.pop();
      return list;
    });
  }

  function selectedLists() {
    return Object.keys(wordlists).filter(function(id){ return selected[id]; })
      .map(function(id){ return wordlists[id]; });
  }

  // Load the lists that are switched on and combine them, then show a
  // passphrase. Called when the choice of lists or "ASCII only" changes.
  function rebuildPool() {
    var lists = selectedLists();
    var key = lists.map(function(list){ return list.id; }).join(',') + '|' + asciiOnly.checked;
    poolKey = key;
    updateSummary();

    Promise.all(lists.map(function(list){ return loadWordlist(list.id); })).then(function(){
      // ignore a choice that finished loading after another was made
      if(poolKey != key) return;

      var words = new Set();
      lists.forEach(function(list){
        list.wordlist.forEach(function(word){
          word = word.trim();
          if(asciiOnly.checked && !/^[\x21-\x7e]+$/.test(word)) return;
          words.add(word);
        });
      });

      pool = { lists: lists, words: Array.from(words), usableKey: null };
      update();
    }).catch(function(err){
      console.error('Error loading word lists', err);
    });
  }

  // Settle which words of the pool can be used with the current options, and
  // group them by length. A word is left out when it contains a character
  // that is in use as a separator, or, with capitals on, when it already has
  // a capital: then no two different choices can spell the same passphrase,
  // and the entropy shown is exact.
  function settleUsableWords() {
    var plan = separatorPlan();
    var taken = plan.digits + plan.marks + (plan.space ? ' ' : '');
    var key = taken + '|' + useCapitals.checked;
    if(pool.usableKey == key) return;

    var byLength = [];
    var count = 0;
    var cased = true;
    pool.words.forEach(function(word){
      for(var i = 0; i < taken.length; i++) {
        if(word.indexOf(taken[i]) != -1) return;
      }
      if(useCapitals.checked && word != word.toLowerCase()) return;
      var length = wordLength(word);
      (byLength[length] = byLength[length] || []).push(word);
      count++;
      // capitals can be counted on only if every word has a capital form
      if(cased && capitalize(word) == word) cased = false;
    });
    pool.usableKey = key;
    pool.byLength = byLength;
    pool.count = count;
    pool.cased = cased;
    pool.fits = {};
  }

  // populate the words dropdown, from 3 to 10
  for(var i = 3; i <= 10; i++) {
    wordsSelect.add(new Option(i + ' words', i, i == 7, i == 7));
  }

  // the maximum length typed in the box, kept within the box's own limits
  function maxLength() {
    var value = Math.floor(Number(maxLengthBox.value));
    if(!isFinite(value) || maxLengthBox.value == '') value = DEFAULT_MAX_LENGTH;
    return Math.min(Number(maxLengthBox.max), Math.max(Number(maxLengthBox.min), value));
  }

  // The symbols in the box that can be used: each one once, and nothing that
  // is a letter, a digit or a space.
  function symbols() {
    return Array.from(new Set(Array.from(symbolsBox.value))).filter(function(ch){
      return !/[\p{L}\p{N}\s]/u.test(ch);
    }).join('');
  }

  // What goes between and after the words. Each word is followed by one
  // character, except the last; if that leaves too few places for two of each
  // kind that is switched on, more characters go on the end.
  function separatorPlan() {
    var words = Number(wordsSelect.value);
    var digits = useNumbers.checked ? DIGITS : '';
    var marks = useSymbols.checked ? symbols() : '';
    var kinds = (digits ? 1 : 0) + (marks ? 1 : 0);
    if(kinds == 0) {
      // nothing between the words, or a space if that is switched on; either
      // way there is nothing extra to guess
      return { slots: useSpaces.checked ? words - 1 : 0, digits: '', marks: '',
        space: useSpaces.checked, choices: 1n };
    }

    var slots = Math.max(words - 1, kinds * MINIMUM_OF_EACH);
    var choices;
    if(kinds == 1) {
      choices = BigInt((digits + marks).length) ** BigInt(slots);
    } else {
      // every way to fill the slots with at least two digits and two symbols
      choices = 0n;
      for(var d = MINIMUM_OF_EACH; d <= slots - MINIMUM_OF_EACH; d++) {
        choices += choose(slots, d) * BigInt(digits.length) ** BigInt(d) *
          BigInt(marks.length) ** BigInt(slots - d);
      }
    }
    return { slots: slots, digits: digits, marks: marks, choices: choices };
  }

  // Draw the separators for a plan: every filling that has enough of each
  // kind is equally likely.
  function drawSeparators(plan) {
    var all = plan.digits + plan.marks;
    var result = [];
    if(all == '') {
      for(var i = 0; i < plan.slots; i++) result.push(' ');
      return result;
    }
    while(true) {
      result = [];
      var digitCount = 0;
      for(var i = 0; i < plan.slots; i++) {
        var index = randomInteger(0, all.length - 1);
        if(index < plan.digits.length) digitCount++;
        result.push(all[index]);
      }
      if(plan.digits && digitCount < MINIMUM_OF_EACH) continue;
      if(plan.marks && plan.slots - digitCount < MINIMUM_OF_EACH) continue;
      return result;
    }
  }

  // How many ways there are to capitalize `words` words so that at least two
  // have a capital. Counted only when every word in the pool has a capital
  // form; otherwise capitals are still applied but not counted on.
  function capitalChoices(words) {
    if(!useCapitals.checked || !pool.cased) return 1n;
    return 2n ** BigInt(words) - BigInt(words) - 1n;
  }

  // How many ways there are to pick `words` words whose letters total at most
  // `budget`: fits[k][b] is that number for k words and b letters. Every such
  // choice is equally likely to be generated.
  function countFits(words, budget) {
    var key = words + '/' + budget;
    if(pool.fits[key]) return pool.fits[key];

    var byLength = pool.byLength;
    var fits = [[]];
    for(var b = 0; b <= budget; b++) fits[0][b] = 1n;
    for(var k = 1; k <= words; k++) {
      fits[k] = [];
      for(var b = 0; b <= budget; b++) {
        var total = 0n;
        for(var length = 1; length < byLength.length && length <= b; length++) {
          if(byLength[length]) total += BigInt(byLength[length].length) * fits[k - 1][b - length];
        }
        fits[k][b] = total;
      }
    }
    return pool.fits[key] = fits;
  }

  // update each time options change
  function update() {
    // spaces are only on offer when no number or symbol separates the words
    useSpaces.disabled = useNumbers.checked || (useSymbols.checked && symbols() != '');
    if(!pool) return;
    settleUsableWords();
    generatePassphrase();
    describe();
  }

  // show the strength of passphrases made with the current options
  function describe() {
    var selectedWords = Number(wordsSelect.value),
      plan = separatorPlan(),
      budget = maxLength() - plan.slots,
      box = el('.wordlist-description');

    var wordChoices = budget >= 0 && pool.count > 0 ? countFits(selectedWords, budget)[selectedWords][budget] : 0n;
    if(wordChoices == 0n) {
      box.textContent = pool.count == 0 ?
        'These word lists have no words that can be used. Switch off "ASCII words only" or choose another list.' :
        'No passphrase of ' + selectedWords + ' words from these lists fits in ' +
          maxLength() + ' characters. Raise the maximum length or use fewer words.';
      return;
    }

    // calculate entropy: every passphrase the options allow is equally
    // likely, so count them
    var choices = wordChoices * plan.choices * capitalChoices(selectedWords);
    var bitsOfEntropy = log2BigInt(choices);
    var bitsOfEntropyPerWord = Math.log2(pool.count);

    // calculate average time to guess at 1 trillion guesses/sec
    var keyspace = Number(choices);
    var guessesPerSecond = 1000000000000;
    var seconds = (keyspace / 2) / guessesPerSecond;

    var val, unit;
    if(seconds < 60) {
      val = seconds;
      unit = 'seconds';
    } else if(seconds < 60 * 60) {
      val = seconds / 60;
      unit = 'minutes';
    } else if(seconds < 60 * 60 * 24) {
      val = seconds / 60 / 60;
      unit = 'hours';
    } else if(seconds < 60 * 60 * 24 * 30) {
      val = seconds / 60 / 60 / 24;
      unit = 'days';
    } else if(seconds < 60 * 60 * 24 * 365) {
      val = seconds / 60 / 60 / 24 / 29.6;
      unit = 'months';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000) {
      val = seconds / 60 / 60 / 24 / 365;
      unit = 'years';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000000) {
      val = seconds / 60 / 60 / 24 / 365 / 1000;
      unit = 'thousand years';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000000000) {
      val = seconds / 60 / 60 / 24 / 365 / 1000000;
      unit = 'million years';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000000000000) {
      val = seconds / 60 / 60 / 24 / 365 / 1000000000;
      unit = 'billion years';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000000000000000) {
      val = seconds / 60 / 60 / 24 / 365 / 1000000000000;
      unit = 'trillion years';
    } else if(seconds < 60 * 60 * 24 * 365 * 1000000000000000000) {
      val = seconds / 60 / 60 / 24 / 365 / 1000000000000000;
      unit = 'quadrillion years';
    } else {
      val = seconds / 60 / 60 / 24 / 365 / 1000000000000000000;
      unit = 'quintillion years';
    }

    var names = pool.lists.map(function(list){ return list.name; });
    var description;
    if(pool.lists.length == 1) {
      description = pool.lists[0].description;
      if(pool.lists[0].license) description += ' — ' + pool.lists[0].license;
    } else {
      description = pool.lists.length + ' word lists combined: ' + names.join(', ');
    }

    var title = document.createElement('strong');
    title.textContent = description;
    title.title = names.join(', ');

    // a passphrase that would fall in under a year is flagged as weak
    var guessTime = document.createElement('span');
    guessTime.className = 'guess-time';
    guessTime.classList.toggle('weak', seconds < 60 * 60 * 24 * 365);
    guessTime.textContent = Math.round(val * 10) / 10 + ' ' + unit + ' average at one trillion guesses per second';

    var lines = [
      title,
      pool.count + ' words, ' + Math.round(bitsOfEntropyPerWord * 100) / 100 + ' bits of entropy per word',
      (plan.slots == 0 ? 'Up to ' : '') + Math.round(bitsOfEntropy * 100) / 100 + ' bits of entropy with ' + selectedWords + ' words, at most ' + maxLength() + ' characters',
      guessTime
    ];
    box.textContent = '';
    lines.forEach(function(line, i){
      if(i) box.append(document.createElement('br'));
      box.append(line);
    });
  }

  // generate a passphrase
  function generatePassphrase() {
    // nothing to draw from until the first wordlist has loaded
    if(!pool) return;
    settleUsableWords();

    var selectedWords = Number(wordsSelect.value),
      plan = separatorPlan();

    // Letters left for the words once the separators are counted. Each word's
    // length is drawn in proportion to the number of ways the remaining words
    // can still fit, which makes every fitting passphrase equally likely.
    var budget = maxLength() - plan.slots;
    var fits = budget >= 0 && pool.count > 0 ? countFits(selectedWords, budget) : null;
    if(!fits || fits[selectedWords][budget] == 0n) {
      Passphrases.currentPassphrase = '';
      el('.passphrase').textContent = '';
      el('.passphrase-length').textContent = '';
      return;
    }

    // play dice roll sound effect
    Passphrases.playSound('generate');

    var byLength = pool.byLength;
    var words = [];
    for (var i = 0; i < selectedWords; i++) {
      var wordsLeft = selectedWords - i - 1;
      var pick = randomBigIntBelow(fits[wordsLeft + 1][budget]);
      var length = 0;
      while(true) {
        length++;
        if(!byLength[length] || length > budget) continue;
        var weight = BigInt(byLength[length].length) * fits[wordsLeft][budget - length];
        if(pick < weight) break;
        pick -= weight;
      }
      budget -= length;
      words.push(byLength[length][randomInteger(0, byLength[length].length - 1)]);
    }

    // Capitals: each word gets one or not on the toss of a coin, tossed again
    // until at least two words have one (or as many as have a capital form).
    if(useCapitals.checked) {
      var canCapitalize = words.filter(function(word){ return capitalize(word) != word; }).length;
      var needed = Math.min(MINIMUM_OF_EACH, canCapitalize);
      while(true) {
        var capitalized = words.map(function(word){ return randomInteger(0, 1) == 1 ? capitalize(word) : word; });
        var changed = capitalized.filter(function(word, i){ return word != words[i]; }).length;
        if(changed >= needed) break;
      }
      words = capitalized;
    }

    var separators = drawSeparators(plan);
    var passphrase = '';
    words.forEach(function(word, i){
      passphrase += word;
      if(i < separators.length && i < words.length - 1) passphrase += separators[i];
    });
    // separators beyond the gaps between words go on the end
    passphrase += separators.slice(words.length - 1).join('');

    Passphrases.currentPassphrase = passphrase;
    el('.passphrase').textContent = passphrase;
    el('.passphrase-length').textContent = wordLength(passphrase) + ' characters';
  }

  wordsSelect.addEventListener('change', update);
  maxLengthBox.addEventListener('input', update);
  maxLengthBox.addEventListener('blur', function(){
    // show the value actually in use
    maxLengthBox.value = maxLength();
  });
  [useCapitals, useNumbers, useSymbols, useSpaces].forEach(function(box){
    box.addEventListener('change', update);
  });
  symbolsBox.addEventListener('input', update);
  symbolsBox.addEventListener('blur', function(){
    // show the symbols actually in use
    symbolsBox.value = symbols();
  });
  asciiOnly.addEventListener('change', rebuildPool);

  el('.button-generate').addEventListener('click', generatePassphrase);
  el('.button-memorize').addEventListener('click', function(){
    // nothing to memorize when no passphrase fits
    if(!Passphrases.currentPassphrase) return;
    Passphrases.tabMemorize();
    Passphrases.memorizeStart(Passphrases.currentPassphrase);
  });

  // ------------------------------------------------- choosing word lists

  // the button on the Generate tab names the lists in use and opens the
  // Word lists tab
  function updateSummary() {
    var lists = selectedLists();
    summaryButton.textContent = lists.length == 1 ? lists[0].name : lists.length + ' word lists';
    summaryButton.title = lists.map(function(list){ return list.name; }).join(', ') +
      '\nClick to choose word lists';
    el('.lists-count').textContent = lists.length + ' of ' + Object.keys(wordlists).length + ' selected';
  }
  summaryButton.addEventListener('click', function(){
    Passphrases.showTab('lists');
    listsFilter.focus();
  });

  // One checkbox per list, grouped by language: English first, then the other
  // languages in alphabetical order.
  function buildListsBox(lists) {
    var languages = [];
    lists.forEach(function(list){
      if(languages.indexOf(list.language) == -1) languages.push(list.language);
    });
    languages.sort(function(a, b){
      if(a == 'English' || b == 'English') return a == b ? 0 : (a == 'English' ? -1 : 1);
      return a.localeCompare(b);
    });

    languages.forEach(function(language){
      var group = document.createElement('div');
      group.className = 'lists-group';
      var heading = document.createElement('div');
      heading.className = 'lists-language';
      heading.textContent = language;
      group.append(heading);

      lists.filter(function(list){ return list.language == language; }).forEach(function(list){
        var row = document.createElement('label');
        row.className = 'lists-row';
        row.dataset.search = (list.name + ' ' + list.language).toLowerCase();
        var box = document.createElement('input');
        box.type = 'checkbox';
        box.value = list.id;
        box.checked = !!selected[list.id];
        box.addEventListener('change', function(){
          // at least one list stays on
          if(!box.checked && selectedLists().length == 1) {
            box.checked = true;
            return;
          }
          selected[list.id] = box.checked;
          rebuildPool();
        });
        var name = document.createElement('span');
        name.className = 'lists-name';
        name.textContent = list.name;
        var count = document.createElement('span');
        count.className = 'lists-words';
        count.textContent = list.count.toLocaleString('en-US') + ' words';
        row.append(box, name, count);
        group.append(row);
      });
      listsBox.append(group);
    });
  }

  // typing in the filter box narrows the lists to matching names or languages
  listsFilter.addEventListener('input', function(){
    var text = listsFilter.value.trim().toLowerCase();
    listsBox.querySelectorAll('.lists-group').forEach(function(group){
      var any = false;
      group.querySelectorAll('.lists-row').forEach(function(row){
        var match = row.dataset.search.indexOf(text) != -1;
        row.hidden = !match;
        any = any || match;
      });
      group.hidden = !any;
    });
  });

  // fill the word lists tab and show the first passphrase
  Promise.all([window.passphrasesApp.getWordlists(), Passphrases.ready]).then(function(results){
    results[0].forEach(function(list){
      wordlists[list.id] = list;
    });
    DEFAULT_WORDLISTS.forEach(function(id){
      if(wordlists[id]) selected[id] = true;
    });
    // fall back to the first list if the default is not there
    if(selectedLists().length == 0) selected[results[0][0].id] = true;
    buildListsBox(results[0]);
    rebuildPool();
  }).catch(function(err){
    console.error('Error loading the list of word lists', err);
  });

});
