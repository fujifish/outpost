var config = require('./config.json');
outpost.log('Stopping MyServer');

outpost.unmonitor({name: 'my-server'}, function(err) {
  if (err) {
    outpost.fail('MyServer failed to stop: ' + err);
  } else {
    outpost.done();
  }
});