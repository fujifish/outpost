
var config = require('./config.json');

outpost.log('Starting MyServer on port ' + config.port);

outpost.monitor({name: 'my-server', args: ['my-server.js', config.port]}, function(err) {
  if (err) {
    outpost.fail('MyServer failed to start: ' + err);
  } else {
    outpost.log('MyServer started!');
    outpost.done();
  }
});