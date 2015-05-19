outpost.log('START');

outpost.monitor({name: 'test-server', cmd: 'node', args: ['test-server.js', outpost.config.port]}, function(err) {
  outpost.log('YAY! test-server started. err: ' + err);
  outpost.done();
});

//var options = {uid: 'testServer', cwd: __dirname};
//outpost.forever.startDaemon('test-server.js', options);
//outpost.log('started test server with pidFile ' + options.pidFile);
//
//outpost.daemonize('test-server.js', 'testServer2', function(err, pid) {
//  outpost.log('started testServer2 with pid ' + pid);
//  outpost.done();
//});


//setTimeout(function() {
//  outpost.log('stopping test server');
//  var e = outpost.forever.stop('testServer');
//  e.on('stop', function() {
//  });
//}, 1000);

