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

var DEFAULT_WORDLIST = 'english-wiktionary';
var DEFAULT_MAX_LENGTH = 96;

document.addEventListener('DOMContentLoaded', function(){
  var wordlistBox = el('input.wordlists'),
    wordsSelect = el('select.words'),
    separatorSelect = el('select.separator'),
    maxLengthBox = el('input.max-length'),
    upcase = el('#use-upcase');

  // every wordlist in wordlists/manifest.json, by id; the words of a list are
  // read from the main process the first time it is selected
  var wordlists = {};

  // id of the wordlist chosen in the box, and that list once its words are
  // loaded
  var selectedWordlist = null;
  var currentList = null;

  function loadWordlist(id) {
    var list = wordlists[id];
    if(list.wordlist) return Promise.resolve(list);

    return window.passphrasesApp.readWordlist(id).then(function(data){
      list.wordlist = data.split('\n');
      // remove the trailing blank item
      if(list.wordlist[list.wordlist.length - 1] == '') list.wordlist.pop();
      list.count = list.wordlist.length;
      return list;
    });
  }

  // populate the words dropdown, from 3 to 10
  for(var i = 3; i <= 10; i++) {
    wordsSelect.add(new Option(i + ' words', i, i == 7, i == 7));
  }

  // populate the word separator dropdown; the value says which characters
  // go between words: 0 spaces, 1 digits, 2 punctuation, 3 digits or punctuation
  ['spaces', 'numbers', 'punctuation', 'numbers + punctuation'].forEach(function(label, value){
    separatorSelect.add(new Option(label, value, value == 3, value == 3));
  });

  // the maximum length typed in the box, kept within the box's own limits
  function maxLength() {
    var value = Math.floor(Number(maxLengthBox.value));
    if(!isFinite(value) || maxLengthBox.value == '') value = DEFAULT_MAX_LENGTH;
    return Math.min(Number(maxLengthBox.max), Math.max(Number(maxLengthBox.min), value));
  }

  // The words of a list grouped by length, made once per list.
  function wordsByLength(list) {
    if(!list.byLength) {
      list.byLength = [];
      list.wordlist.forEach(function(word){
        var length = wordLength(word.trim());
        (list.byLength[length] = list.byLength[length] || []).push(word.trim());
      });
    }
    return list.byLength;
  }

  // How many ways there are to pick `words` words whose letters total at most
  // `budget`: fits[k][b] is that number for k words and b letters. Every such
  // choice is equally likely to be generated, so the logarithm of
  // fits[words][budget] is the entropy of the passphrase.
  function countFits(list, words, budget) {
    var key = words + '/' + budget;
    list.fits = list.fits || {};
    if(list.fits[key]) return list.fits[key];

    var byLength = wordsByLength(list);
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
    return list.fits[key] = fits;
  }

  // update each time options change
  function update() {
    var wanted = selectedWordlist;

    loadWordlist(wanted).then(function(list){
      // ignore a list that finished loading after another was selected
      if(selectedWordlist != wanted) return;

      currentList = list;
      generatePassphrase();
      describe();
    }).catch(function(err){
      console.error('Error loading word list', err);
    });
  }

  // show the strength of passphrases made with the current options
  function describe() {
    var selectedWords = Number(wordsSelect.value),
      wordlistCount = currentList.count;

    // calculate entropy: every passphrase that fits the maximum length is
    // equally likely, so count them
    var bitsOfEntropyPerWord = Math.log2(wordlistCount);
    var budget = maxLength() - (selectedWords - 1);
    var choices = budget >= 0 ? countFits(currentList, selectedWords, budget)[selectedWords][budget] : 0n;
    if(choices == 0n) {
      var box = el('.wordlist-description');
      box.textContent = 'No passphrase of ' + selectedWords + ' words from this list fits in ' +
        maxLength() + ' characters. Raise the maximum length or use fewer words.';
      return;
    }
    var bitsOfEntropy = log2BigInt(choices);

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

    var description = currentList.description;
    if(currentList.license) {
      description += ' \u2014 ' + currentList.license;
    }

    var title = document.createElement('strong');
    title.textContent = description;
    var lines = [
      title,
      wordlistCount + ' words, ' + Math.round(bitsOfEntropyPerWord * 100) / 100 + ' bits of entropy per word',
      Math.round(bitsOfEntropy * 100) / 100 + ' bits of entropy with ' + selectedWords + ' words, at most ' + maxLength() + ' characters',
      Math.round(val * 10) / 10 + ' ' + unit + ' average at one trillion guesses per second'
    ];
    var box = el('.wordlist-description');
    box.textContent = '';
    lines.forEach(function(line, i){
      if(i) box.append(document.createElement('br'));
      box.append(line);
    });
  }
  wordsSelect.addEventListener('change', update);
  maxLengthBox.addEventListener('input', update);
  maxLengthBox.addEventListener('blur', function(){
    // show the value actually in use
    maxLengthBox.value = maxLength();
  });
  separatorSelect.addEventListener('change', update);
  upcase.addEventListener('click', update);

  // The wordlist box is a text field with the list names as suggestions:
  // typing narrows the suggestions, and a full name selects that list.
  function findWordlist(text, allowPartial) {
    text = text.trim().toLowerCase();
    if(text == '') return null;
    var partial = null;
    for(var id in wordlists) {
      var name = wordlists[id].name.toLowerCase();
      if(name == text) return id;
      if(allowPartial && partial === null && name.indexOf(text) != -1) partial = id;
    }
    return partial;
  }
  function selectWordlist(id) {
    wordlistBox.value = wordlists[id].name;
    if(id != selectedWordlist) {
      selectedWordlist = id;
      update();
    }
  }
  wordlistBox.addEventListener('input', function(){
    // picking a suggestion, or typing a whole name, selects at once
    var id = findWordlist(wordlistBox.value, false);
    if(id) selectWordlist(id);
  });
  wordlistBox.addEventListener('keydown', function(e){
    // Enter takes the first list whose name contains what was typed
    if(e.key == 'Enter') {
      var id = findWordlist(wordlistBox.value, true);
      if(id) selectWordlist(id);
      wordlistBox.select();
    } else if(e.key == 'Escape') {
      wordlistBox.value = wordlists[selectedWordlist].name;
      wordlistBox.select();
    }
  });
  wordlistBox.addEventListener('focus', function(){
    // typing replaces the current name
    wordlistBox.select();
  });
  wordlistBox.addEventListener('blur', function(){
    // leaving the box with something else typed keeps the current list
    if(selectedWordlist) wordlistBox.value = wordlists[selectedWordlist].name;
  });

  // generate a passphrase
  function generatePassphrase() {
    // nothing to draw from until the first wordlist has loaded
    if(!currentList) return;

    // play dice roll sound effect
    Passphrases.playSound('generate');

    var selectedWords = Number(wordsSelect.value),
      separator = Number(separatorSelect.value);

    var specialChars = "!\"#$%&'()*+,-./:;<=>?@[]^_`{|}~";
    var numericChars = "0123456789";

    // Letters left for the words once the separators are counted. Each word's
    // length is drawn in proportion to the number of ways the remaining words
    // can still fit, which makes every fitting passphrase equally likely.
    var budget = maxLength() - (selectedWords - 1);
    var fits = budget >= 0 ? countFits(currentList, selectedWords, budget) : null;
    if(!fits || fits[selectedWords][budget] == 0n) {
      Passphrases.currentPassphrase = '';
      el('.passphrase').textContent = '';
      el('.passphrase-length').textContent = '';
      return;
    }
    var byLength = wordsByLength(currentList);

    var passphrase = '';
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
      var newWord = byLength[length][randomInteger(0, byLength[length].length - 1)];
      if (upcase.checked && randomInteger(0, 1) == 1) {
        newWord = newWord.charAt(0).toUpperCase() + newWord.substring(1);
      }
      passphrase += newWord;

      var sepChar = ' ';
      if (separator == 1) {
        sepChar = numericChars[randomInteger(0, numericChars.length - 1)];
      } else if (separator == 2) {
        sepChar = specialChars[randomInteger(0, specialChars.length - 1)];
      } else if (separator == 3) {
        var either = specialChars + numericChars;
        sepChar = either[randomInteger(0, either.length - 1)];
      }
      if(i < selectedWords - 1) { passphrase += sepChar; }
    }

    Passphrases.currentPassphrase = passphrase;
    el('.passphrase').textContent = passphrase;
    el('.passphrase-length').textContent = wordLength(passphrase) + ' characters';
  }

  el('.button-generate').addEventListener('click', generatePassphrase);
  el('.button-memorize').addEventListener('click', function(){
    // nothing to memorize when no passphrase fits the maximum length
    if(!Passphrases.currentPassphrase) return;
    Passphrases.tabMemorize();
    Passphrases.memorizeStart(Passphrases.currentPassphrase);
  });

  // fill the wordlist suggestions and show the first passphrase
  Promise.all([window.passphrasesApp.getWordlists(), Passphrases.ready]).then(function(results){
    results[0].forEach(function(list){
      wordlists[list.id] = list;
      var option = document.createElement('option');
      option.value = list.name;
      el('#wordlists-options').append(option);
    });
    // start on the English Wiktionary list when it is there
    selectWordlist(wordlists[DEFAULT_WORDLIST] ? DEFAULT_WORDLIST : results[0][0].id);
  }).catch(function(err){
    console.error('Error loading the list of word lists', err);
  });

});
