outpost.log('MODULE 2 INSTALL SCRIPT');

var i = 0;
outpost.log('progress ' + i);

outpost.exec('echo SHABAT SHALOM', {timeout: 1}, function(code, signal, out) {
  outpost.done();
});
