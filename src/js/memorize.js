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

document.addEventListener('DOMContentLoaded', function(){
  var input = el('.passphrase-to-memorize'),
    test = el('.passphrase-test'),
    progress = el('.hint-progress'),
    note = el('.memorize-note');

  // how long to rest between rounds, in seconds
  var countdownValues = [60, 120, 300, 600, 1800, 3600];

  // The passphrase being memorized and the progress with it; null when
  // nothing is being memorized. One session at a time: starting or cancelling
  // stops everything the previous one had running.
  var session = null;
  var hintAnimation = null;      // the progress bar, while the hint is hidden
  var countdownInterval = null;  // the rest timer
  var waitingForSpace = false;   // rest is over, waiting for the space bar

  // exactly one of the three stages shows while memorizing
  function showStage(stage) {
    ['active', 'waiting', 'ready'].forEach(function(name){
      setVisible('.memorize-' + name, name == stage);
    });
  }

  function stopHint() {
    if(hintAnimation) {
      hintAnimation.cancel();
      hintAnimation = null;
    }
  }
  function stopCountdown() {
    if(countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }
  function stopEverything() {
    stopHint();
    stopCountdown();
    waitingForSpace = false;
  }

  function showHint() {
    setVisible('.hint-progress-wrapper', false);
    setVisible('.hint-show', true);
  }

  function updateStats() {
    if(session.tries == 0) {
      note.textContent = 'Type the passphrase';
    } else if(session.tries == 1) {
      note.textContent = 'Try to type the passphrase before the hint appears';
    } else if(session.typedWithoutLooking && session.tries < 5) {
      note.textContent = 'Good job! Try making it to 5 tries';
    } else if(session.typedWithoutLooking && session.tries < 10) {
      note.textContent = 'Try making it to 10 tries without seeing what you type';
    } else if(session.typedWithoutLooking) {
      note.textContent = 'Keep practicing';
    }
    el('.memorize-tries').textContent = session.tries;
  }

  function nextTry() {
    // reset the hint
    stopHint();
    progress.style.width = '0%';
    setVisible('.hint-progress-wrapper', true);
    setVisible('.hint-show', false);

    showStage('active');

    // reset the passphrase
    test.value = '';
    test.classList.remove('typo');
    test.focus();

    // the first try shows the hint at once
    if(session.delay == 0) {
      showHint();
      return;
    }

    // animate the progress bar; when the delay is up, show the hint
    var animation = progress.animate(
      [{ width: '0%' }, { width: '100%' }],
      { duration: session.delay * 1000, fill: 'forwards' });
    animation.onfinish = function(){
      if(hintAnimation === animation) {
        hintAnimation = null;
        showHint();
      }
    };
    hintAnimation = animation;
  }

  function countdownComplete() {
    stopCountdown();

    // display ready and wait for the space bar
    showStage('ready');
    test.blur();
    waitingForSpace = true;

    note.textContent = 'Keep practicing';
  }

  function countdown() {
    session.typedWithoutLooking = false;

    showStage('waiting');
    note.textContent = 'Give your mind a rest';

    // how many seconds do we wait?
    var totalSeconds = countdownValues[session.currentCountdown];

    function updateCountdown() {
      var seconds = totalSeconds % 60;
      if(seconds < 10) seconds = '0' + seconds;
      var minutes = Math.floor(totalSeconds / 60);
      el('.countdown').textContent = minutes + ':' + seconds;
    }
    updateCountdown();

    countdownInterval = setInterval(function(){
      totalSeconds--;
      if(totalSeconds > 0) {
        updateCountdown();
        return;
      }

      // countdown complete, the next rest is longer
      if(session.currentCountdown < countdownValues.length - 1)
        session.currentCountdown++;

      // notification
      Passphrases.playSound('notification');
      Passphrases.notify('Time to keep practicing your passphrase!');

      countdownComplete();
    }, 1000);
  }

  // start memorizing
  function startMemorizing(passphrase) {
    stopEverything();
    session = {
      passphrase: passphrase,
      delay: 0,                   // seconds before the hint appears
      tries: 0,
      typedWithoutLooking: false,
      currentCountdown: 0
    };

    // switch from input mode to go mode
    setVisible('.memorize-input', false);
    setVisible('.memorize-go', true);

    test.type = 'text';
    el('.hint-show').textContent = passphrase;

    updateStats();
    nextTry();
  }

  // check what has been typed after each key
  test.addEventListener('keyup', function(){
    if(!session) return;
    var typed = test.value;

    if(typed == session.passphrase) {
      // success
      session.tries++;

      // play success sound effect
      if(session.typedWithoutLooking) {
        Passphrases.playSound('success');
      }

      // was it typed before the hint appeared?
      if(hintAnimation) {
        session.typedWithoutLooking = true;
      }

      // 2nd try has a 5 second delay
      if(session.tries == 1) {
        session.delay = 5;
      } else if(session.tries <= 6) {
        // tries 2-6 have slowly longer delays
        session.delay++;
      }

      // increase delay, if needed
      if(session.delay <= 10)
        session.delay++;

      updateStats();

      // after 5 tries, change from text field to password field
      if(session.tries == 5) {
        test.type = 'password';
      }

      // after 10 tries, rest once it has been typed without looking
      if(session.tries >= 10 && session.typedWithoutLooking) {
        countdown();
      } else {
        nextTry();
      }
    } else {
      // a typo is anything that does not match the passphrase so far
      test.classList.toggle('typo', session.passphrase.indexOf(typed) != 0);
    }
  });

  // space starts the next round after a rest
  window.addEventListener('keydown', function(e){
    if(waitingForSpace && e.key == ' ') {
      e.preventDefault();
      waitingForSpace = false;
      nextTry();
    }
  });

  el('.button-skip-countdown').addEventListener('click', function(){
    if(countdownInterval !== null) countdownComplete();
  });

  el('.button-cancel').addEventListener('click', function(){
    stopEverything();
    session = null;

    // switch from go mode to input mode
    setVisible('.memorize-input', true);
    setVisible('.memorize-go', false);
    input.focus();
  });

  // allow submitting the memorize input form by pressing enter
  el('.memorize-input-form').addEventListener('submit', function(e){
    e.preventDefault();
    if(input.value != '') {
      startMemorizing(input.value);
    } else {
      // blank passphrases not allowed
      input.classList.add('typo');
      setTimeout(function(){
        input.classList.remove('typo');
      }, 100);
      input.focus();
    }
  });
  el('.button-start-memorizing').addEventListener('click', function(){
    el('.memorize-input-form').requestSubmit();
  });
  el('.button-copy-passphrase').addEventListener('click', function(){
    if(Passphrases.currentPassphrase) Passphrases.memorizeStart(Passphrases.currentPassphrase);
  });

  // let the outside world start memorizing a passphrase
  Passphrases.memorizeStart = function(passphrase){
    input.value = passphrase;
    startMemorizing(passphrase);
  };

  // initialize memorize
  setVisible('.memorize-input', true);
  setVisible('.memorize-go', false);
});
