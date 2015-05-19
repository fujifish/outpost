outpost.log('TEST INSTALL SCRIPT');

var i = 0;
var interval = setInterval(function() {
  if (++i === 2) {
    outpost.done();
  } else {
    outpost.log('progress ' + i);
    outpost.exec('echo SHABAT SHALOM', {timeout: 1}, function(code, signal, out) {
      outpost.log('result of executing "echo SHABAT SHALOM": ' + code + ' , ' + signal + ' , ' + out.trim());
    });
  }
}, 2 * 1000);

